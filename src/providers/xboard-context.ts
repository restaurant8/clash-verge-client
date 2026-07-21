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
  /**
   * 首次账号快照（userInfo/subscribeInfo/servers）是否已从远程拉取落地。
   * 启动时用本地缓存会话先进入界面，远程数据到达前该值为 false，
   * UI 应显示"同步中"等中性状态，而不是把空数据当成"待开通/已过期"。
   */
  accountHydrated: boolean
  connection: XboardConnectionState
  lastError?: string
  /**
   * 离线模式：不登录账号，直接使用本地已导入的订阅（原版订阅模式）。
   * 用于登录服务不可用时的兜底通道；登录成功后自动退出该模式。
   */
  offlineMode: boolean
  enterOfflineMode: () => void
  exitOfflineMode: () => void
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
  /**
   * 登出前必须先确认系统代理/TUN 已关闭，再清除会话。
   * 默认（手动登出）关闭失败会取消登出并提示；`force: true` 用于登录态
   * 已在服务端失效的强制登出，无法取消，失败时仅强提示用户手动关闭。
   */
  logout: (options?: { force?: boolean }) => Promise<void>
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
