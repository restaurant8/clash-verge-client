use std::time::Duration;

pub mod network {
    pub const DEFAULT_EXTERNAL_CONTROLLER: &str = "127.0.0.1:19097";

    pub mod ports {
        #[cfg(not(target_os = "windows"))]
        pub const DEFAULT_REDIR: u16 = 17995;
        #[cfg(target_os = "linux")]
        pub const DEFAULT_TPROXY: u16 = 17996;
        pub const DEFAULT_MIXED: u16 = 17997;
        pub const DEFAULT_SOCKS: u16 = 17998;
        pub const DEFAULT_HTTP: u16 = 17999;

        #[cfg(not(feature = "verge-dev"))]
        pub const SINGLETON_SERVER: u16 = 43331;
        #[cfg(feature = "verge-dev")]
        pub const SINGLETON_SERVER: u16 = 21233;
    }
}

pub mod timing {
    use super::Duration;

    pub const CONFIG_UPDATE_DEBOUNCE: Duration = Duration::from_millis(300);
    pub const STARTUP_ERROR_DELAY: Duration = Duration::from_secs(2);

    #[cfg(target_os = "windows")]
    pub const SERVICE_WAIT_MAX: Duration = Duration::from_millis(3000);
    #[cfg(target_os = "windows")]
    pub const SERVICE_WAIT_INTERVAL: Duration = Duration::from_millis(200);
}

pub mod files {
    pub const RUNTIME_CONFIG: &str = "muacloud-runtime.yaml";
    pub const CHECK_CONFIG: &str = "muacloud-check.yaml";
    pub const DNS_CONFIG: &str = "dns_config.yaml";
    pub const WINDOW_STATE: &str = "window_state.json";
}

pub mod tun {
    pub const DEFAULT_STACK: &str = "gvisor";

    pub const DNS_HIJACK: &[&str] = &["any:53"];
}
