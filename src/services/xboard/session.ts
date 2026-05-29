import type { XboardSession } from './types'

const SESSION_KEY = 'xboard.session.v1'

export const readXboardSession = (): XboardSession | null => {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const session = JSON.parse(raw) as XboardSession
    if (!session?.authData || !session?.subscribeToken) return null
    return session
  } catch {
    return null
  }
}

export const saveXboardSession = (session: XboardSession) => {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export const clearXboardSession = () => {
  window.localStorage.removeItem(SESSION_KEY)
}
