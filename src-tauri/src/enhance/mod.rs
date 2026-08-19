mod chain;
pub mod field;
mod merge;
mod script;
pub mod seq;
mod tun;

use self::{
    chain::{AsyncChainItemFrom as _, ChainItem, ChainType},
    field::{use_keys, use_lowercase, use_sort},
    merge::use_merge,
    script::use_script,
    seq::{SeqMap, use_seq},
    tun::use_tun,
};
use crate::utils::{dirs, init};
use crate::{
    config::{Config, IVerge, PrfItem},
    constants,
    utils::tmpl,
};
use anyhow::{Context as _, Result};
use clash_verge_logging::{Type, logging};
use serde_yaml_ng::{Mapping, Value};
use smartstring::alias::String;
use std::collections::{HashMap, HashSet};
use tokio::fs;

type ResultLog = Vec<(String, String)>;
#[derive(Debug)]
struct ConfigValues {
    clash_config: Mapping,
    clash_core: Option<String>,
    enable_tun: bool,
    enable_builtin: bool,
    socks_enabled: bool,
    http_enabled: bool,
    enable_dns_settings: bool,
    #[cfg(not(target_os = "windows"))]
    redir_enabled: bool,
    #[cfg(target_os = "linux")]
    tproxy_enabled: bool,
}

#[derive(Debug)]
struct ProfileItems {
    config: Mapping,
    merge_item: ChainItem,
    script_item: ChainItem,
    rules_item: ChainItem,
    proxies_item: ChainItem,
    groups_item: ChainItem,
    global_merge: ChainItem,
    global_script: ChainItem,
    profile_name: String,
}

const fn dns_settings_enabled(configured: Option<bool>) -> bool {
    match configured {
        Some(enabled) => enabled,
        None => true,
    }
}

impl Default for ProfileItems {
    fn default() -> Self {
        Self {
            config: Default::default(),
            profile_name: Default::default(),
            merge_item: ChainItem {
                uid: "".into(),
                data: ChainType::Merge(Mapping::new()),
            },
            script_item: ChainItem {
                uid: "".into(),
                data: ChainType::Script(tmpl::ITEM_SCRIPT.into()),
            },
            rules_item: ChainItem {
                uid: "".into(),
                data: ChainType::Rules(SeqMap::default()),
            },
            proxies_item: ChainItem {
                uid: "".into(),
                data: ChainType::Proxies(SeqMap::default()),
            },
            groups_item: ChainItem {
                uid: "".into(),
                data: ChainType::Groups(SeqMap::default()),
            },
            global_merge: ChainItem {
                uid: "Merge".into(),
                data: ChainType::Merge(Mapping::new()),
            },
            global_script: ChainItem {
                uid: "Script".into(),
                data: ChainType::Script(tmpl::ITEM_SCRIPT.into()),
            },
        }
    }
}

async fn chain_item_or_default(item: Option<&PrfItem>, default_item: impl FnOnce() -> ChainItem) -> ChainItem {
    if let Some(item) = item {
        <Option<ChainItem>>::from_async(item).await.unwrap_or_else(default_item)
    } else {
        default_item()
    }
}

async fn get_config_values() -> ConfigValues {
    let clash = Config::clash().await;
    let clash_arc = clash.latest_arc();
    let clash_config = clash_arc.0.clone();
    drop(clash_arc);
    drop(clash);

    let verge = Config::verge().await;

    let verge_arc = verge.latest_arc();
    let IVerge {
        ref enable_tun_mode,
        ref enable_builtin_enhanced,
        ref verge_socks_enabled,
        ref verge_http_enabled,
        ref enable_dns_settings,
        ..
    } = **verge_arc;

    let (clash_core, enable_tun, enable_builtin, socks_enabled, http_enabled, enable_dns_settings) = (
        Some(verge_arc.get_valid_clash_core()),
        enable_tun_mode.unwrap_or(false),
        enable_builtin_enhanced.unwrap_or(true),
        verge_socks_enabled.unwrap_or(false),
        verge_http_enabled.unwrap_or(false),
        dns_settings_enabled(*enable_dns_settings),
    );

    #[cfg(not(target_os = "windows"))]
    let redir_enabled = verge_arc.verge_redir_enabled.unwrap_or(false);

    #[cfg(target_os = "linux")]
    let tproxy_enabled = verge_arc.verge_tproxy_enabled.unwrap_or(false);

    drop(verge_arc);
    drop(verge);

    ConfigValues {
        clash_config,
        clash_core,
        enable_tun,
        enable_builtin,
        socks_enabled,
        http_enabled,
        enable_dns_settings,
        #[cfg(not(target_os = "windows"))]
        redir_enabled,
        #[cfg(target_os = "linux")]
        tproxy_enabled,
    }
}

#[allow(clippy::cognitive_complexity)]
async fn collect_profile_items() -> Result<ProfileItems> {
    let profiles = Config::profiles().await;
    let profiles_arc = profiles.latest_arc();
    drop(profiles);

    let current_profile_uid = match profiles_arc.get_current().cloned() {
        Some(uid) => uid,
        None => {
            drop(profiles_arc);
            return Ok(ProfileItems::default());
        }
    };

    let current = profiles_arc
        .current_mapping()
        .await
        .with_context(|| format!("failed to read current profile \"{current_profile_uid}\""))?;

    let current_item = match profiles_arc.get_item(&current_profile_uid) {
        Ok(item) => item,
        Err(err) => {
            return Err(err).with_context(|| format!("failed to get current profile \"{current_profile_uid}\""));
        }
    };

    let merge_uid = current_item.current_merge().cloned().unwrap_or_else(|| "Merge".into());
    let script_uid = current_item
        .current_script()
        .cloned()
        .unwrap_or_else(|| "Script".into());
    let rules_uid = current_item.current_rules().cloned().unwrap_or_else(|| "Rules".into());
    let proxies_uid = current_item
        .current_proxies()
        .cloned()
        .unwrap_or_else(|| "Proxies".into());
    let groups_uid = current_item
        .current_groups()
        .cloned()
        .unwrap_or_else(|| "Groups".into());

    let name = current_item.name.clone().unwrap_or_default();

    let (merge_item, script_item, rules_item, proxies_item, groups_item, global_merge, global_script) = tokio::join!(
        chain_item_or_default(profiles_arc.get_item(&merge_uid).ok(), || ChainItem {
            uid: "".into(),
            data: ChainType::Merge(Mapping::new()),
        },),
        chain_item_or_default(profiles_arc.get_item(&script_uid).ok(), || ChainItem {
            uid: "".into(),
            data: ChainType::Script(tmpl::ITEM_SCRIPT.into()),
        },),
        chain_item_or_default(profiles_arc.get_item(&rules_uid).ok(), || ChainItem {
            uid: "".into(),
            data: ChainType::Rules(SeqMap::default()),
        },),
        chain_item_or_default(profiles_arc.get_item(&proxies_uid).ok(), || ChainItem {
            uid: "".into(),
            data: ChainType::Proxies(SeqMap::default()),
        },),
        chain_item_or_default(profiles_arc.get_item(&groups_uid).ok(), || ChainItem {
            uid: "".into(),
            data: ChainType::Groups(SeqMap::default()),
        },),
        chain_item_or_default(profiles_arc.get_item("Merge").ok(), || ChainItem {
            uid: "Merge".into(),
            data: ChainType::Merge(Mapping::new()),
        },),
        chain_item_or_default(profiles_arc.get_item("Script").ok(), || ChainItem {
            uid: "Script".into(),
            data: ChainType::Script(tmpl::ITEM_SCRIPT.into()),
        },),
    );

    drop(profiles_arc);

    Ok(ProfileItems {
        config: current,
        merge_item,
        script_item,
        rules_item,
        proxies_item,
        groups_item,
        global_merge,
        global_script,
        profile_name: name,
    })
}

async fn process_global_items(
    mut config: Mapping,
    mut exists_keys: Vec<String>,
    mut result_map: HashMap<String, ResultLog>,
    global_merge: ChainItem,
    global_script: ChainItem,
    profile_name: &String,
) -> (Mapping, Vec<String>, HashMap<String, ResultLog>) {
    if let ChainType::Merge(merge) = global_merge.data {
        exists_keys.extend(use_keys(&merge));
        config = use_merge(&merge, config);
    }

    if let ChainType::Script(script) = global_script.data {
        let mut logs = vec![];
        match use_script(script, config.clone(), profile_name.clone()).await {
            Ok((res_config, res_logs)) => {
                extend_changed_keys(&mut exists_keys, &config, &res_config);
                config = res_config;
                logs.extend(res_logs);
            }
            Err(err) => logs.push(("exception".into(), err.to_string().into())),
        }
        result_map.insert(global_script.uid, logs);
    }

    (config, exists_keys, result_map)
}

fn process_seq_items(
    mut config: Mapping,
    rules_item: ChainItem,
    proxies_item: ChainItem,
    groups_item: ChainItem,
) -> Mapping {
    if let ChainType::Rules(rules) = rules_item.data {
        config = use_seq(rules, config, "rules");
    }

    if let ChainType::Proxies(proxies) = proxies_item.data {
        config = use_seq(proxies, config, "proxies");
    }

    if let ChainType::Groups(groups) = groups_item.data {
        config = use_seq(groups, config, "proxy-groups");
    }

    config
}

fn extend_changed_keys(exists_keys: &mut Vec<String>, config: &Mapping, res_config: &Mapping) {
    exists_keys.extend(res_config.iter().filter_map(|(key, value)| {
        if config.get(key) == Some(value) {
            return None;
        }

        key.as_str().map(|key| {
            let mut key: String = key.into();
            key.make_ascii_lowercase();
            key
        })
    }));
}

/// App 权威的顶层控制面键:核心连接、监听端口、UI/托盘开关。
/// 平台键随 cfg 门控;`dns.ipv6` 单独处理。
const CONTROL_PLANE_KEYS: &[&str] = &[
    "external-controller",
    #[cfg(unix)]
    "external-controller-unix",
    #[cfg(windows)]
    "external-controller-pipe",
    "external-controller-cors",
    "secret",
    "mixed-port",
    "socks-port",
    "port",
    #[cfg(not(target_os = "windows"))]
    "redir-port",
    #[cfg(target_os = "linux")]
    "tproxy-port",
    "tun",
    "mode",
    "allow-lan",
    "log-level",
    "ipv6",
    "unified-delay",
];

/// 手动 merge/script 前保存 app 最终控制面值,只记录当前存在的键。
fn snapshot_control_plane(config: &Mapping) -> Mapping {
    let mut snapshot = Mapping::new();
    for &key in CONTROL_PLANE_KEYS {
        let key = Value::from(key);
        if let Some(value) = config.get(&key) {
            snapshot.insert(key, value.clone());
        }
    }
    snapshot
}

/// 手动覆盖后恢复控制面快照;快照缺失的控制面键从最终配置删除。
fn enforce_control_plane(mut config: Mapping, snapshot: Mapping) -> Mapping {
    for &key in CONTROL_PLANE_KEYS {
        let key = Value::from(key);
        if !snapshot.contains_key(&key) {
            config.remove(&key);
        }
    }
    config.extend(snapshot);
    config
}

/// DNS 页权威的嵌套开关;只在 `enable_dns_settings` 时快照。
fn snapshot_dns_ipv6(config: &Mapping) -> Option<Value> {
    config.get("dns")?.get("ipv6").cloned()
}

/// 恢复 `dns.ipv6`,但不创建缺失的 `dns` 块。
fn enforce_dns_ipv6(mut config: Mapping, dns_ipv6: Option<Value>) -> Mapping {
    if let Some(dns_ipv6) = dns_ipv6
        && let Some(Value::Mapping(dns)) = config.get_mut("dns")
    {
        dns.insert(Value::from("ipv6"), dns_ipv6);
    }
    config
}

async fn process_profile_items(
    mut config: Mapping,
    mut exists_keys: Vec<String>,
    mut result_map: HashMap<String, ResultLog>,
    merge_item: ChainItem,
    script_item: ChainItem,
    profile_name: &String,
) -> (Mapping, Vec<String>, HashMap<String, ResultLog>) {
    if let ChainType::Merge(merge) = merge_item.data {
        exists_keys.extend(use_keys(&merge));
        config = use_merge(&merge, config);
    }

    if let ChainType::Script(script) = script_item.data {
        let mut logs = vec![];
        match use_script(script, config.clone(), profile_name.clone()).await {
            Ok((res_config, res_logs)) => {
                extend_changed_keys(&mut exists_keys, &config, &res_config);
                config = res_config;
                logs.extend(res_logs);
            }
            Err(err) => logs.push(("exception".into(), err.to_string().into())),
        }
        result_map.insert(script_item.uid, logs);
    }

    (config, exists_keys, result_map)
}

async fn merge_default_config(
    mut config: Mapping,
    clash_config: Mapping,
    socks_enabled: bool,
    http_enabled: bool,
    #[cfg(not(target_os = "windows"))] redir_enabled: bool,
    #[cfg(target_os = "linux")] tproxy_enabled: bool,
) -> Mapping {
    for (key, value) in clash_config.into_iter() {
        if key.as_str() == Some("tun") {
            let mut tun = config.get_mut("tun").map_or_else(Mapping::new, |val| {
                val.as_mapping().cloned().unwrap_or_else(Mapping::new)
            });
            let patch_tun = value.as_mapping().cloned().unwrap_or_else(Mapping::new);
            for (key, value) in patch_tun.into_iter() {
                tun.insert(key, value);
            }
            config.insert("tun".into(), tun.into());
        } else {
            if key.as_str() == Some("socks-port") && !socks_enabled {
                config.remove("socks-port");
                continue;
            }
            if key.as_str() == Some("port") && !http_enabled {
                config.remove("port");
                continue;
            }
            #[cfg(target_os = "windows")]
            {
                if key.as_str() == Some("redir-port") {
                    continue;
                }
            }
            #[cfg(not(target_os = "windows"))]
            {
                if key.as_str() == Some("redir-port") && !redir_enabled {
                    config.remove("redir-port");
                    continue;
                }
            }
            #[cfg(target_os = "linux")]
            {
                if key.as_str() == Some("tproxy-port") && !tproxy_enabled {
                    config.remove("tproxy-port");
                    continue;
                }
            }
            #[cfg(not(target_os = "linux"))]
            {
                if key.as_str() == Some("tproxy-port") {
                    config.remove("tproxy-port");
                    continue;
                }
            }
            // 处理 external-controller 键的开关逻辑
            if key.as_str() == Some("external-controller") {
                let enable_external_controller = Config::verge()
                    .await
                    .latest_arc()
                    .enable_external_controller
                    .unwrap_or(false);

                if enable_external_controller {
                    config.insert(key, value);
                } else {
                    // 如果禁用了外部控制器，设置为空字符串
                    config.insert(key, "".into());
                }
            } else {
                config.insert(key, value);
            }
        }
    }

    config
}

async fn apply_builtin_scripts(mut config: Mapping, clash_core: Option<String>, enable_builtin: bool) -> Mapping {
    if enable_builtin {
        let items: Vec<_> = ChainItem::builtin()
            .into_iter()
            .filter(|(s, _)| s.is_support(clash_core.as_ref()))
            .map(|(_, c)| c)
            .collect();
        for item in items {
            logging!(debug, Type::Core, "run builtin script {}", item.uid);
            if let ChainType::Script(script) = item.data {
                match use_script(script, config.clone(), String::from("")).await {
                    Ok((res_config, _)) => {
                        config = res_config;
                    }
                    Err(err) => {
                        logging!(error, Type::Core, "builtin script error `{err}`");
                    }
                }
            }
        }
    }

    config
}

fn cleanup_proxy_groups(mut config: Mapping) -> Mapping {
    const BUILTIN_POLICIES: &[&str] = &["DIRECT", "REJECT", "REJECT-DROP", "PASS"];

    let proxy_names = config
        .get("proxies")
        .and_then(|v| v.as_sequence())
        .map(|seq| {
            seq.iter()
                .filter_map(|item| match item {
                    Value::Mapping(map) => map
                        .get("name")
                        .and_then(Value::as_str)
                        .map(|name| name.to_owned().into()),
                    Value::String(name) => Some(name.to_owned().into()),
                    _ => None,
                })
                .collect::<HashSet<String>>()
        })
        .unwrap_or_default();

    let group_names = config
        .get("proxy-groups")
        .and_then(|v| v.as_sequence())
        .map(|seq| {
            seq.iter()
                .filter_map(|item| {
                    item.as_mapping()
                        .and_then(|map| map.get("name"))
                        .and_then(Value::as_str)
                        .map(std::convert::Into::into)
                })
                .collect::<HashSet<String>>()
        })
        .unwrap_or_default();

    let provider_names = config
        .get("proxy-providers")
        .and_then(Value::as_mapping)
        .map(|map| {
            map.keys()
                .filter_map(Value::as_str)
                .map(std::convert::Into::into)
                .collect::<HashSet<String>>()
        })
        .unwrap_or_default();

    let mut allowed_names = proxy_names;
    allowed_names.extend(group_names);
    allowed_names.extend(provider_names.iter().cloned());
    allowed_names.extend(BUILTIN_POLICIES.iter().map(|p| (*p).into()));

    if let Some(Value::Sequence(groups)) = config.get_mut("proxy-groups") {
        for group in groups {
            if let Some(group_map) = group.as_mapping_mut() {
                let mut has_valid_provider = false;

                if let Some(Value::Sequence(uses)) = group_map.get_mut("use") {
                    uses.retain(|provider| match provider {
                        Value::String(name) => {
                            let exists = provider_names.contains(name.as_str());
                            has_valid_provider = has_valid_provider || exists;
                            exists
                        }
                        _ => false,
                    });
                }

                if let Some(Value::Sequence(proxies)) = group_map.get_mut("proxies") {
                    proxies.retain(|proxy| match proxy {
                        Value::String(name) => allowed_names.contains(name.as_str()) || has_valid_provider,
                        _ => true,
                    });
                }
            }
        }
    }

    config
}

/// 当 DNS 处于 fake-ip 模式且启用 IPv6 时，补充缺失的 `fake-ip-range6`，
/// 否则 AAAA 查询无法获得 fake-ip，导致 IPv6 解析失败（见 issue #7373）。
/// 兼容旧版本生成的、缺少该字段的 dns_config.yaml。
fn ensure_fake_ip_range6(dns: &mut Mapping) {
    use serde_yaml_ng::Value;

    let ipv6_enabled = dns.get("ipv6").and_then(|v| v.as_bool()).unwrap_or(false);
    let is_fake_ip = dns
        .get("enhanced-mode")
        .and_then(|v| v.as_str())
        .map(|m| m == "fake-ip")
        .unwrap_or(true);

    // 缺失或为空字符串（可能来自手动编辑的 YAML）时都需要补充
    let range6_missing = dns
        .get("fake-ip-range6")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().is_empty())
        .unwrap_or(true);

    if ipv6_enabled && is_fake_ip && range6_missing {
        dns.insert(Value::from("fake-ip-range6"), Value::from("fdfe:dcba:9876::1/64"));
    }
}

fn has_proxy_server_nameserver(dns: &Mapping) -> bool {
    match dns.get("proxy-server-nameserver") {
        Some(Value::Sequence(servers)) => !servers.is_empty(),
        Some(Value::String(server)) => !server.trim().is_empty(),
        _ => false,
    }
}

fn has_nameserver(dns: &Mapping, key: &str) -> bool {
    match dns.get(key) {
        Some(Value::Sequence(servers)) => !servers.is_empty(),
        Some(Value::String(server)) => !server.trim().is_empty(),
        _ => false,
    }
}

/// Detect an untouched DNS file generated by this application. The previous
/// template used `listen: :53`; an empty listener can also be written by the
/// visual editor. Both are normalized away so existing untouched installs get
/// the same safe behavior as fresh installs.
fn is_bundled_default_dns_config(config: &Mapping) -> bool {
    let Some(Value::Mapping(dns)) = config.get("dns") else {
        return false;
    };

    let mut normalized = dns.clone();
    let listen_key = Value::from("listen");
    let remove_default_listener = normalized
        .get(&listen_key)
        .and_then(Value::as_str)
        .is_some_and(|listen| matches!(listen.trim(), "" | ":53"));
    if remove_default_listener {
        normalized.remove(&listen_key);
    }

    normalized
        .entry(Value::from("fake-ip-range6"))
        .or_insert_with(|| Value::from("fdfe:dcba:9876::1/64"));
    normalized
        .entry(Value::from("nameserver-policy"))
        .or_insert_with(|| Value::Mapping(Mapping::new()));

    if normalized != init::bundled_dns_mapping() {
        return false;
    }

    match config.get("hosts") {
        None => true,
        Some(Value::Mapping(hosts)) => hosts.is_empty(),
        _ => false,
    }
}

/// Apply the untouched bundled template as a compatibility layer instead of
/// replacing the subscription's complete DNS design. Existing subscription
/// modes, filters and upstreams stay intact; only DNS enablement and missing
/// bootstrap/node resolvers are supplied by the app.
fn apply_bundled_dns_defaults(mut config: Mapping, bundled_dns: &Mapping) -> Mapping {
    let dns_key = Value::from("dns");
    let mut dns = match config.remove(&dns_key) {
        Some(Value::Mapping(dns)) if has_nameserver(&dns, "nameserver") => dns,
        _ => bundled_dns.clone(),
    };

    dns.insert(Value::from("enable"), Value::Bool(true));
    if !has_nameserver(&dns, "default-nameserver")
        && let Some(default_nameserver) = bundled_dns.get("default-nameserver")
    {
        dns.insert(Value::from("default-nameserver"), default_nameserver.clone());
    }
    if !has_proxy_server_nameserver(&dns)
        && let Some(proxy_nameserver) = bundled_dns.get("proxy-server-nameserver")
    {
        dns.insert(Value::from("proxy-server-nameserver"), proxy_nameserver.clone());
    }
    ensure_fake_ip_range6(&mut dns);

    config.insert(dns_key, Value::Mapping(dns));
    config
}

/// Merge a policy map from the subscription into the DNS override. Entries
/// explicitly configured in the local override keep priority.
fn merge_subscription_policy(dns: &mut Mapping, subscription_dns: &Mapping, key: &str) {
    let key = Value::from(key);
    let Some(Value::Mapping(subscription_policy)) = subscription_dns.get(&key) else {
        return;
    };

    let mut merged = subscription_policy.clone();
    if let Some(Value::Mapping(local_policy)) = dns.remove(&key) {
        merged.extend(local_policy);
    }
    dns.insert(key, Value::Mapping(merged));
}

fn merge_subscription_dns_policies(dns: &mut Mapping, subscription_dns: &Mapping) {
    merge_subscription_policy(dns, subscription_dns, "nameserver-policy");

    // Mihomo rejects proxy-server-nameserver-policy without a proxy resolver.
    if has_proxy_server_nameserver(dns) {
        merge_subscription_policy(dns, subscription_dns, "proxy-server-nameserver-policy");
    }
}

fn dns_server_is_safe_for_proxy_mirror(server: &str) -> bool {
    let Some((_, fragment)) = server.split_once('#') else {
        return true;
    };

    // A fragment item without '=' is a proxy/group/interface name or RULES.
    // Mirroring such an upstream into the node resolver can make resolving a
    // node depend on connecting through that same node. Boolean/parameter-only
    // fragments such as #h3=true remain safe.
    !fragment
        .split('&')
        .map(str::trim)
        .any(|item| !item.is_empty() && !item.contains('='))
}

fn filter_policy_for_proxy_mirror(policy: &Mapping) -> Mapping {
    policy
        .iter()
        .filter_map(|(domain, value)| {
            let filtered = match value {
                Value::String(server) if dns_server_is_safe_for_proxy_mirror(server) => value.clone(),
                Value::Sequence(servers) => {
                    let servers = servers
                        .iter()
                        .filter(|server| server.as_str().is_some_and(dns_server_is_safe_for_proxy_mirror))
                        .cloned()
                        .collect::<Vec<_>>();
                    if servers.is_empty() {
                        return None;
                    }
                    Value::Sequence(servers)
                }
                _ => return None,
            };
            Some((domain.clone(), filtered))
        })
        .collect()
}

/// Reconcile the final node resolver policy after all merge/script stages.
///
/// - A missing/empty node resolver must never keep a proxy policy because
///   Mihomo rejects that configuration.
/// - Automatic mirroring only belongs to DNS overwrite mode.
/// - Proxy-routed upstreams are excluded from automatic mirroring to avoid a
///   node-resolution dependency cycle. Explicit proxy policies remain intact.
fn reconcile_proxy_nameserver_policy(mut config: Mapping, enable_dns_settings: bool) -> Mapping {
    let Some(dns) = config.get_mut("dns").and_then(Value::as_mapping_mut) else {
        return config;
    };
    let proxy_policy_key = Value::from("proxy-server-nameserver-policy");
    if !has_proxy_server_nameserver(dns) {
        dns.remove(&proxy_policy_key);
        return config;
    }
    if !enable_dns_settings {
        return config;
    }

    let nameserver_policy_key = Value::from("nameserver-policy");
    let Some(Value::Mapping(nameserver_policy)) = dns.get(&nameserver_policy_key) else {
        return config;
    };
    if nameserver_policy.is_empty() {
        return config;
    }

    let mut proxy_policy = filter_policy_for_proxy_mirror(nameserver_policy);
    if let Some(Value::Mapping(explicit_proxy_policy)) = dns.remove(&proxy_policy_key) {
        proxy_policy.extend(explicit_proxy_policy);
    }
    if !proxy_policy.is_empty() {
        dns.insert(proxy_policy_key, Value::Mapping(proxy_policy));
    }

    config
}

async fn apply_dns_settings(mut config: Mapping, enable_dns_settings: bool) -> Mapping {
    if enable_dns_settings && let Ok(app_dir) = dirs::app_home_dir() {
        let dns_path = app_dir.join(constants::files::DNS_CONFIG);

        if dns_path.exists()
            && let Ok(dns_yaml) = fs::read_to_string(&dns_path).await
            && let Ok(dns_config) = serde_yaml_ng::from_str::<serde_yaml_ng::Mapping>(&dns_yaml)
        {
            let is_bundled_default = is_bundled_default_dns_config(&dns_config);
            if let Some(hosts_value) = dns_config.get("hosts")
                && hosts_value.is_mapping()
                && (!is_bundled_default || hosts_value.as_mapping().is_some_and(|hosts| !hosts.is_empty()))
            {
                config.insert("hosts".into(), hosts_value.clone());
                logging!(info, Type::Core, "apply hosts configuration");
            }

            if let Some(dns_value) = dns_config.get("dns") {
                if let Some(dns_mapping) = dns_value.as_mapping() {
                    if is_bundled_default {
                        config = apply_bundled_dns_defaults(config, dns_mapping);
                        logging!(
                            info,
                            Type::Core,
                            "apply bundled DNS compatibility defaults (preserve subscription DNS)"
                        );
                        return config;
                    }

                    let mut dns_mapping = dns_mapping.clone();
                    ensure_fake_ip_range6(&mut dns_mapping);
                    // The UI stores an empty nameserver-policy by default and
                    // replaces the DNS section. Preserve per-domain policies
                    // supplied by the subscription; local entries win here and
                    // the remotely managed policy is merged last below.
                    if let Some(subscription_dns) = config.get("dns").and_then(Value::as_mapping) {
                        merge_subscription_dns_policies(&mut dns_mapping, subscription_dns);
                    }
                    config.insert("dns".into(), dns_mapping.into());
                    logging!(info, Type::Core, "apply dns_config.yaml (dns section)");
                }
            } else {
                let mut dns_config = dns_config;
                ensure_fake_ip_range6(&mut dns_config);
                config.insert("dns".into(), dns_config.into());
                logging!(info, Type::Core, "apply dns_config.yaml");
            }
        }
    }

    config
}

/// 远程下发的 `dns.nameserver-policy`。
///
/// 在所有本地设置与手动覆写之后合并,因此优先级高于 DNS 设置页(dns_config.yaml)、
/// 全局/订阅的 merge 与 script。同名域名以远程值为准,其余条目保留。
async fn apply_remote_dns_policy(mut config: Mapping, enable_dns_settings: bool) -> Mapping {
    let Ok(app_dir) = dirs::app_home_dir() else {
        return config;
    };

    let policy_path = app_dir.join(constants::files::REMOTE_DNS_POLICY);
    if !policy_path.exists() {
        return config;
    }

    let Ok(policy_yaml) = fs::read_to_string(&policy_path).await else {
        return config;
    };

    let remote_policy = match serde_yaml_ng::from_str::<Mapping>(&policy_yaml) {
        Ok(policy) if !policy.is_empty() => policy,
        Ok(_) => return config,
        Err(e) => {
            logging!(warn, Type::Config, "invalid remote dns policy: {e}");
            return config;
        }
    };

    let entries = remote_policy.len();
    config = merge_remote_dns_policy(config, remote_policy, enable_dns_settings);
    logging!(
        info,
        Type::Config,
        "apply remote dns nameserver-policy ({entries} entries)"
    );
    config
}

fn merge_remote_dns_policy(mut config: Mapping, remote_policy: Mapping, enable_dns_settings: bool) -> Mapping {
    let dns_key = Value::from("dns");
    let mut dns = match config.remove(&dns_key) {
        Some(Value::Mapping(dns)) => dns,
        _ => Mapping::new(),
    };
    // The remote policy has highest priority, but it is not itself a DNS
    // overwrite switch. If the subscription disables/omits DNS and the local
    // or remote-controlled `enable_dns_settings` switch is off, keep DNS off.
    // To make a policy active without subscription DNS, the control plane must
    // explicitly also send `dns_overwrite_enabled=true`.
    let merge_remote = |dns: &mut Mapping, key: &str, remote: Mapping| {
        let key = Value::from(key);
        // 同名域名以远程值为准,订阅/本地已有的其它条目保留。
        let merged = match dns.remove(&key) {
            Some(Value::Mapping(mut existing)) => {
                existing.extend(remote);
                existing
            }
            _ => remote,
        };
        dns.insert(key, Value::Mapping(merged));
    };

    let has_proxy_resolver = has_proxy_server_nameserver(&dns);
    merge_remote(&mut dns, "nameserver-policy", remote_policy.clone());
    if enable_dns_settings && has_proxy_resolver {
        let safe_proxy_policy = filter_policy_for_proxy_mirror(&remote_policy);
        if !safe_proxy_policy.is_empty() {
            merge_remote(&mut dns, "proxy-server-nameserver-policy", safe_proxy_policy);
        }
    }
    config.insert(dns_key, Value::Mapping(dns));
    config
}

/// Enhance mode
/// 返回最终订阅、该订阅包含的键、和script执行的结果
pub async fn enhance() -> Result<(Mapping, HashSet<String>, HashMap<String, ResultLog>)> {
    // gather config values
    let cfg_vals = get_config_values().await;
    let ConfigValues {
        clash_config,
        clash_core,
        enable_tun,
        enable_builtin,
        socks_enabled,
        http_enabled,
        enable_dns_settings,
        #[cfg(not(target_os = "windows"))]
        redir_enabled,
        #[cfg(target_os = "linux")]
        tproxy_enabled,
    } = cfg_vals;

    // collect profile items
    let profile = collect_profile_items().await?;
    let config = profile.config;
    let merge_item = profile.merge_item;
    let script_item = profile.script_item;
    let rules_item = profile.rules_item;
    let proxies_item = profile.proxies_item;
    let groups_item = profile.groups_item;
    let global_merge = profile.global_merge;
    let global_script = profile.global_script;
    let profile_name = profile.profile_name;

    let result_map = HashMap::new();

    // 顺序项先于手动覆盖。
    let config = process_seq_items(config, rules_item, proxies_item, groups_item);
    let exists_keys = use_keys(&config).collect::<Vec<_>>();

    // merge default clash config
    let config = merge_default_config(
        config,
        clash_config,
        socks_enabled,
        http_enabled,
        #[cfg(not(target_os = "windows"))]
        redir_enabled,
        #[cfg(target_os = "linux")]
        tproxy_enabled,
    )
    .await;

    // app 生成项先于手动覆盖。
    let config = apply_builtin_scripts(config, clash_core, enable_builtin).await;
    let config = use_tun(config, enable_tun);
    let config = apply_dns_settings(config, enable_dns_settings).await;

    // 手动覆盖前锁定 app 权威字段。
    let control_plane = snapshot_control_plane(&config);
    // DNS 页开启时,仅 `dns.ipv6` 跟随 UI;其余 DNS 字段仍可覆盖。
    let dns_ipv6 = if enable_dns_settings {
        snapshot_dns_ipv6(&config)
    } else {
        None
    };

    // 全局手动覆盖。
    let (config, exists_keys, result_map) = process_global_items(
        config,
        exists_keys,
        result_map,
        global_merge,
        global_script,
        &profile_name,
    )
    .await;

    // 当前 profile 手动覆盖。
    let (config, exists_keys, result_map) =
        process_profile_items(config, exists_keys, result_map, merge_item, script_item, &profile_name).await;

    // 手动覆盖后恢复 app 权威字段。
    let config = enforce_control_plane(config, control_plane);
    let config = enforce_dns_ipv6(config, dns_ipv6);

    // 远程下发的 DNS 策略排在最后,本地设置与手动覆写都顶不掉。
    let config = apply_remote_dns_policy(config, enable_dns_settings).await;
    // 兼容只提供 nameserver-policy 的订阅:DNS 覆写配置了独立的节点
    // 解析器时,同步生成该解析器实际读取的 proxy-server 策略。
    let config = reconcile_proxy_nameserver_policy(config, enable_dns_settings);

    let config = cleanup_proxy_groups(config);
    let config = use_sort(config);

    let mut exists_keys_set = HashSet::new();
    exists_keys_set.extend(exists_keys);

    Ok((config, exists_keys_set, result_map))
}

#[allow(clippy::expect_used)]
#[cfg(test)]
mod tests {
    use super::{
        ChainItem, ChainType, cleanup_proxy_groups, merge_remote_dns_policy, merge_subscription_dns_policies,
        process_global_items, process_profile_items, reconcile_proxy_nameserver_policy, use_keys,
    };
    use std::collections::HashMap;

    fn mapping(yaml: &str) -> serde_yaml_ng::Mapping {
        serde_yaml_ng::from_str(yaml).expect("test config should be valid")
    }

    #[test]
    fn dns_settings_default_on_but_respect_explicit_off() {
        assert!(super::dns_settings_enabled(None));
        assert!(super::dns_settings_enabled(Some(true)));
        assert!(!super::dns_settings_enabled(Some(false)));
    }

    #[test]
    fn bundled_dns_defaults_preserve_subscription_dns_design() {
        let config = mapping(
            r"{dns: {enable: false, enhanced-mode: redir-host,
                fake-ip-filter: [subscription.example],
                default-nameserver: [192.0.2.53],
                nameserver: [https://subscription.example/dns-query],
                nameserver-policy: {node.example: https://node.example/dns-query}}}",
        );
        let bundled_dns = super::init::bundled_dns_mapping();

        let result = super::apply_bundled_dns_defaults(config, &bundled_dns);
        let dns = result
            .get("dns")
            .and_then(serde_yaml_ng::Value::as_mapping)
            .expect("DNS should remain configured");

        assert_eq!(dns.get("enable").and_then(serde_yaml_ng::Value::as_bool), Some(true));
        assert_eq!(
            dns.get("enhanced-mode").and_then(serde_yaml_ng::Value::as_str),
            Some("redir-host")
        );
        assert_eq!(
            dns.get("nameserver")
                .and_then(serde_yaml_ng::Value::as_sequence)
                .and_then(|servers| servers.first())
                .and_then(serde_yaml_ng::Value::as_str),
            Some("https://subscription.example/dns-query")
        );
        assert_eq!(
            dns.get("fake-ip-filter")
                .and_then(serde_yaml_ng::Value::as_sequence)
                .and_then(|filters| filters.first())
                .and_then(serde_yaml_ng::Value::as_str),
            Some("subscription.example")
        );
        assert!(dns.get("listen").is_none());
        assert!(super::has_proxy_server_nameserver(dns));
    }

    #[test]
    fn legacy_bundled_dns_file_is_detected_without_port_53() {
        let mut dns = super::init::bundled_dns_mapping();
        dns.insert("listen".into(), ":53".into());
        let config = serde_yaml_ng::Mapping::from_iter([
            ("dns".into(), serde_yaml_ng::Value::Mapping(dns)),
            (
                "hosts".into(),
                serde_yaml_ng::Value::Mapping(serde_yaml_ng::Mapping::new()),
            ),
        ]);

        assert!(super::is_bundled_default_dns_config(&config));
        assert!(super::init::bundled_dns_mapping().get("listen").is_none());
    }

    #[test]
    fn remote_dns_policy_does_not_enable_dns_by_itself() {
        let config = mapping("{mode: rule}");
        let remote = mapping("{example.com: https://dns.example/dns-query}");

        let result = merge_remote_dns_policy(config, remote, false);
        let dns = result
            .get("dns")
            .and_then(serde_yaml_ng::Value::as_mapping)
            .expect("remote policy should create a DNS policy section");

        assert!(dns.get("enable").is_none());
        assert!(dns.get("nameserver").is_none());
        assert!(dns.get("default-nameserver").is_none());
        assert!(dns.get("proxy-server-nameserver-policy").is_none());
        assert_eq!(
            dns.get("nameserver-policy")
                .and_then(|value| value.get("example.com"))
                .and_then(serde_yaml_ng::Value::as_str),
            Some("https://dns.example/dns-query")
        );
    }

    #[test]
    fn remote_dns_policy_wins_without_erasing_subscription_dns() {
        let config = mapping(
            r"{dns: {enable: true, nameserver: [https://doh.pub/dns-query],
                nameserver-policy: {example.com: https://old.example/dns-query,
                                    other.example: https://other.example/dns-query}}}",
        );
        let remote = mapping("{example.com: https://remote.example/dns-query}");

        let result = merge_remote_dns_policy(config, remote, false);
        let dns = result
            .get("dns")
            .and_then(serde_yaml_ng::Value::as_mapping)
            .expect("DNS section should remain present");

        assert_eq!(dns.get("enable").and_then(serde_yaml_ng::Value::as_bool), Some(true));
        assert!(dns.get("nameserver").is_some());
        assert_eq!(
            dns.get("nameserver-policy")
                .and_then(|value| value.get("example.com"))
                .and_then(serde_yaml_ng::Value::as_str),
            Some("https://remote.example/dns-query")
        );
        assert!(
            dns.get("nameserver-policy")
                .and_then(|value| value.get("other.example"))
                .is_some()
        );
    }

    #[test]
    fn dns_override_preserves_subscription_policies_with_local_priority() {
        let subscription_dns = mapping(
            r"{nameserver-policy: {node.example: https://subscription.example/dns-query,
                                    subscription-only.example: https://subscription-only.example/dns-query},
                proxy-server-nameserver-policy: {node.example: https://proxy-subscription.example/dns-query,
                                                  proxy-only.example: https://proxy-only.example/dns-query}}",
        );
        let mut local_dns = mapping(
            r"{proxy-server-nameserver: [https://dns.alidns.com/dns-query],
                nameserver-policy: {node.example: https://local.example/dns-query},
                proxy-server-nameserver-policy: {node.example: https://proxy-local.example/dns-query}}",
        );

        merge_subscription_dns_policies(&mut local_dns, &subscription_dns);

        assert_eq!(
            local_dns
                .get("nameserver-policy")
                .and_then(|value| value.get("node.example"))
                .and_then(serde_yaml_ng::Value::as_str),
            Some("https://local.example/dns-query")
        );
        assert!(
            local_dns
                .get("nameserver-policy")
                .and_then(|value| value.get("subscription-only.example"))
                .is_some()
        );
        assert_eq!(
            local_dns
                .get("proxy-server-nameserver-policy")
                .and_then(|value| value.get("node.example"))
                .and_then(serde_yaml_ng::Value::as_str),
            Some("https://proxy-local.example/dns-query")
        );
        assert!(
            local_dns
                .get("proxy-server-nameserver-policy")
                .and_then(|value| value.get("proxy-only.example"))
                .is_some()
        );
    }

    #[test]
    fn nameserver_policy_is_mirrored_for_proxy_node_resolution() {
        let config = mapping(
            r"{dns: {proxy-server-nameserver: [https://dns.alidns.com/dns-query],
                nameserver-policy: {node.example: [https://private.example/dns-query,
                                                   https://backup.example/dns-query],
                                    copied.example: https://copied.example/dns-query},
                proxy-server-nameserver-policy: {node.example: https://explicit.example/dns-query}}}",
        );

        let result = reconcile_proxy_nameserver_policy(config, true);
        let proxy_policy = result
            .get("dns")
            .and_then(|value| value.get("proxy-server-nameserver-policy"))
            .and_then(serde_yaml_ng::Value::as_mapping)
            .expect("proxy policy should be generated");

        assert_eq!(
            proxy_policy.get("node.example").and_then(serde_yaml_ng::Value::as_str),
            Some("https://explicit.example/dns-query")
        );
        assert_eq!(
            proxy_policy
                .get("copied.example")
                .and_then(serde_yaml_ng::Value::as_str),
            Some("https://copied.example/dns-query")
        );
    }

    #[test]
    fn nameserver_policy_is_not_mirrored_without_proxy_resolver() {
        let config = mapping(
            r"{dns: {proxy-server-nameserver: [],
                nameserver-policy: {node.example: https://private.example/dns-query}}}",
        );

        let result = reconcile_proxy_nameserver_policy(config, true);
        assert!(
            result
                .get("dns")
                .and_then(|value| value.get("proxy-server-nameserver-policy"))
                .is_none()
        );
    }

    #[test]
    fn nameserver_policy_is_not_mirrored_when_dns_overwrite_is_off() {
        let config = mapping(
            r"{dns: {proxy-server-nameserver: [https://dns.alidns.com/dns-query],
                nameserver-policy: {node.example: https://private.example/dns-query}}}",
        );

        let result = reconcile_proxy_nameserver_policy(config, false);
        assert!(
            result
                .get("dns")
                .and_then(|value| value.get("proxy-server-nameserver-policy"))
                .is_none()
        );
    }

    #[test]
    fn proxy_policy_mirror_filters_routed_dns_but_keeps_parameters() {
        let config = mapping(
            r#"{dns: {proxy-server-nameserver: [https://dns.alidns.com/dns-query],
                nameserver-policy: {
                    routed.example: "https://dns.example/dns-query#Proxy Group",
                    rules.example: "https://dns.example/dns-query#RULES",
                    params.example: "https://dns.example/dns-query#h3=true&ecs=192.0.2.0/24",
                    mixed.example: ["https://dns.example/dns-query#Proxy Group",
                                    "https://direct.example/dns-query",
                                    "https://h3.example/dns-query#h3=true"]},
                proxy-server-nameserver-policy: {
                    explicit.example: "https://explicit.example/dns-query#User Choice"}}}"#,
        );

        let result = reconcile_proxy_nameserver_policy(config, true);
        let policy = result
            .get("dns")
            .and_then(|value| value.get("proxy-server-nameserver-policy"))
            .and_then(serde_yaml_ng::Value::as_mapping)
            .expect("safe and explicit proxy policies should remain");

        assert!(policy.get("routed.example").is_none());
        assert!(policy.get("rules.example").is_none());
        assert!(policy.get("params.example").is_some());
        assert_eq!(
            policy
                .get("mixed.example")
                .and_then(serde_yaml_ng::Value::as_sequence)
                .map(Vec::len),
            Some(2)
        );
        assert_eq!(
            policy.get("explicit.example").and_then(serde_yaml_ng::Value::as_str),
            Some("https://explicit.example/dns-query#User Choice")
        );
    }

    #[test]
    fn proxy_policy_is_removed_when_final_proxy_resolver_is_empty() {
        let config = mapping(
            r"{dns: {proxy-server-nameserver: [],
                proxy-server-nameserver-policy: {node.example: https://dns.example/dns-query}}}",
        );

        let result = reconcile_proxy_nameserver_policy(config, true);
        assert!(
            result
                .get("dns")
                .and_then(|value| value.get("proxy-server-nameserver-policy"))
                .is_none()
        );
    }

    #[test]
    fn remote_dns_policy_also_wins_for_proxy_node_resolution() {
        let config = mapping(
            r"{dns: {proxy-server-nameserver: [https://dns.alidns.com/dns-query],
                proxy-server-nameserver-policy: {node.example: https://local.example/dns-query}}}",
        );
        let remote = mapping("{node.example: https://remote.example/dns-query}");

        let result = merge_remote_dns_policy(config, remote, true);
        assert_eq!(
            result
                .get("dns")
                .and_then(|value| value.get("proxy-server-nameserver-policy"))
                .and_then(|value| value.get("node.example"))
                .and_then(serde_yaml_ng::Value::as_str),
            Some("https://remote.example/dns-query")
        );
    }

    #[test]
    fn remote_routed_dns_is_not_copied_to_proxy_node_resolution() {
        let config = mapping(r"{dns: {proxy-server-nameserver: [https://dns.alidns.com/dns-query]}}");
        let remote = mapping(
            r#"{routed.example: "https://dns.example/dns-query#Proxy Group",
                 direct.example: "https://direct.example/dns-query"}"#,
        );

        let result = merge_remote_dns_policy(config, remote, true);
        let dns = result
            .get("dns")
            .and_then(serde_yaml_ng::Value::as_mapping)
            .expect("DNS should remain configured");

        assert!(
            dns.get("nameserver-policy")
                .and_then(|policy| policy.get("routed.example"))
                .is_some()
        );
        assert!(
            dns.get("proxy-server-nameserver-policy")
                .and_then(|policy| policy.get("routed.example"))
                .is_none()
        );
        assert!(
            dns.get("proxy-server-nameserver-policy")
                .and_then(|policy| policy.get("direct.example"))
                .is_some()
        );
    }

    #[tokio::test]
    async fn manual_overrides_follow_expected_priority() {
        let mut config = mapping(
            r"{global-merge-wins: other, global-script-wins: other, profile-merge-wins: other,
               profile-script-wins: other, nested: {winner: other}, dns: {enable: true}, tun: {enable: true}}",
        );
        let exists_keys = use_keys(&config).collect();
        config.insert("application-only".into(), true.into());

        let global_merge = ChainItem {
            uid: "Merge".into(),
            data: ChainType::Merge(mapping(
                r"{global-merge-wins: global-merge, global-script-wins: global-merge,
                   profile-merge-wins: global-merge, profile-script-wins: global-merge,
                   nested: {winner: global-merge}, dns: {enable: false}, tun: {enable: false}}",
            )),
        };
        let global_script = ChainItem::to_script(
            "Script",
            r#"function main(config) {
              config["global-script-wins"] = "global-script";
              config["profile-merge-wins"] = "global-script";
              config["profile-script-wins"] = "global-script";
              config.nested.winner = "global-script";
              return config;
            }"#,
        );
        let profile_merge = ChainItem {
            uid: "profile-merge".into(),
            data: ChainType::Merge(mapping(
                r"{profile-merge-wins: profile-merge, profile-script-wins: profile-merge,
                   nested: {winner: profile-merge}}",
            )),
        };
        let profile_script = ChainItem::to_script(
            "profile-script",
            r#"function main(config) {
              config["profile-script-wins"] = "profile-script";
              config.nested.winner = "profile-script";
              return config;
            }"#,
        );

        let profile_name = "test-profile".into();
        let (config, exists_keys, result_map) = process_global_items(
            config,
            exists_keys,
            HashMap::new(),
            global_merge,
            global_script,
            &profile_name,
        )
        .await;
        let (config, exists_keys, _) = process_profile_items(
            config,
            exists_keys,
            result_map,
            profile_merge,
            profile_script,
            &profile_name,
        )
        .await;

        let string_value = |key| config.get(key).and_then(serde_yaml_ng::Value::as_str);
        assert_eq!(string_value("global-merge-wins"), Some("global-merge"));
        assert_eq!(string_value("global-script-wins"), Some("global-script"));
        assert_eq!(string_value("profile-merge-wins"), Some("profile-merge"));
        assert_eq!(string_value("profile-script-wins"), Some("profile-script"));
        assert_eq!(
            config
                .get("nested")
                .and_then(|value| value.get("winner"))
                .and_then(serde_yaml_ng::Value::as_str),
            Some("profile-script")
        );
        assert!(!exists_keys.contains(&"application-only".into()));
    }

    #[test]
    fn control_plane_survives_manual_overrides() {
        let app_config = mapping(
            r#"{external-controller: "",
                external-controller-cors: {allow-origins: ["app-only"]},
                mixed-port: 7890, socks-port: 7891, secret: "app-secret", mode: rule, allow-lan: false,
                log-level: info, ipv6: false, unified-delay: true,
                dns: {proxy-server-nameserver: ["1.1.1.1"]}}"#,
        );
        let snapshot = super::snapshot_control_plane(&app_config);

        let hijacked = mapping(
            r#"{external-controller: "0.0.0.0:9090",
                external-controller-cors: {allow-origins: ["*"]},
                mixed-port: 1080, socks-port: 1080, secret: "hijacked", mode: global, allow-lan: true,
                log-level: debug, ipv6: true, unified-delay: false,
                dns: {proxy-server-nameserver: ["8.8.8.8"]}}"#,
        );

        let result = super::enforce_control_plane(hijacked, snapshot);

        let as_str = |key| result.get(key).and_then(serde_yaml_ng::Value::as_str);
        assert_eq!(as_str("external-controller"), Some(""));
        assert_eq!(
            result.get("mixed-port").and_then(serde_yaml_ng::Value::as_u64),
            Some(7890)
        );
        assert_eq!(
            result.get("socks-port").and_then(serde_yaml_ng::Value::as_u64),
            Some(7891)
        );
        assert_eq!(
            result
                .get("external-controller-cors")
                .and_then(|value| value.get("allow-origins"))
                .and_then(serde_yaml_ng::Value::as_sequence)
                .and_then(|seq| seq.first())
                .and_then(serde_yaml_ng::Value::as_str),
            Some("app-only")
        );
        assert_eq!(as_str("secret"), Some("app-secret"));
        assert_eq!(as_str("mode"), Some("rule"));
        assert_eq!(
            result.get("allow-lan").and_then(serde_yaml_ng::Value::as_bool),
            Some(false)
        );
        assert_eq!(as_str("log-level"), Some("info"));
        assert_eq!(result.get("ipv6").and_then(serde_yaml_ng::Value::as_bool), Some(false));
        assert_eq!(
            result.get("unified-delay").and_then(serde_yaml_ng::Value::as_bool),
            Some(true)
        );

        // DNS 数据面不属于顶层控制面。
        assert_eq!(
            result
                .get("dns")
                .and_then(|value| value.get("proxy-server-nameserver"))
                .and_then(serde_yaml_ng::Value::as_sequence)
                .and_then(|seq| seq.first())
                .and_then(serde_yaml_ng::Value::as_str),
            Some("8.8.8.8")
        );
    }

    #[test]
    fn control_plane_removes_reenabled_disabled_port() {
        let app_config = mapping(r"{mixed-port: 7890, mode: rule}");
        let snapshot = super::snapshot_control_plane(&app_config);

        let hijacked = mapping(r"{mixed-port: 7890, mode: rule, socks-port: 1080}");
        let result = super::enforce_control_plane(hijacked, snapshot);

        assert!(!result.contains_key("socks-port"));
        assert_eq!(
            result.get("mixed-port").and_then(serde_yaml_ng::Value::as_u64),
            Some(7890)
        );
    }

    #[test]
    fn dns_ipv6_follows_ui_but_other_dns_stays_overridable() {
        let app_config = mapping(r#"{dns: {ipv6: false, proxy-server-nameserver: ["1.1.1.1"]}}"#);
        let dns_ipv6 = super::snapshot_dns_ipv6(&app_config);

        let hijacked = mapping(r#"{dns: {ipv6: true, proxy-server-nameserver: ["8.8.8.8"]}}"#);
        let result = super::enforce_dns_ipv6(hijacked, dns_ipv6);

        assert_eq!(
            result
                .get("dns")
                .and_then(|value| value.get("ipv6"))
                .and_then(serde_yaml_ng::Value::as_bool),
            Some(false)
        );
        assert_eq!(
            result
                .get("dns")
                .and_then(|value| value.get("proxy-server-nameserver"))
                .and_then(serde_yaml_ng::Value::as_sequence)
                .and_then(|seq| seq.first())
                .and_then(serde_yaml_ng::Value::as_str),
            Some("8.8.8.8")
        );
    }

    #[test]
    fn snapshot_control_plane_skips_absent_keys() {
        let app_config = mapping(r"{mode: rule, mixed-port: 7890}");
        let snapshot = super::snapshot_control_plane(&app_config);
        assert!(snapshot.contains_key("mode"));
        assert!(snapshot.contains_key("mixed-port"));
        assert!(!snapshot.contains_key("secret"));
        assert!(!snapshot.contains_key("allow-lan"));
    }

    #[test]
    fn remove_missing_proxies_from_groups() {
        let config_str = r#"
proxies:
  - name: "alive-node"
    type: ss
proxy-groups:
  - name: "manual"
    type: select
    proxies:
      - "alive-node"
      - "missing-node"
      - "DIRECT"
  - name: "nested"
    type: select
    proxies:
      - "manual"
      - "ghost"
"#;

        let mut config: serde_yaml_ng::Mapping =
            serde_yaml_ng::from_str(config_str).expect("Failed to parse test yaml");
        config = cleanup_proxy_groups(config);

        let groups = config
            .get("proxy-groups")
            .and_then(|v| v.as_sequence())
            .cloned()
            .expect("proxy-groups should be a sequence");

        let manual_group = groups
            .iter()
            .find(|group| group.get("name").and_then(serde_yaml_ng::Value::as_str) == Some("manual"))
            .and_then(|group| group.as_mapping())
            .expect("manual group should exist");

        let manual_proxies = manual_group
            .get("proxies")
            .and_then(|v| v.as_sequence())
            .expect("manual proxies should be a sequence");

        assert_eq!(manual_proxies.len(), 2);
        assert!(manual_proxies.iter().any(|p| p.as_str() == Some("alive-node")));
        assert!(manual_proxies.iter().any(|p| p.as_str() == Some("DIRECT")));

        let nested_group = groups
            .iter()
            .find(|group| group.get("name").and_then(serde_yaml_ng::Value::as_str) == Some("nested"))
            .and_then(|group| group.as_mapping())
            .expect("nested group should exist");

        let nested_proxies = nested_group
            .get("proxies")
            .and_then(|v| v.as_sequence())
            .expect("nested proxies should be a sequence");

        assert_eq!(nested_proxies.len(), 1);
        assert_eq!(nested_proxies[0].as_str(), Some("manual"));
    }

    #[test]
    fn keep_provider_backed_groups_intact() {
        let config_str = r#"
proxy-providers:
  providerA:
    type: http
    url: https://example.com
    path: ./providerA.yaml
proxies: []
proxy-groups:
  - name: "manual"
    type: select
    use:
      - "providerA"
      - "ghostProvider"
    proxies:
      - "dynamic-node"
      - "DIRECT"
"#;

        let mut config: serde_yaml_ng::Mapping =
            serde_yaml_ng::from_str(config_str).expect("Failed to parse test yaml");
        config = cleanup_proxy_groups(config);

        let groups = config
            .get("proxy-groups")
            .and_then(|v| v.as_sequence())
            .cloned()
            .expect("proxy-groups should be a sequence");

        let manual_group = groups
            .iter()
            .find(|group| group.get("name").and_then(serde_yaml_ng::Value::as_str) == Some("manual"))
            .and_then(|group| group.as_mapping())
            .expect("manual group should exist");

        let uses = manual_group
            .get("use")
            .and_then(|v| v.as_sequence())
            .expect("use should be a sequence");
        assert_eq!(uses.len(), 1);
        assert_eq!(uses[0].as_str(), Some("providerA"));

        let proxies = manual_group
            .get("proxies")
            .and_then(|v| v.as_sequence())
            .expect("proxies should be a sequence");
        assert_eq!(proxies.len(), 2);
        assert!(proxies.iter().any(|p| p.as_str() == Some("dynamic-node")));
        assert!(proxies.iter().any(|p| p.as_str() == Some("DIRECT")));
    }

    #[test]
    fn prune_invalid_provider_and_proxies_without_provider() {
        let config_str = r#"
proxy-groups:
  - name: "manual"
    type: select
    use:
      - "ghost-provider"
    proxies:
      - "ghost-node"
      - "DIRECT"
"#;

        let mut config: serde_yaml_ng::Mapping =
            serde_yaml_ng::from_str(config_str).expect("Failed to parse test yaml");
        config = cleanup_proxy_groups(config);

        let groups = config
            .get("proxy-groups")
            .and_then(|v| v.as_sequence())
            .cloned()
            .expect("proxy-groups should be a sequence");

        let manual_group = groups
            .iter()
            .find(|group| group.get("name").and_then(serde_yaml_ng::Value::as_str) == Some("manual"))
            .and_then(|group| group.as_mapping())
            .expect("manual group should exist");

        let uses = manual_group
            .get("use")
            .and_then(|v| v.as_sequence())
            .expect("use should be a sequence");
        assert_eq!(uses.len(), 0);

        let proxies = manual_group
            .get("proxies")
            .and_then(|v| v.as_sequence())
            .expect("proxies should be a sequence");
        assert_eq!(proxies.len(), 1);
        assert_eq!(proxies[0].as_str(), Some("DIRECT"));
    }
}
