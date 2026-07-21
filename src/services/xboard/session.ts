import type { XboardSession } from './types'

const SESSION_KEY = 'xboard.session.v1'

export const readXboardSession = (): XboardSession | null => {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const session = JSON.parse(raw) as XboardSession
    if (!session?.authData) return null
    return {
      ...session,
      subscribeToken:
        typeof session.subscribeToken === 'string'
          ? session.subscribeToken
          : '',
    }
  } catch {
    return null
  }
}

export const saveXboardSession = (session: XboardSession) => {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

const SUBSCRIPTION_SYNC_KEY = 'xboard.subscription.lastSyncedAt'

/** Timestamp (ms) of the last successful subscription profile sync, or null. */
export const readSubscriptionSyncAt = (): number | null => {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(SUBSCRIPTION_SYNC_KEY)
    if (!raw) return null
    const value = Number(raw)
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

export const writeSubscriptionSyncAt = (timestamp: number) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SUBSCRIPTION_SYNC_KEY, String(timestamp))
  } catch {
    // ignore storage failures (e.g. private mode quota)
  }
}

export const clearSubscriptionSyncAt = () => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(SUBSCRIPTION_SYNC_KEY)
  } catch {
    // ignore
  }
}

export const clearXboardSession = () => {
  window.localStorage.removeItem(SESSION_KEY)
  clearSubscriptionSyncAt()
}

const OFFLINE_MODE_KEY = 'xboard.offlineMode.v1'

/** 离线模式：不登录账号，直接使用本地订阅（原版订阅模式）。 */
export const readOfflineMode = (): boolean => {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(OFFLINE_MODE_KEY) === '1'
  } catch {
    return false
  }
}

export const saveOfflineMode = (enabled: boolean) => {
  if (typeof window === 'undefined') return
  try {
    if (enabled) {
      window.localStorage.setItem(OFFLINE_MODE_KEY, '1')
    } else {
      window.localStorage.removeItem(OFFLINE_MODE_KEY)
    }
  } catch {
    // ignore storage failures (e.g. private mode quota)
  }
}
