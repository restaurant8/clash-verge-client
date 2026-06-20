import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

import { isTauriRuntime } from '@/utils/tauri'

type XboardFetchOptions = RequestInit & {
  connectTimeout?: number
}

export const xboardFetch = async (
  url: string,
  options: XboardFetchOptions = {},
) => {
  const { connectTimeout, ...fetchOptions } = options
  const controller = new AbortController()
  const externalSignal = fetchOptions.signal
  const abortFromExternalSignal = () => controller.abort()

  if (externalSignal?.aborted) {
    controller.abort()
  } else {
    externalSignal?.addEventListener('abort', abortFromExternalSignal, {
      once: true,
    })
  }

  const timeoutId = connectTimeout
    ? window.setTimeout(() => controller.abort(), connectTimeout)
    : undefined

  try {
    if (isTauriRuntime()) {
      return await tauriFetch(url, {
        ...fetchOptions,
        connectTimeout,
        signal: controller.signal,
      })
    }

    return await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    })
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId)
    externalSignal?.removeEventListener('abort', abortFromExternalSignal)
  }
}
