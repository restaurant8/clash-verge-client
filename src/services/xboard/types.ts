export type XboardRecord = Record<string, any>

export interface XboardRemoteConfig extends XboardRecord {
  APP_NAME: string
  login_title: string
  APP_URL: string
  custom_ua: string
  app_logo: string
  oss_url: string
  'domains-api': string
  api_domains: string
  backup_api_domains: string
  subscribe_path: string
  tg_channel: string
  telegram_bot: string
  official_url: string
  invite_domain: string
  crisp_id: string
  imgbb_api_key: string
  /** 远程下发的 dns.nameserver-policy,优先级高于本地 DNS 设置 */
  dns_nameserver_policy: string
  discount_delay_seconds: number
  delay_display_scale: number
  version: string
  update_notes: string
  force_update: boolean
  latest_client_url: string
  windows_version: string
  windows_download_url: string
  windows_update_notes: string
  windows_force_update: boolean
  macos_version: string
  macos_download_url: string
  macos_update_notes: string
  macos_force_update: boolean
  android_version: string
  android_download_url: string
  android_update_notes: string
  android_force_update: boolean
}

export interface XboardBootstrapData extends XboardRecord {
  app_info?: XboardRecord
  features?: XboardRecord
  guest_config?: XboardRecord
  public_ui_config?: XboardRecord
  ui_config?: XboardRecord
  download_urls?: XboardRecord
  remote_config?: Partial<XboardRemoteConfig>
  config_hash?: string
}

export interface XboardResolvedConfig {
  remoteConfig: XboardRemoteConfig
  bootstrap?: XboardBootstrapData
  activeApiDomain: string
  apiDomains: string[]
  apiRequestDomains: string[]
  configSource: string
  fetchedAt: number
  degraded: boolean
  error?: string
}

export interface XboardSession {
  authData: string
  subscribeToken: string
  isAdmin?: boolean
  email?: string
  loggedInAt: number
}

export interface XboardAccountSnapshot {
  session: XboardSession
  userInfo?: XboardRecord
  subscribeInfo?: XboardRecord
  servers: XboardRecord[]
  appConfig?: XboardRecord
  notices: XboardRecord[]
}

export interface XboardResourceCache {
  plans?: XboardRecord[]
  payments?: XboardRecord[]
  orders?: XboardRecord[]
  tickets?: XboardRecord[]
  ticketDetails: Record<string, XboardRecord>
  activeSessions?: XboardRecord[]
  trafficLogs?: XboardRecord[]
}

export interface XboardConnectionState {
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  message?: string
  connectedAt?: number
}

export interface XboardAuthPayload extends XboardRecord {
  auth_data?: string
  token?: string
  is_admin?: boolean
}

export interface XboardOrderCheckoutResult {
  type: number
  data: any
}
