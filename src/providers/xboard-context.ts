import { createContext, use } from 'react'

import type { XboardApiClient } from '@/services/xboard/api'
import type {
  XboardConnectionState,
  XboardRecord,
  XboardResourceCache,
  XboardResolvedConfig,
  XboardSession,
} from '@/services/xboard/types'

export interface XboardContextValue {
  remote: XboardResolvedConfig
  client: XboardApiClient
  session: XboardSession | null
  userInfo?: XboardRecord
  subscribeInfo?: XboardRecord
  servers: XboardRecord[]
  appConfig?: XboardRecord
  notices: XboardRecord[]
  resourceCache: XboardResourceCache
  booting: boolean
  refreshing: boolean
  connection: XboardConnectionState
  lastError?: string
  refreshRemoteConfig: (force?: boolean) => Promise<XboardResolvedConfig>
  refreshAccount: () => Promise<void>
  loadPlans: (force?: boolean) => Promise<void>
  loadOrders: (force?: boolean) => Promise<void>
  loadTickets: (force?: boolean) => Promise<void>
  loadTicketDetail: (id: string, force?: boolean) => Promise<void>
  loadActiveSessions: (force?: boolean) => Promise<void>
  loadTrafficLogs: (force?: boolean) => Promise<void>
  login: (email: string, password: string) => Promise<void>
  register: (payload: Record<string, unknown>) => Promise<void>
  logout: () => void
  connect: () => Promise<void>
  disconnect: () => Promise<void>
}

export const XboardContext = createContext<XboardContextValue | null>(null)

export const useXboard = () => {
  const value = use(XboardContext)
  if (!value) {
    throw new Error('Service context is not available')
  }
  return value
}
