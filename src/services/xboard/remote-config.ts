import { xboardFetch } from './http'
import type {
  XboardBootstrapData,
  XboardRecord,
  XboardRemoteConfig,
  XboardResolvedConfig,
} from './types'

export const XBOARD_REMOTE_CONFIG_URLS = [
  'https://d1m6vp8arykpci.cloudfront.net/client-config.env',
  'https://raw.githubusercontent.com/muacloud/s3work/main/client-config.env',
  'https://a.pipupipuapi.xyz/client-config.env',
  'https://muafq.xyz/client-config.env',
] as const

export const XBOARD_FALLBACK_API_DOMAIN = 'https://4iox.com'
export const XBOARD_DEFAULT_CRISP_ID = '4010755c-2d1e-42a1-8380-8f4c20fe01c4'

export const XBOARD_SEED_REMOTE_CONFIG: XboardRemoteConfig = {
  APP_NAME: 'MuaCloud',
  login_title: '欢迎使用',
  APP_URL: '',
  custom_ua: 'muacloud/1.0',
  app_logo: '',
  oss_url: '',
  api_domains: XBOARD_FALLBACK_API_DOMAIN,
  backup_api_domains: '',
  subscribe_path: 'link',
  tg_channel: '',
  telegram_bot: '',
  official_url: '',
  invite_domain: '',
  crisp_id: XBOARD_DEFAULT_CRISP_ID,
  imgbb_api_key: '',
  discount_delay_seconds: 0,
  version: '1.0.0',
  update_notes: '',
  force_update: false,
  latest_client_url: '',
}

const CACHE_KEY = 'xboard.remote-config.v2'

const isBrowserStorageReady = () => typeof window !== 'undefined'

const normalizeDomain = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`
  return withScheme.replace(/\/+$/, '')
}

const toBoolean = (value: unknown) => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
  }
  return false
}

const toInteger = (value: unknown, fallback: number) => {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const parseDomainList = (...values: unknown[]) => {
  const domains = values
    .flatMap((value) => String(value ?? '').split(';'))
    .map(normalizeDomain)
    .filter(Boolean)

  return [...new Set(domains)]
}

export const parseEnvConfig = (input: string) => {
  const data: Record<string, string> = {}

  input
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .forEach((rawLine) => {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) return

      const eqIndex = line.indexOf('=')
      if (eqIndex <= 0) return

      const key = line.slice(0, eqIndex).trim()
      let value = line.slice(eqIndex + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      data[key] = value
    })

  return data
}

export const normalizeRemoteConfig = (
  input?: Partial<XboardRemoteConfig> | null,
): XboardRemoteConfig => {
  const merged = {
    ...XBOARD_SEED_REMOTE_CONFIG,
    ...(input ?? {}),
  }

  const apiDomains = parseDomainList(
    merged.api_domains,
    merged.backup_api_domains,
    XBOARD_FALLBACK_API_DOMAIN,
  )

  return {
    ...merged,
    APP_NAME: String(merged.APP_NAME || XBOARD_SEED_REMOTE_CONFIG.APP_NAME),
    login_title: String(
      merged.login_title || XBOARD_SEED_REMOTE_CONFIG.login_title,
    ),
    APP_URL: normalizeDomain(String(merged.APP_URL || '')),
    custom_ua: String(merged.custom_ua || XBOARD_SEED_REMOTE_CONFIG.custom_ua),
    app_logo: String(merged.app_logo || ''),
    oss_url: normalizeDomain(String(merged.oss_url || '')),
    api_domains: apiDomains.join(';'),
    backup_api_domains: String(merged.backup_api_domains || ''),
    subscribe_path: String(
      merged.subscribe_path || XBOARD_SEED_REMOTE_CONFIG.subscribe_path,
    ).replace(/^\/+|\/+$/g, ''),
    tg_channel: String(merged.tg_channel || ''),
    telegram_bot: normalizeDomain(String(merged.telegram_bot || '')),
    official_url: normalizeDomain(String(merged.official_url || '')),
    invite_domain: normalizeDomain(String(merged.invite_domain || '')),
    crisp_id: String(merged.crisp_id || XBOARD_SEED_REMOTE_CONFIG.crisp_id),
    imgbb_api_key: String(merged.imgbb_api_key || ''),
    discount_delay_seconds: toInteger(merged.discount_delay_seconds, 0),
    version: String(merged.version || XBOARD_SEED_REMOTE_CONFIG.version),
    update_notes: String(merged.update_notes || ''),
    force_update: toBoolean(merged.force_update),
    latest_client_url: String(merged.latest_client_url || ''),
  }
}

const readCachedConfig = (): XboardResolvedConfig | null => {
  if (!isBrowserStorageReady()) return null

  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as XboardResolvedConfig
    if (!parsed?.activeApiDomain) return null
    return {
      ...parsed,
      remoteConfig: normalizeRemoteConfig(parsed.remoteConfig),
      apiDomains: parseDomainList(
        parsed.remoteConfig?.api_domains,
        parsed.remoteConfig?.backup_api_domains,
        parsed.activeApiDomain,
      ),
    }
  } catch {
    return null
  }
}

const writeCachedConfig = (config: XboardResolvedConfig) => {
  if (!isBrowserStorageReady()) return
  window.localStorage.setItem(CACHE_KEY, JSON.stringify(config))
}

const fetchText = async (url: string, timeoutMs = 2500) => {
  const response = await xboardFetch(url, {
    method: 'GET',
    connectTimeout: timeoutMs,
    headers: {
      Accept: 'text/plain, application/json;q=0.9, */*;q=0.8',
      'Cache-Control': 'no-cache',
    },
  })

  if (!response.ok) {
    throw new Error(`${url} 返回 ${response.status}`)
  }

  return response.text()
}

const fetchJson = async <T>(url: string, timeoutMs = 2500): Promise<T> => {
  const text = await fetchText(url, timeoutMs)
  return JSON.parse(text) as T
}

const fetchRemoteEnv = async () => {
  let lastError: unknown

  for (const source of XBOARD_REMOTE_CONFIG_URLS) {
    try {
      const text = await fetchText(source)
      return {
        source,
        remoteConfig: normalizeRemoteConfig(parseEnvConfig(text)),
      }
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('远程配置源全部不可达')
}

const unwrapPayloadData = (payload: any) => {
  if (payload?.data && typeof payload.data === 'object') {
    return payload.data
  }
  return payload ?? {}
}

const unwrapBootstrap = (payload: any): XboardBootstrapData => {
  return unwrapPayloadData(payload) as XboardBootstrapData
}

const fetchBootstrap = async (domain: string) => {
  const url = `${domain}/api/v1/app/bootstrap`
  const payload = await fetchJson<any>(url)
  return unwrapBootstrap(payload)
}

const probeDomain = async (domain: string) => {
  try {
    return {
      bootstrap: await fetchBootstrap(domain),
      compatibleOnly: false,
    }
  } catch (bootstrapError) {
    const guestConfig = unwrapPayloadData(
      await fetchJson<any>(`${domain}/api/v1/guest/comm/config`),
    ) as XboardRecord

    return {
      bootstrap: {
        app_info: guestConfig,
        public_ui_config: guestConfig,
        guest_config: guestConfig,
        features: {
          enable_register:
            guestConfig.enable_register ??
            guestConfig.register_enable ??
            guestConfig.is_register,
          stop_register:
            guestConfig.stop_register ?? guestConfig.disable_registration,
          email_gmail_limit_enable:
            guestConfig.email_gmail_limit_enable ??
            guestConfig.gmail_alias_limit ??
            guestConfig.disable_gmail_alias,
          email_verify: guestConfig.email_verify ?? guestConfig.is_email_verify,
          invite_force: guestConfig.invite_force ?? guestConfig.is_invite_force,
          captcha: guestConfig.captcha ?? guestConfig.is_captcha,
          is_captcha:
            guestConfig.is_captcha ??
            guestConfig.captcha_enable ??
            guestConfig.enable_captcha,
          captcha_enable:
            guestConfig.captcha_enable ??
            guestConfig.is_captcha ??
            guestConfig.enable_captcha,
          captcha_type: guestConfig.captcha_type,
          recaptcha_site_key: guestConfig.recaptcha_site_key,
          recaptcha_v3_site_key: guestConfig.recaptcha_v3_site_key,
          turnstile_site_key: guestConfig.turnstile_site_key,
        },
      },
      compatibleOnly: true,
      error: bootstrapError,
    }
  }
}

export const getCachedXboardConfig = () =>
  readCachedConfig() ?? {
    remoteConfig: XBOARD_SEED_REMOTE_CONFIG,
    activeApiDomain: XBOARD_FALLBACK_API_DOMAIN,
    apiDomains: [XBOARD_FALLBACK_API_DOMAIN],
    configSource: 'seed',
    fetchedAt: 0,
    degraded: true,
  }

export const resolveXboardRemoteConfig = async (
  options: { force?: boolean } = {},
): Promise<XboardResolvedConfig> => {
  const cached = readCachedConfig()
  const now = Date.now()

  if (cached && !options.force) {
    return cached
  }

  let configSource = cached?.configSource ?? 'seed'
  let remoteConfig = cached?.remoteConfig ?? XBOARD_SEED_REMOTE_CONFIG
  let remoteError: unknown

  try {
    const remote = await fetchRemoteEnv()
    remoteConfig = remote.remoteConfig
    configSource = remote.source
  } catch (error) {
    remoteError = error
  }

  const apiDomains = parseDomainList(
    remoteConfig.api_domains,
    remoteConfig.backup_api_domains,
    cached?.activeApiDomain,
    XBOARD_FALLBACK_API_DOMAIN,
  )

  let bootstrap: XboardBootstrapData | undefined
  let compatibleOnly = false
  let activeApiDomain = cached?.activeApiDomain
    ? normalizeDomain(cached.activeApiDomain)
    : apiDomains[0]
  let lastApiError: unknown

  for (const domain of apiDomains) {
    try {
      const probe = await probeDomain(domain)
      bootstrap = probe.bootstrap
      compatibleOnly = probe.compatibleOnly
      activeApiDomain = domain

      if (bootstrap?.remote_config) {
        remoteConfig = normalizeRemoteConfig({
          ...remoteConfig,
          ...bootstrap.remote_config,
        })
      }
      break
    } catch (error) {
      lastApiError = error
    }
  }

  const resolvedDomains = parseDomainList(
    remoteConfig.api_domains,
    remoteConfig.backup_api_domains,
    activeApiDomain,
    XBOARD_FALLBACK_API_DOMAIN,
  )

  const result: XboardResolvedConfig = {
    remoteConfig: normalizeRemoteConfig(remoteConfig),
    bootstrap,
    activeApiDomain: activeApiDomain || XBOARD_FALLBACK_API_DOMAIN,
    apiDomains: resolvedDomains,
    configSource,
    fetchedAt: now,
    degraded: !bootstrap || compatibleOnly,
    error:
      !bootstrap && (remoteError || lastApiError)
        ? String((remoteError || lastApiError) as Error)
        : undefined,
  }

  if (bootstrap || !cached) {
    writeCachedConfig(result)
  }

  return bootstrap || !cached ? result : { ...cached, error: result.error }
}
