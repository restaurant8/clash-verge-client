use crate::{
    config::{Config, IVerge},
    singleton,
};
use anyhow::Result;
use clash_verge_logging::{Type, logging};
use parking_lot::RwLock;
use scopeguard::defer;
use smartstring::alias::String;
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use sysproxy::{Autoproxy, GuardMonitor, GuardType, Sysproxy};
use tokio::sync::Mutex as TokioMutex;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ProxyApplyStep {
    Sysproxy,
    Autoproxy,
}

const fn proxy_apply_steps(sys_enabled: bool, auto_enabled: bool) -> [ProxyApplyStep; 2] {
    // Disabling PAC clears WinINET proxy flags on Windows, so pure global
    // proxy mode must clear PAC before enabling Sysproxy.
    if sys_enabled && !auto_enabled {
        [ProxyApplyStep::Autoproxy, ProxyApplyStep::Sysproxy]
    } else {
        [ProxyApplyStep::Sysproxy, ProxyApplyStep::Autoproxy]
    }
}

fn proxy_value_is_owned(enabled: bool, current: &str, expected: &str) -> bool {
    enabled && current == expected
}

fn sysproxy_is_owned(current: &Sysproxy, expected: &Sysproxy) -> bool {
    current.enable && current.host == expected.host && current.port == expected.port
}

fn disable_owned_proxies(mut sys: Sysproxy, mut auto: Autoproxy) -> Result<()> {
    // 读取当前系统代理状态时可能失败：当其他 TUN 代理软件（如小火箭）把 utun 顶为主接口，
    // sysproxy 无法把 PrimaryService 解析成网卡服务（"failed to get default network interface"）。
    // 这种情况下我们既无法判断代理归属、也无从下手清理，等同于“没有可关的自有代理”，
    // 直接跳过即可——绝不能把这个探测错误当致命错误上抛，否则会连累整个配置 patch 失败，
    // 进而错误地拦住登出/退出（前端 forceDisableProxy 会因此判定“关代理失败”而取消退出）。
    let current_sys = match Sysproxy::get_system_proxy() {
        Ok(sys) => sys,
        Err(err) => {
            logging!(
                warn,
                Type::System,
                "读取系统代理状态失败，跳过清理（可能由其他代理软件接管主网卡）: {err}"
            );
            return Ok(());
        }
    };
    let current_auto = match Autoproxy::get_auto_proxy() {
        Ok(auto) => auto,
        Err(err) => {
            logging!(
                warn,
                Type::System,
                "读取自动代理(PAC)状态失败，跳过清理（可能由其他代理软件接管主网卡）: {err}"
            );
            return Ok(());
        }
    };
    let owns_sys = sysproxy_is_owned(&current_sys, &sys);
    let owns_auto = proxy_value_is_owned(current_auto.enable, current_auto.url.as_str(), auto.url.as_str());
    let foreign_proxy_active = (current_sys.enable && !owns_sys) || (current_auto.enable && !owns_auto);

    if foreign_proxy_active {
        logging!(
            info,
            Type::System,
            "检测到系统代理由其他应用管理，跳过清理以避免影响外部代理"
        );
        return Ok(());
    }

    if owns_sys {
        sys.enable = false;
        sys.set_system_proxy()?;
    }
    if owns_auto {
        auto.enable = false;
        auto.set_auto_proxy()?;
    }

    Ok(())
}

pub struct Sysopt {
    update_lock: TokioMutex<()>,
    reset_sysproxy: AtomicBool,
    inner_proxy: Arc<RwLock<(Sysproxy, Autoproxy)>>,
    guard: Arc<RwLock<GuardMonitor>>,
}

impl Default for Sysopt {
    fn default() -> Self {
        Self {
            update_lock: TokioMutex::new(()),
            reset_sysproxy: AtomicBool::new(false),
            inner_proxy: Arc::new(RwLock::new((Sysproxy::default(), Autoproxy::default()))),
            guard: Arc::new(RwLock::new(GuardMonitor::new(GuardType::None, Duration::from_secs(30)))),
        }
    }
}

#[cfg(target_os = "windows")]
static DEFAULT_BYPASS: &str = "localhost;127.*;192.168.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;<local>";
#[cfg(target_os = "linux")]
static DEFAULT_BYPASS: &str = "localhost,127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,::1";
#[cfg(target_os = "macos")]
static DEFAULT_BYPASS: &str =
    "127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,localhost,*.local,*.crashlytics.com,<local>";

async fn get_bypass() -> String {
    let verge = Config::verge().await.latest_arc();
    let use_default = verge.use_default_bypass.unwrap_or(true);
    let custom_bypass = verge.system_proxy_bypass.as_deref().unwrap_or("");

    if custom_bypass.is_empty() {
        DEFAULT_BYPASS.into()
    } else if use_default {
        format!("{DEFAULT_BYPASS},{custom_bypass}").into()
    } else {
        custom_bypass.into()
    }
}

singleton!(Sysopt, SYSOPT);

impl Sysopt {
    fn new() -> Self {
        Self::default()
    }

    fn access_guard(&self) -> Arc<RwLock<GuardMonitor>> {
        Arc::clone(&self.guard)
    }

    pub async fn refresh_guard(&self) {
        logging!(info, Type::Core, "Refreshing system proxy guard...");
        let verge = Config::verge().await.latest_arc();
        if !verge.enable_system_proxy.unwrap_or_default() {
            logging!(info, Type::Core, "System proxy is disabled.");
            self.access_guard().write().stop();
            return;
        }
        if !verge.enable_proxy_guard.unwrap_or_default() {
            logging!(info, Type::Core, "System proxy guard is disabled.");
            self.access_guard().write().stop();
            return;
        }
        logging!(
            info,
            Type::Core,
            "Updating system proxy with duration: {} seconds",
            verge.proxy_guard_duration.unwrap_or(30)
        );
        {
            let guard = self.access_guard();
            guard
                .write()
                .set_interval(Duration::from_secs(verge.proxy_guard_duration.unwrap_or(30)));
        }
        logging!(info, Type::Core, "Starting system proxy guard...");
        {
            let guard = self.access_guard();
            guard.write().start();
        }
    }

    /// Wait for any in-progress `update_sysproxy` to finish, so that a
    /// subsequent read of OS-level sysproxy state sees a fully applied
    /// configuration instead of a partially-applied one (e.g. SOCKS already
    /// disabled but HTTP still enabled mid-transition).
    pub async fn wait_idle(&self) {
        let _ = self.update_lock.lock().await;
    }

    /// init the sysproxy
    pub async fn update_sysproxy(&self) -> Result<()> {
        let _lock = self.update_lock.lock().await;

        let verge = Config::verge().await.latest_arc();
        let port = match verge.verge_mixed_port {
            Some(port) => port,
            None => Config::clash().await.latest_arc().get_mixed_port(),
        };
        let pac_port = IVerge::get_singleton_port();
        // 先 await, 避免持有锁导致的 Send 问题
        let bypass = get_bypass().await;

        let (sys_enable, pac_enable, proxy_host, proxy_guard) = (
            verge.enable_system_proxy.unwrap_or_default(),
            verge.proxy_auto_config.unwrap_or_default(),
            verge.proxy_host.as_deref().unwrap_or("127.0.0.1"),
            verge.enable_proxy_guard.unwrap_or_default(),
        );

        let (sys, auto, guard_type) = {
            let (sys, auto) = &mut *self.inner_proxy.write();
            sys.host = proxy_host.into();
            sys.port = port;
            sys.bypass = bypass.into();
            auto.url = format!("http://{proxy_host}:{pac_port}/commands/pac");

            // `enable_system_proxy` is the master switch.
            // When disabled, force clear both global proxy and PAC at OS level.
            let guard_type = if !sys_enable {
                sys.enable = false;
                auto.enable = false;
                GuardType::None
            } else if pac_enable {
                sys.enable = false;
                auto.enable = true;
                if proxy_guard {
                    GuardType::Autoproxy(auto.clone())
                } else {
                    GuardType::None
                }
            } else {
                sys.enable = true;
                auto.enable = false;
                if proxy_guard {
                    GuardType::Sysproxy(sys.clone())
                } else {
                    GuardType::None
                }
            };

            (sys.clone(), auto.clone(), guard_type)
        };

        self.access_guard().write().set_guard_type(guard_type);

        let disabling = !sys_enable;
        let apply_steps = proxy_apply_steps(sys.enable, auto.enable);

        tokio::task::spawn_blocking(move || -> Result<()> {
            if disabling {
                return disable_owned_proxies(sys, auto);
            }
            for step in apply_steps {
                match step {
                    ProxyApplyStep::Autoproxy => auto.set_auto_proxy()?,
                    ProxyApplyStep::Sysproxy => sys.set_system_proxy()?,
                }
            }
            Ok(())
        })
        .await??;

        Ok(())
    }

    /// reset the sysproxy
    pub async fn reset_sysproxy(&self) -> Result<()> {
        if self
            .reset_sysproxy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Ok(());
        }
        defer! {
            self.reset_sysproxy.store(false, Ordering::SeqCst);
        }

        // close proxy guard
        self.access_guard().write().set_guard_type(GuardType::None);

        // 仅关闭本应用拥有的代理，避免清除其他代理软件接管后的系统配置。
        let (sys, auto) = {
            let (sys, auto) = &mut *self.inner_proxy.write();
            sys.enable = false;
            auto.enable = false;
            (sys.clone(), auto.clone())
        };

        tokio::task::spawn_blocking(move || -> Result<()> { disable_owned_proxies(sys, auto) }).await??;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{ProxyApplyStep, proxy_apply_steps, proxy_value_is_owned};

    #[test]
    fn proxy_is_owned_only_when_enabled_and_matching() {
        assert!(proxy_value_is_owned(true, "127.0.0.1:17997", "127.0.0.1:17997"));
        assert!(!proxy_value_is_owned(false, "127.0.0.1:17997", "127.0.0.1:17997"));
        assert!(!proxy_value_is_owned(true, "127.0.0.1:1082", "127.0.0.1:17997"));
    }

    #[test]
    fn pure_sysproxy_mode_clears_pac_before_enabling_global_proxy() {
        assert_eq!(
            proxy_apply_steps(true, false),
            [ProxyApplyStep::Autoproxy, ProxyApplyStep::Sysproxy]
        );
    }

    #[test]
    fn pac_mode_clears_global_proxy_before_enabling_pac() {
        assert_eq!(
            proxy_apply_steps(false, true),
            [ProxyApplyStep::Sysproxy, ProxyApplyStep::Autoproxy]
        );
    }

    #[test]
    fn disabled_mode_clears_global_proxy_before_pac() {
        assert_eq!(
            proxy_apply_steps(false, false),
            [ProxyApplyStep::Sysproxy, ProxyApplyStep::Autoproxy]
        );
    }
}
