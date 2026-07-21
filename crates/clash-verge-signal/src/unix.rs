use std::sync::atomic::{AtomicBool, Ordering};

use clash_verge_logging::{Type, logging};
use tokio::signal::unix::{SignalKind, signal};

use crate::RUNTIME;

static IS_CLEANING_UP: AtomicBool = AtomicBool::new(false);

pub fn register<F, Fut>(f: F)
where
    F: Fn() -> Fut + Send + Sync + 'static,
    Fut: Future + Send + 'static,
{
    if let Some(Some(rt)) = RUNTIME.get() {
        // current_thread runtime 只有被 block_on 驱动时才会轮询任务：
        // 若只 rt.spawn 而无人驱动，信号监听协程永远不会执行，OS 层面的
        // 信号处理器也不会注册，SIGTERM 会按系统默认行为直接终止进程，
        // 跳过全部退出清理（系统代理重置等）。这里用独立线程驱动监听循环。
        std::thread::spawn(move || {
            rt.block_on(async move {
                let mut sigterm = match signal(SignalKind::terminate()) {
                    Ok(s) => s,
                    Err(e) => {
                        logging!(error, Type::SystemSignal, "Failed to register SIGTERM: {}", e);
                        return;
                    }
                };
                let mut sigint = match signal(SignalKind::interrupt()) {
                    Ok(s) => s,
                    Err(e) => {
                        logging!(error, Type::SystemSignal, "Failed to register SIGINT: {}", e);
                        return;
                    }
                };
                let mut sighup = match signal(SignalKind::hangup()) {
                    Ok(s) => s,
                    Err(e) => {
                        logging!(error, Type::SystemSignal, "Failed to register SIGHUP: {}", e);
                        return;
                    }
                };

                loop {
                    let signal_name;
                    tokio::select! {
                        _ = sigterm.recv() => {
                            signal_name = "SIGTERM";
                        }
                        _ = sigint.recv() => {
                            signal_name = "SIGINT";
                        }
                        _ = sighup.recv() => {
                            signal_name = "SIGHUP";
                        }
                        else => {
                            break;
                        }
                    }

                    if IS_CLEANING_UP.load(Ordering::SeqCst) {
                        logging!(
                            info,
                            Type::SystemSignal,
                            "Already shutting down, ignoring repeated signal: {}",
                            signal_name
                        );
                        continue;
                    }
                    IS_CLEANING_UP.store(true, Ordering::SeqCst);

                    logging!(info, Type::SystemSignal, "Caught signal {}", signal_name);

                    f().await;
                }
            });
        });
    } else {
        logging!(
            error,
            Type::SystemSignal,
            "register shutdown signal failed, RUNTIME is not available"
        );
    }
}
