import { xboardFetch } from './http'
import type { XboardRemoteConfig, XboardResolvedConfig } from './types'

export const XBOARD_REMOTE_CONFIG_URLS = [
  'https://d1m6vp8arykpci.cloudfront.net/client-config.env',
  'https://raw.githubusercontent.com/muacloud/s3work/main/client-config.env',
  'https://a.4iox.com/client-config.env',
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
  'domains-api': '',
  api_domains: XBOARD_FALLBACK_API_DOMAIN,
  backup_api_domains: '',
  subscribe_path: 'link',
  tg_channel: '',
  telegram_bot: '',
  official_url: '',
  invite_domain: '',
  crisp_id: XBOARD_DEFAULT_CRISP_ID,
  imgbb_api_key: '',
  dns_nameserver_policy: '',
  discount_delay_seconds: 0,
  delay_display_scale: 0.5,
  version: '1.0.0',
  update_notes: '',
  force_update: false,
  latest_client_url: '',
  windows_version: '',
  windows_download_url: '',
  windows_update_notes: '',
  windows_force_update: false,
  macos_version: '',
  macos_download_url: '',
  macos_update_notes: '',
  macos_force_update: false,
  android_version: '',
  android_download_url: '',
  android_update_notes: '',
  android_force_update: false,
}

const CACHE_KEY = 'xboard.remote-config.v3'

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

const toNumber = (value: unknown, fallback: number) => {
  const parsed = Number.parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : fallback
}

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const firstConfigValue = (...values: unknown[]) =>
  values.find((value) => value !== undefined && value !== null && value !== '')

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

  const acceleratedApiDomains = parseDomainList(merged['domains-api'])
  const apiDomains = parseDomainList(
    merged.api_domains,
    XBOARD_FALLBACK_API_DOMAIN,
  )
  const backupApiDomains = parseDomainList(merged.backup_api_domains)

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
    'domains-api': acceleratedApiDomains.join(';'),
    api_domains: apiDomains.join(';'),
    backup_api_domains: backupApiDomains.join(';'),
    subscribe_path: String(
      merged.subscribe_path || XBOARD_SEED_REMOTE_CONFIG.subscribe_path,
    ).replace(/^\/+|\/+$/g, ''),
    tg_channel: String(merged.tg_channel || ''),
    telegram_bot: normalizeDomain(String(merged.telegram_bot || '')),
    official_url: normalizeDomain(String(merged.official_url || '')),
    invite_domain: normalizeDomain(String(merged.invite_domain || '')),
    crisp_id: String(merged.crisp_id || XBOARD_SEED_REMOTE_CONFIG.crisp_id),
    imgbb_api_key: String(merged.imgbb_api_key || ''),
    dns_nameserver_policy: String(merged.dns_nameserver_policy || ''),
    discount_delay_seconds: toInteger(merged.discount_delay_seconds, 0),
    delay_display_scale: clampNumber(
      toNumber(
        merged.delay_display_scale,
        XBOARD_SEED_REMOTE_CONFIG.delay_display_scale,
      ),
      0.1,
      1,
    ),
    version: String(merged.version || XBOARD_SEED_REMOTE_CONFIG.version),
    update_notes: String(merged.update_notes || ''),
    force_update: toBoolean(merged.force_update),
    latest_client_url: String(merged.latest_client_url || ''),
    windows_version: String(merged.windows_version || merged.version || ''),
    windows_download_url: String(
      merged.windows_download_url || merged.latest_client_url || '',
    ),
    windows_update_notes: String(
      merged.windows_update_notes || merged.update_notes || '',
    ),
    windows_force_update: toBoolean(
      firstConfigValue(input?.windows_force_update, merged.force_update),
    ),
    macos_version: String(merged.macos_version || merged.version || ''),
    macos_download_url: String(
      merged.macos_download_url || merged.latest_client_url || '',
    ),
    macos_update_notes: String(
      merged.macos_update_notes || merged.update_notes || '',
    ),
    macos_force_update: toBoolean(
      firstConfigValue(input?.macos_force_update, merged.force_update),
    ),
    android_version: String(merged.android_version || merged.version || ''),
    android_download_url: String(
      merged.android_download_url || merged.latest_client_url || '',
    ),
    android_update_notes: String(
      merged.android_update_notes || merged.update_notes || '',
    ),
    android_force_update: toBoolean(
      firstConfigValue(input?.android_force_update, merged.force_update),
    ),
  }
}

const readCachedConfig = (): XboardResolvedConfig | null => {
  if (!isBrowserStorageReady()) return null

  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as XboardResolvedConfig
    if (!parsed?.activeApiDomain) return null
    const remoteConfig = normalizeRemoteConfig(parsed.remoteConfig)
    const apiDomains = parseDomainList(
      remoteConfig.api_domains,
      remoteConfig.backup_api_domains,
      parsed.activeApiDomain,
    )
    const apiRequestDomains = parseDomainList(
      remoteConfig['domains-api'],
      apiDomains,
    )
    return {
      ...parsed,
      remoteConfig,
      activeApiDomain: apiDomains.includes(parsed.activeApiDomain)
        ? parsed.activeApiDomain
        : apiDomains[0],
      apiDomains,
      apiRequestDomains,
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

const fetchRemoteEnv = async () => {
  let lastError: unknown

  for (const source of XBOARD_REMOTE_CONFIG_URLS) {
    try {
      const text = await fetchText(source)
      const parsed = parseEnvConfig(text)
      if (
        !String(parsed['domains-api'] || '').trim() &&
        !String(parsed.api_domains || '').trim()
      ) {
        throw new Error(`${source} 缺少 domains-api 或 api_domains`)
      }
      return {
        source,
        remoteConfig: normalizeRemoteConfig(parsed),
      }
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('远程配置源全部不可达')
}

export const getCachedXboardConfig = () =>
  readCachedConfig() ?? {
    remoteConfig: XBOARD_SEED_REMOTE_CONFIG,
    activeApiDomain: XBOARD_FALLBACK_API_DOMAIN,
    apiDomains: [XBOARD_FALLBACK_API_DOMAIN],
    apiRequestDomains: [XBOARD_FALLBACK_API_DOMAIN],
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
  let remoteError: string | undefined
  try {
    const remote = await fetchRemoteEnv()
    remoteConfig = remote.remoteConfig
    configSource = remote.source
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (cached) {
      return { ...cached, degraded: true, error: message }
    }
    remoteError = message
  }

  const normalizedRemoteConfig = normalizeRemoteConfig(remoteConfig)
  const apiDomains = parseDomainList(
    normalizedRemoteConfig.api_domains,
    normalizedRemoteConfig.backup_api_domains,
    cached?.activeApiDomain,
    XBOARD_FALLBACK_API_DOMAIN,
  )
  const apiRequestDomains = parseDomainList(
    normalizedRemoteConfig['domains-api'],
    apiDomains,
  )
  const result: XboardResolvedConfig = {
    remoteConfig: normalizedRemoteConfig,
    activeApiDomain: apiDomains[0] || XBOARD_FALLBACK_API_DOMAIN,
    apiDomains,
    apiRequestDomains,
    configSource,
    fetchedAt: now,
    degraded: configSource === 'seed',
    error: remoteError,
  }

  if (configSource !== 'seed') writeCachedConfig(result)
  return result
}
