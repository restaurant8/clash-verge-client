import { useEffect, useMemo } from 'react'

import { useXboard } from '@/providers/xboard-context'
import getSystem from '@/utils/get-system'

declare global {
  interface Window {
    $crisp?: Array<unknown>
    CRISP_WEBSITE_ID?: string
  }
}

const CRISP_SCRIPT_ID = 'muacloud-crisp-chat'

const normalizeCrispId = (value: unknown) => String(value ?? '').trim()

const cleanText = (value: unknown, fallback: string) => {
  const text = String(value ?? '').trim()
  if (!text || /x\s*board|xborad/i.test(text)) return fallback
  return text
}

const pushCrisp = (command: unknown[]) => {
  window.$crisp = window.$crisp ?? []
  window.$crisp.push(command)
}

export const CrispSupport = () => {
  const { remote, session } = useXboard()

  const crispId = useMemo(
    () =>
      normalizeCrispId(
        remote.remoteConfig.crisp_id ??
          remote.bootstrap?.remote_config?.crisp_id ??
          remote.bootstrap?.support?.crisp_id,
      ),
    [
      remote.bootstrap?.remote_config?.crisp_id,
      remote.bootstrap?.support?.crisp_id,
      remote.remoteConfig.crisp_id,
    ],
  )
  const appName = useMemo(
    () => cleanText(remote.remoteConfig.APP_NAME, 'MuaCloud'),
    [remote.remoteConfig.APP_NAME],
  )

  useEffect(() => {
    if (!crispId) {
      window.$crisp?.push?.(['do', 'chat:hide'])
      return
    }

    window.CRISP_WEBSITE_ID = crispId
    pushCrisp(['do', 'chat:show'])

    if (session?.email) {
      pushCrisp(['set', 'user:email', [session.email]])
      pushCrisp(['set', 'user:nickname', [session.email]])
    }

    const systemName = getSystem()
    const clientType = `${systemName}_client`
    pushCrisp([
      'set',
      'session:data',
      [
        [
          ['email', session?.email ?? ''],
          ['client_name', appName],
          ['client_type', clientType],
          ['auth_state', session ? 'signed_in' : 'guest'],
          ['system_type', systemName],
        ],
      ],
    ])

    if (!document.getElementById(CRISP_SCRIPT_ID)) {
      const script = document.createElement('script')
      script.id = CRISP_SCRIPT_ID
      script.src = 'https://client.crisp.chat/l.js'
      script.async = true
      document.head.appendChild(script)
    }
  }, [appName, crispId, session])

  return null
}
