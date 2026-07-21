use crate::config::Config;
use crate::core::{CoreManager, handle, sysopt};
use crate::module::lightweight;
use crate::utils;
use crate::utils::window_manager::WindowManager;
use clash_verge_logging::{Type, logging};
use tokio::time::{Duration, timeout};

pub async fn open_or_close_dashboard() {
    if lightweight::is_in_lightweight_mode() {
        let _ = lightweight::exit_lightweight_mode().await;
        return;
    }

    let result = WindowManager::toggle_main_window().await;
    logging!(info, Type::Window, "Window toggle result: {result:?}");
}

/// 读取当前系统代理 / TUN 开关状态。
pub async fn current_proxy_flags() -> (bool, bool) {
    let data = Config::verge().await.data_arc();
    (
        data.enable_system_proxy.unwrap_or(false),
        data.enable_tun_mode.unwrap_or(false),
    )
}

/// 兜底：把系统代理与 TUN 开关持久化为关闭。
///
/// 退出时仅临时重置 OS 代理是不够的：配置里 enable_system_proxy 仍为 true，
/// 下次启动 init_system_proxy 会把系统代理重新指向本地端口；如果那时内核
/// 没有可用配置（例如已退出登录、订阅拉取失败），设备会直接断网，连登录
/// 接口都走这个失效代理，形成“无法上网、也无法登录”的死锁。
async fn persist_proxy_disabled() {
    Config::verge().await.edit_draft(|d| {
        d.enable_system_proxy = Some(false);
        d.enable_tun_mode = Some(false);
    });
    logging!(info, Type::System, "已将系统代理/TUN 开关持久化为关闭");
}

pub async fn quit() {
    logging!(debug, Type::System, "启动退出流程");
    // 设置退出标志
    handle::Handle::global().set_is_exiting();

    // 看门狗：即使后续某一步清理卡死，也保证进程一定会结束。否则内嵌的单例服务器
    // 会一直占用端口，导致再次打开应用“没有反应”（见 utils::server::check_singleton），
    // 同时内核进程残留无法清理。正常退出时本线程会随进程一起结束，不会触发。
    std::thread::spawn(|| {
        std::thread::sleep(Duration::from_secs(8));
        logging!(warn, Type::System, "退出超时，强制结束进程");
        #[cfg(target_os = "windows")]
        kill_stray_cores();
        std::process::exit(0);
    });

    utils::server::shutdown_embedded_server();

    // 先记录退出前的真实开关状态供 OS 级清理使用，再把开关持久化为关闭，
    // 保证配置落盘发生在清理之前——即使后续清理超时被看门狗强杀，
    // 下次启动也不会带着失效的系统代理起来。
    let (sys_proxy_enabled, tun_enabled) = current_proxy_flags().await;
    if sys_proxy_enabled || tun_enabled {
        persist_proxy_disabled().await;
    }
    Config::apply_all_and_save_file().await;

    logging!(info, Type::System, "开始异步清理资源");
    let cleanup_result = clean_async(sys_proxy_enabled, tun_enabled).await;

    logging!(
        info,
        Type::System,
        "资源清理完成，退出代码: {}",
        if cleanup_result { 0 } else { 1 }
    );

    // 兜底：清理可能未被子进程句柄管理到的残留内核（例如上次异常退出留下的孤儿进程，
    // 或 stop_core 超时未杀干净的情况），避免 muacloud-mihomo.exe 不断累积。
    #[cfg(target_os = "windows")]
    kill_stray_cores();

    let app_handle = handle::Handle::app_handle();
    app_handle.exit(if cleanup_result { 0 } else { 1 });
}

/// Best-effort kill of our own stray mihomo cores by image name (Windows).
/// Only targets the cores this app spawns; foreign cores (e.g. a separately
/// installed Clash Verge's `verge-mihomo.exe`) are intentionally left alone.
#[cfg(target_os = "windows")]
fn kill_stray_cores() {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    for image in ["muacloud-mihomo.exe", "muacloud-mihomo-alpha.exe"] {
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/IM", image])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }
}

/// 异步清理资源。`sys_proxy_enabled` / `tun_enabled` 由调用方在清理前捕获，
/// 因为 quit() 会在清理前把配置里的开关持久化为 false，此处不能再读配置。
pub async fn clean_async(sys_proxy_enabled: bool, tun_enabled: bool) -> bool {
    logging!(info, Type::System, "开始执行异步清理操作...");

    // 重置系统代理
    let proxy_task = tokio::task::spawn(async move {
        if !sys_proxy_enabled {
            logging!(info, Type::Window, "系统代理未启用，跳过重置");
            return true;
        }

        logging!(info, Type::Window, "开始重置系统代理...");
        match timeout(Duration::from_millis(1500), sysopt::Sysopt::global().reset_sysproxy()).await {
            Ok(Ok(_)) => {
                logging!(info, Type::Window, "系统代理已重置");
                true
            }
            Ok(Err(e)) => {
                logging!(warn, Type::Window, "Warning: 重置系统代理失败: {e}");
                false
            }
            Err(_) => {
                logging!(warn, Type::Window, "Warning: 重置系统代理超时，继续退出");
                false
            }
        }
    });

    // 关闭 Tun 模式 + 停止核心服务
    let core_task = tokio::task::spawn(async move {
        logging!(info, Type::System, "disable tun");
        if tun_enabled {
            let disable_tun = serde_json::json!({ "tun": { "enable": false } });

            logging!(info, Type::System, "send disable tun request to mihomo");
            match timeout(
                Duration::from_millis(1000),
                handle::Handle::mihomo().await.patch_base_config(&disable_tun),
            )
            .await
            {
                Ok(Ok(_)) => {
                    logging!(info, Type::Window, "TUN模式已禁用");
                }
                Ok(Err(e)) => {
                    logging!(warn, Type::Window, "Warning: 禁用TUN模式失败: {e}");
                }
                Err(_) => {
                    logging!(
                        warn,
                        Type::Window,
                        "Warning: 禁用TUN模式超时（可能系统正在关机），继续退出流程"
                    );
                }
            }
        }

        #[cfg(target_os = "windows")]
        let stop_timeout = Duration::from_secs(2);
        #[cfg(not(target_os = "windows"))]
        let stop_timeout = Duration::from_secs(3);

        logging!(info, Type::System, "stop core");
        match timeout(stop_timeout, CoreManager::global().stop_core()).await {
            Ok(_) => {
                logging!(info, Type::Window, "core已停止");
                true
            }
            Err(_) => {
                logging!(
                    warn,
                    Type::Window,
                    "Warning: 停止core超时（可能系统正在关机），继续退出"
                );
                false
            }
        }
    });

    // DNS恢复（仅macOS）
    let dns_task = tokio::task::spawn(async {
        #[cfg(target_os = "macos")]
        match timeout(
            Duration::from_millis(1000),
            crate::utils::resolve::dns::restore_public_dns(),
        )
        .await
        {
            Ok(_) => {
                logging!(info, Type::Window, "DNS设置已恢复");
                true
            }
            Err(_) => {
                logging!(warn, Type::Window, "Warning: 恢复DNS设置超时");
                false
            }
        }
        #[cfg(not(target_os = "macos"))]
        true
    });

    // 并行执行清理任务
    let (proxy_result, core_result, dns_result) = tokio::join!(proxy_task, core_task, dns_task);

    let proxy_success = proxy_result.unwrap_or_default();
    let core_success = core_result.unwrap_or_default();
    let dns_success = dns_result.unwrap_or_default();

    let all_success = proxy_success && core_success && dns_success;

    logging!(
        info,
        Type::System,
        "异步关闭操作完成 - 代理: {}, 核心: {}, DNS: {}, 总体: {}",
        proxy_success,
        core_success,
        dns_success,
        all_success
    );

    all_success
}

#[cfg(target_os = "macos")]
pub async fn hide() {
    use crate::module::lightweight::add_light_weight_timer;

    let enable_auto_light_weight_mode = Config::verge()
        .await
        .data_arc()
        .enable_auto_light_weight_mode
        .unwrap_or(false);

    if enable_auto_light_weight_mode {
        add_light_weight_timer().await;
    }

    if let Some(window) = WindowManager::get_main_window()
        && window.is_visible().unwrap_or(false)
    {
        let _ = window.hide();
    }
    handle::Handle::global().set_activation_policy_accessory();
}
