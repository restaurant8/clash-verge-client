import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

import { isTauriRuntime } from '@/utils/tauri'

type XboardFetchOptions = RequestInit & {
  connectTimeout?: number
}

export const xboardFetch = async (
  url: string,
  options: XboardFetchOptions = {},
) => {
  if (isTauriRuntime()) {
    return tauriFetch(url, options)
  }

  const { connectTimeout, ...fetchOptions } = options
  const controller =
    connectTimeout && typeof AbortController !== 'undefined'
      ? new AbortController()
      : undefined

  const timeoutId =
    controller && connectTimeout
      ? window.setTimeout(() => controller.abort(), connectTimeout)
      : undefined

  try {
    return await fetch(url, {
      ...fetchOptions,
      signal: controller?.signal ?? fetchOptions.signal,
    })
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId)
  }
}
