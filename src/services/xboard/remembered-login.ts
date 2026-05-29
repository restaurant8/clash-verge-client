const STORAGE_KEY = 'muacloud.remembered-login.v1'
const KEY_STORAGE_KEY = 'muacloud.remembered-login-key.v1'

export interface RememberedLogin {
  email: string
  password: string
}

interface StoredRememberedLogin {
  version: 1
  iv: string
  data: string
}

const toBase64 = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...Array.from(bytes)))

const fromBase64 = (value: string) =>
  Uint8Array.from(atob(value), (char) => char.charCodeAt(0))

const getCrypto = () => globalThis.crypto

const getKeyBytes = () => {
  const existing = localStorage.getItem(KEY_STORAGE_KEY)
  if (existing) return fromBase64(existing)

  const bytes = new Uint8Array(32)
  getCrypto().getRandomValues(bytes)
  localStorage.setItem(KEY_STORAGE_KEY, toBase64(bytes))
  return bytes
}

const importStorageKey = async (usage: KeyUsage[]) => {
  const subtle = getCrypto()?.subtle
  if (!subtle) throw new Error('Secure password storage is not available')

  return subtle.importKey('raw', getKeyBytes(), 'AES-GCM', false, usage)
}

export const clearRememberedLogin = () => {
  localStorage.removeItem(STORAGE_KEY)
}

export const saveRememberedLogin = async (email: string, password: string) => {
  const normalizedEmail = email.trim()
  if (!normalizedEmail || !password) {
    clearRememberedLogin()
    return
  }

  const subtle = getCrypto()?.subtle
  if (!subtle) throw new Error('Secure password storage is not available')

  const iv = new Uint8Array(12)
  getCrypto().getRandomValues(iv)
  const key = await importStorageKey(['encrypt'])
  const data = new TextEncoder().encode(
    JSON.stringify({ email: normalizedEmail, password }),
  )
  const encrypted = await subtle.encrypt({ name: 'AES-GCM', iv }, key, data)

  const payload: StoredRememberedLogin = {
    version: 1,
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(encrypted)),
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
}

export const readRememberedLogin =
  async (): Promise<RememberedLogin | null> => {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null

    try {
      const payload = JSON.parse(raw) as StoredRememberedLogin
      if (payload.version !== 1 || !payload.iv || !payload.data) {
        clearRememberedLogin()
        return null
      }

      const subtle = getCrypto()?.subtle
      if (!subtle) return null

      const key = await importStorageKey(['decrypt'])
      const decrypted = await subtle.decrypt(
        { name: 'AES-GCM', iv: fromBase64(payload.iv) },
        key,
        fromBase64(payload.data),
      )
      const remembered = JSON.parse(
        new TextDecoder().decode(decrypted),
      ) as RememberedLogin

      if (!remembered.email || !remembered.password) return null
      return remembered
    } catch {
      clearRememberedLogin()
      return null
    }
  }
