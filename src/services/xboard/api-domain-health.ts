export const XBOARD_API_CDN_TIMEOUT_MS = 2000
export const XBOARD_API_ORIGIN_TIMEOUT_MS = 8000
export const XBOARD_API_CDN_COOLDOWN_MS = 5 * 60 * 1000

const STORAGE_KEY = 'xboard.api-cdn-cooldown.v1'

let cooldowns: Record<string, number> | undefined

const normalizeDomain = (domain: string) => domain.replace(/\/+$/, '')

const readCooldowns = () => {
  if (cooldowns) return cooldowns
  if (typeof window === 'undefined') return (cooldowns = {})

  try {
    cooldowns = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) || '{}',
    ) as Record<string, number>
  } catch {
    cooldowns = {}
  }
  return cooldowns
}

const writeCooldowns = () => {
  if (typeof window === 'undefined' || !cooldowns) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cooldowns))
  } catch {
    // Storage can be unavailable in privacy-restricted webviews.
  }
}

export const isApiCdnCoolingDown = (domain: string, now = Date.now()) => {
  const key = normalizeDomain(domain)
  const state = readCooldowns()
  const cooldownUntil = Number(state[key] || 0)

  if (cooldownUntil > now) return true
  if (key in state) {
    delete state[key]
    writeCooldowns()
  }
  return false
}

export const markApiCdnFailure = (domain: string, now = Date.now()) => {
  const state = readCooldowns()
  state[normalizeDomain(domain)] = now + XBOARD_API_CDN_COOLDOWN_MS
  writeCooldowns()
}

export const clearApiCdnFailure = (domain: string) => {
  const state = readCooldowns()
  const key = normalizeDomain(domain)
  if (!(key in state)) return

  delete state[key]
  writeCooldowns()
}
