import { listen, type EventCallback } from '@tauri-apps/api/event'
import { useCallback } from 'react'

import { isTauriRuntime } from '@/utils/tauri'

export const useListen = () => {
  const addListener = useCallback(
    async <T>(eventName: string, handler: EventCallback<T>) => {
      if (!isTauriRuntime()) return () => {}
      return await listen(eventName, handler)
    },
    [],
  )

  return {
    addListener,
  }
}
