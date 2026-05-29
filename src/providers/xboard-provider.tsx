import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react'

import { stopCore } from '@/services/cmds'
import { setDelayDisplayScale } from '@/services/delay'
import { showNotice } from '@/services/notice-service'
import { XboardApiClient } from '@/services/xboard/api'
import {
  getCachedXboardConfig,
  resolveXboardRemoteConfig,
} from '@/services/xboard/remote-config'
import {
  clearXboardSession,
  readXboardSession,
  saveXboardSession,
} from '@/services/xboard/session'
import {
  ensureXboardSubscriptionProfile,
  restartCoreForXboard,
} from '@/services/xboard/subscription'
import type {
  XboardAccountSnapshot,
  XboardAuthPayload,
  XboardConnectionState,
  XboardRecord,
  XboardResourceCache,
  XboardResolvedConfig,
  XboardSession,
} from '@/services/xboard/types'

import { XboardContext } from './xboard-context'

const asArray = (value: any): XboardRecord[] => {
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.data)) return value.data
  if (Array.isArray(value?.items)) return value.items
  return []
}

const extractAuthPayload = (payload: XboardAuthPayload) => {
  const data =
    payload?.data && typeof payload.data === 'object' ? payload.data : payload
  return data as XboardAuthPayload
}

const extractSubscribeToken = (...values: any[]) => {
  for (const value of values) {
    if (!value) continue
    if (typeof value === 'string' && value) return value
    if (typeof value.token === 'string' && value.token) return value.token
    if (typeof value.subscribe_token === 'string' && value.subscribe_token) {
      return value.subscribe_token
    }
    if (typeof value.subscribe_url === 'string') {
      const match = value.subscribe_url.match(/token=([^&]+)/)
      if (match?.[1]) return decodeURIComponent(match[1])
    }
  }
  return ''
}

const createEmptyResourceCache = (): XboardResourceCache => ({
  ticketDetails: {},
})

const buildClient = (remote: XboardResolvedConfig) =>
  new XboardApiClient(
    remote.activeApiDomain,
    remote.remoteConfig.custom_ua || 'muacloud/1.0',
  )

const loadAccountSnapshot = async (
  client: XboardApiClient,
  session: XboardSession,
): Promise<XboardAccountSnapshot> => {
  await client.checkLogin(session.authData)

  const [userInfo, subscribeInfo] = await Promise.all([
    client.userInfo(session.authData).catch((error) => ({ error })),
    client.getSubscribe(session.authData).catch((error) => ({ error })),
  ])

  const subscribeToken = extractSubscribeToken(
    subscribeInfo,
    session.subscribeToken,
  )

  const nextSession = {
    ...session,
    subscribeToken,
    email: userInfo?.email ?? userInfo?.user?.email ?? session.email,
  }

  const [serverPayload, appConfig, noticePayload] = await Promise.all([
    client.fetchServers(session.authData).catch(() => []),
    subscribeToken
      ? client.appConfig(subscribeToken).catch(() => undefined)
      : undefined,
    client.notices(session.authData).catch(() => []),
  ])

  return {
    session: nextSession,
    userInfo,
    subscribeInfo,
    servers: asArray(serverPayload),
    appConfig,
    notices: asArray(noticePayload),
  }
}

export const XboardProvider = ({ children }: { children: ReactNode }) => {
  const [remote, setRemote] = useState<XboardResolvedConfig>(() =>
    getCachedXboardConfig(),
  )
  const [session, setSession] = useState<XboardSession | null>(() =>
    readXboardSession(),
  )
  const [userInfo, setUserInfo] = useState<XboardRecord | undefined>()
  const [subscribeInfo, setSubscribeInfo] = useState<XboardRecord | undefined>()
  const [servers, setServers] = useState<XboardRecord[]>([])
  const [appConfig, setAppConfig] = useState<XboardRecord | undefined>()
  const [notices, setNotices] = useState<XboardRecord[]>([])
  const [resourceCache, setResourceCache] = useState<XboardResourceCache>(() =>
    createEmptyResourceCache(),
  )
  const [booting, setBooting] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastError, setLastError] = useState<string | undefined>()
  const [connection, setConnection] = useState<XboardConnectionState>({
    status: 'disconnected',
  })

  const client = useMemo(() => buildClient(remote), [remote])

  useEffect(() => {
    setDelayDisplayScale(remote.remoteConfig.delay_display_scale)
  }, [remote.remoteConfig.delay_display_scale])

  const refreshRemoteConfig = useCallback(async (force = false) => {
    const next = await resolveXboardRemoteConfig({ force })
    setRemote(next)
    return next
  }, [])

  const clearResourceCache = useCallback(() => {
    setResourceCache(createEmptyResourceCache())
  }, [])

  const applySnapshot = useCallback((snapshot: XboardAccountSnapshot) => {
    setSession(snapshot.session)
    saveXboardSession(snapshot.session)
    setUserInfo(snapshot.userInfo)
    setSubscribeInfo(snapshot.subscribeInfo)
    setServers(snapshot.servers)
    setAppConfig(snapshot.appConfig)
    setNotices(snapshot.notices)
  }, [])

  const logout = useCallback(() => {
    clearXboardSession()
    setSession(null)
    setUserInfo(undefined)
    setSubscribeInfo(undefined)
    setServers([])
    setAppConfig(undefined)
    setNotices([])
    setConnection({ status: 'disconnected' })
    clearResourceCache()
  }, [clearResourceCache])

  const refreshAccount = useCallback(async () => {
    if (!session) return
    setRefreshing(true)
    setLastError(undefined)
    try {
      const snapshot = await loadAccountSnapshot(client, session)
      applySnapshot(snapshot)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setLastError(message)
      logout()
      showNotice.error(`登录状态失效：${message}`)
    } finally {
      setRefreshing(false)
    }
  }, [applySnapshot, client, logout, session])

  const loadPlans = useCallback(
    async (force = false) => {
      if (!session) return
      if (!force && resourceCache.plans && resourceCache.payments) return

      const [planPayload, paymentPayload] = await Promise.all([
        client.plans(session.authData),
        client.paymentMethods(session.authData).catch(() => []),
      ])

      setResourceCache((prev) => ({
        ...prev,
        plans: asArray(planPayload),
        payments: asArray(paymentPayload),
      }))
    },
    [client, resourceCache.payments, resourceCache.plans, session],
  )

  const loadOrders = useCallback(
    async (force = false) => {
      if (!session) return
      if (!force && resourceCache.orders) return

      const orders = asArray(await client.orders(session.authData))
      setResourceCache((prev) => ({
        ...prev,
        orders,
      }))
    },
    [client, resourceCache.orders, session],
  )

  const loadTickets = useCallback(
    async (force = false) => {
      if (!session) return
      if (!force && resourceCache.tickets) return

      const tickets = asArray(await client.tickets(session.authData))
      setResourceCache((prev) => ({
        ...prev,
        tickets,
      }))
    },
    [client, resourceCache.tickets, session],
  )

  const loadTicketDetail = useCallback(
    async (id: string, force = false) => {
      if (!session || !id) return
      if (!force && resourceCache.ticketDetails[id]) return

      const detail = await client.tickets(session.authData, id)
      setResourceCache((prev) => ({
        ...prev,
        ticketDetails: {
          ...prev.ticketDetails,
          [id]: detail,
        },
      }))
    },
    [client, resourceCache.ticketDetails, session],
  )

  const loadActiveSessions = useCallback(
    async (force = false) => {
      if (!session) return
      if (!force && resourceCache.activeSessions) return

      const activeSessions = asArray(
        await client.activeSessions(session.authData),
      )
      setResourceCache((prev) => ({
        ...prev,
        activeSessions,
      }))
    },
    [client, resourceCache.activeSessions, session],
  )

  const loadTrafficLogs = useCallback(
    async (force = false) => {
      if (!session) return
      if (!force && resourceCache.trafficLogs) return

      const trafficLogs = asArray(await client.trafficLogs(session.authData))
      setResourceCache((prev) => ({
        ...prev,
        trafficLogs,
      }))
    },
    [client, resourceCache.trafficLogs, session],
  )

  const login = useCallback(
    async (email: string, password: string) => {
      setRefreshing(true)
      setLastError(undefined)
      try {
        const payload = extractAuthPayload(await client.login(email, password))
        const authData = payload.auth_data
        const subscribeToken = extractSubscribeToken(payload)

        if (!authData || !subscribeToken) {
          throw new Error('登录响应缺少 auth_data 或 token')
        }

        const nextSession: XboardSession = {
          authData,
          subscribeToken,
          isAdmin: Boolean(payload.is_admin),
          email,
          loggedInAt: Date.now(),
        }
        const snapshot = await loadAccountSnapshot(client, nextSession)
        clearResourceCache()
        applySnapshot(snapshot)
        showNotice.success('登录成功')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setLastError(message)
        showNotice.error(message)
        throw error
      } finally {
        setRefreshing(false)
      }
    },
    [applySnapshot, clearResourceCache, client],
  )

  const register = useCallback(
    async (payload: Record<string, unknown>) => {
      setRefreshing(true)
      setLastError(undefined)
      try {
        const authPayload = extractAuthPayload(await client.register(payload))
        const authData = authPayload.auth_data
        const subscribeToken = extractSubscribeToken(authPayload)

        if (!authData || !subscribeToken) {
          throw new Error('注册响应缺少 auth_data 或 token')
        }

        const nextSession: XboardSession = {
          authData,
          subscribeToken,
          isAdmin: Boolean(authPayload.is_admin),
          email: String(payload.email ?? ''),
          loggedInAt: Date.now(),
        }
        const snapshot = await loadAccountSnapshot(client, nextSession)
        clearResourceCache()
        applySnapshot(snapshot)
        showNotice.success('注册成功')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setLastError(message)
        showNotice.error(message)
        throw error
      } finally {
        setRefreshing(false)
      }
    },
    [applySnapshot, clearResourceCache, client],
  )

  const connect = useCallback(async () => {
    if (!session) {
      showNotice.error('请先登录')
      throw new Error('请先登录')
    }

    setConnection({ status: 'connecting', message: '正在校验订阅与节点' })
    setRefreshing(true)
    try {
      const snapshot = await loadAccountSnapshot(client, session)
      applySnapshot(snapshot)

      if (!snapshot.session.subscribeToken) {
        throw new Error('当前账号没有订阅 token')
      }
      if (!snapshot.servers.length) {
        throw new Error('当前账号没有可用节点，请先购买套餐或联系客服')
      }

      await ensureXboardSubscriptionProfile(
        client,
        snapshot.session.subscribeToken,
        remote.remoteConfig,
        snapshot.subscribeInfo,
      )
      await restartCoreForXboard()

      setConnection({
        status: 'connected',
        message: '已通过权益校验并加载订阅',
        connectedAt: Date.now(),
      })
      showNotice.success('连接已启动')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setConnection({ status: 'error', message })
      setLastError(message)
      showNotice.error(message)
      throw error
    } finally {
      setRefreshing(false)
    }
  }, [applySnapshot, client, remote.remoteConfig, session])

  const disconnect = useCallback(async () => {
    await stopCore()
    setConnection({ status: 'disconnected' })
    showNotice.info('已断开连接')
  }, [])

  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      try {
        const nextRemote = await refreshRemoteConfig(true)
        if (cancelled) return
        const storedSession = readXboardSession()
        if (storedSession) {
          const snapshot = await loadAccountSnapshot(
            buildClient(nextRemote),
            storedSession,
          )
          if (!cancelled) applySnapshot(snapshot)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!cancelled) setLastError(message)
      } finally {
        if (!cancelled) setBooting(false)
      }
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [applySnapshot, refreshRemoteConfig])

  const value = useMemo(
    () => ({
      remote,
      client,
      session,
      userInfo,
      subscribeInfo,
      servers,
      appConfig,
      notices,
      resourceCache,
      booting,
      refreshing,
      connection,
      lastError,
      refreshRemoteConfig,
      refreshAccount,
      loadPlans,
      loadOrders,
      loadTickets,
      loadTicketDetail,
      loadActiveSessions,
      loadTrafficLogs,
      login,
      register,
      logout,
      connect,
      disconnect,
    }),
    [
      appConfig,
      booting,
      client,
      connect,
      connection,
      disconnect,
      lastError,
      loadActiveSessions,
      loadOrders,
      loadPlans,
      loadTicketDetail,
      loadTickets,
      loadTrafficLogs,
      login,
      logout,
      notices,
      refreshAccount,
      refreshRemoteConfig,
      refreshing,
      register,
      remote,
      resourceCache,
      servers,
      session,
      subscribeInfo,
      userInfo,
    ],
  )

  return <XboardContext value={value}>{children}</XboardContext>
}
