import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Stack,
  Typography,
} from '@mui/material'
import {
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { invoke } from '@tauri-apps/api/core'

import { patchVergeConfig, stopCore } from '@/services/cmds'
import { setDelayDisplayScale } from '@/services/delay'
import { showNotice } from '@/services/notice-service'
import {
  XBOARD_AUTH_EXPIRED_EVENT,
  XboardApiClient,
  isXboardAuthExpiredError,
} from '@/services/xboard/api'
import { pushNameserverPolicy } from '@/services/xboard/dns-policy'
import {
  getCachedXboardConfig,
  resolveXboardRemoteConfig,
} from '@/services/xboard/remote-config'
import {
  clearXboardSession,
  readOfflineMode,
  readSubscriptionSyncAt,
  readXboardSession,
  saveOfflineMode,
  saveXboardSession,
  writeSubscriptionSyncAt,
} from '@/services/xboard/session'
import {
  ensureXboardSubscriptionProfile,
  getCachedXboardSubscriptionTokens,
  restartCoreForXboard,
} from '@/services/xboard/subscription'
import type {
  XboardAccountSnapshot,
  XboardAuthPayload,
  XboardBootstrapData,
  XboardConnectionState,
  XboardRecord,
  XboardResourceCache,
  XboardRemoteConfig,
  XboardResolvedConfig,
  XboardSession,
} from '@/services/xboard/types'

import { XboardContext } from './xboard-context'

const asRecord = (value: unknown): XboardRecord =>
  value && typeof value === 'object' ? (value as XboardRecord) : {}

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

/**
 * Cooldown between automatic startup subscription re-pulls. Within this window
 * the app boots straight from the cached profile instead of re-fetching the
 * subscription on every launch. Manual "刷新订阅" always bypasses this.
 */
const SUBSCRIPTION_SYNC_COOLDOWN_MS = 2 * 60 * 60 * 1000

type SubscriptionInitializationState = {
  status: 'idle' | 'loading' | 'error'
  message?: string
}

/** 关闭代理的 IPC 超时上限：超时按失败处理，避免卡死登出/断开流程。 */
const FORCE_DISABLE_PROXY_TIMEOUT_MS = 3000

/**
 * 兜底：强制关闭系统代理与 TUN 并持久化。
 * 退出登录 / 断开连接前必须先执行完成，否则系统代理仍指向本地端口，
 * 内核一旦停止或配置失效，设备会断网，连登录接口都无法访问。
 *
 * @returns 是否确认关闭成功；失败/超时返回 false，由调用方决定提示或中止。
 */
const forceDisableProxy = async (): Promise<boolean> => {
  try {
    await Promise.race([
      patchVergeConfig({
        enable_system_proxy: false,
        enable_tun_mode: false,
      }),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error('关闭系统代理超时')),
          FORCE_DISABLE_PROXY_TIMEOUT_MS,
        )
      }),
    ])
    return true
  } catch (error) {
    console.warn('[Xboard] failed to force-disable system proxy', error)
    return false
  }
}

const buildClient = (remote: XboardResolvedConfig) =>
  new XboardApiClient(
    remote.activeApiDomain,
    remote.remoteConfig.custom_ua || 'muacloud/1.0',
    remote.apiDomains,
    remote.apiRequestDomains,
  )

const fallbackUnlessAuthExpired = <T,>(error: unknown, fallback: T) => {
  if (isXboardAuthExpiredError(error)) throw error
  return fallback
}

const loadAccountSnapshot = async (
  client: XboardApiClient,
  session: XboardSession,
  verifySession = true,
): Promise<XboardAccountSnapshot> => {
  if (verifySession) {
    await client.checkLogin(session.authData)
  }

  const [userInfo, subscribeInfo, serverPayload, appConfig, noticePayload] =
    await Promise.all([
      client
        .userInfo(session.authData)
        .catch((error) => fallbackUnlessAuthExpired(error, { error })),
      client
        .getSubscribe(session.authData)
        .catch((error) => fallbackUnlessAuthExpired(error, { error })),
      client
        .fetchServers(session.authData)
        .catch((error) => fallbackUnlessAuthExpired(error, [])),
      session.subscribeToken
        ? client.appConfig(session.subscribeToken).catch(() => undefined)
        : undefined,
      client
        .notices(session.authData)
        .catch((error) => fallbackUnlessAuthExpired(error, [])),
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

  return {
    session: nextSession,
    userInfo,
    subscribeInfo,
    servers: asArray(serverPayload),
    appConfig,
    notices: asArray(noticePayload),
  }
}

const loadPublicBootstrap = async (
  client: XboardApiClient,
): Promise<XboardBootstrapData> => {
  try {
    return asRecord(await client.appBootstrap()) as XboardBootstrapData
  } catch {
    const guestConfig = asRecord(await client.guestConfig())
    return {
      app_info: guestConfig,
      public_ui_config: guestConfig,
      guest_config: guestConfig,
      features: {
        enable_register:
          guestConfig.enable_register ??
          guestConfig.register_enable ??
          guestConfig.is_register,
        stop_register:
          guestConfig.stop_register ?? guestConfig.disable_registration,
        email_gmail_limit_enable:
          guestConfig.email_gmail_limit_enable ??
          guestConfig.gmail_alias_limit ??
          guestConfig.disable_gmail_alias,
        email_verify: guestConfig.email_verify ?? guestConfig.is_email_verify,
        invite_force: guestConfig.invite_force ?? guestConfig.is_invite_force,
        captcha: guestConfig.captcha ?? guestConfig.is_captcha,
        is_captcha:
          guestConfig.is_captcha ??
          guestConfig.captcha_enable ??
          guestConfig.enable_captcha,
        captcha_enable:
          guestConfig.captcha_enable ??
          guestConfig.is_captcha ??
          guestConfig.enable_captcha,
        captcha_type: guestConfig.captcha_type,
        recaptcha_site_key: guestConfig.recaptcha_site_key,
        recaptcha_v3_site_key: guestConfig.recaptcha_v3_site_key,
        turnstile_site_key: guestConfig.turnstile_site_key,
      },
    }
  }
}

const loadSubscriptionProfile = async (
  client: XboardApiClient,
  remoteConfig: XboardRemoteConfig,
  snapshot: XboardAccountSnapshot,
) => {
  if (!snapshot.session.subscribeToken) {
    throw new Error('当前账号没有订阅 token')
  }

  if (!snapshot.servers.length) {
    throw new Error('当前账号没有可用节点，请先购买套餐或联系客服')
  }

  const uid = await ensureXboardSubscriptionProfile(
    client,
    snapshot.session.subscribeToken,
    remoteConfig,
    snapshot.subscribeInfo,
  )
  // 记录成功拉取订阅的时间，供启动时的 2 小时冷却判断使用。
  writeSubscriptionSyncAt(Date.now())
  return uid
}

export const XboardProvider = ({ children }: { children: ReactNode }) => {
  const [remote, setRemote] = useState<XboardResolvedConfig>(() =>
    getCachedXboardConfig(),
  )
  const [session, setSession] = useState<XboardSession | null>(() =>
    readXboardSession(),
  )
  const [offlineMode, setOfflineMode] = useState(() => readOfflineMode())
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
  // 首次账号快照是否已落地；未落地前 UI 不应把空数据当成"待开通/已过期"
  const [accountHydrated, setAccountHydrated] = useState(false)
  const [lastError, setLastError] = useState<string | undefined>()
  const [connection, setConnection] = useState<XboardConnectionState>({
    status: 'disconnected',
  })
  const lastAuthExpiredNoticeAtRef = useRef(0)
  const authOperationRef = useRef(0)
  const logoutInProgressRef = useRef(false)
  const cachedSubscriptionTokensRef = useRef(new Set<string>())
  const [subscriptionInitialization, setSubscriptionInitialization] =
    useState<SubscriptionInitializationState>({ status: 'idle' })

  const client = useMemo(() => buildClient(remote), [remote])

  useEffect(() => {
    setDelayDisplayScale(remote.remoteConfig.delay_display_scale)
  }, [remote.remoteConfig.delay_display_scale])

  // 远程下发的 DNS 策略:落盘后由内核配置生成流程在所有覆写之后合并。
  useEffect(() => {
    void pushNameserverPolicy(remote.remoteConfig.dns_nameserver_policy)
  }, [remote.remoteConfig.dns_nameserver_policy])

  // Empty means the server does not control this preference.  When present,
  // apply it through the same full regeneration path as the settings switch.
  useEffect(() => {
    const value = remote.remoteConfig.dns_overwrite_enabled
    if (value === '') return
    const enabled = value === true
    void patchVergeConfig({ enable_dns_settings: enabled })
      .then(() => invoke('apply_dns_config', { apply: enabled }))
      .catch((error) =>
        console.warn('[Xboard] failed to apply remote DNS overwrite switch', error),
      )
  }, [remote.remoteConfig.dns_overwrite_enabled])

  const refreshRemoteConfig = useCallback(async (force = false) => {
    const next = await resolveXboardRemoteConfig({ force })
    setRemote((current) => ({
      ...next,
      bootstrap: next.bootstrap ?? current.bootstrap,
    }))
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
    setAccountHydrated(true)
  }, [])

  const syncSubscriptionProfile = useCallback(
    async (
      snapshot: XboardAccountSnapshot,
      options: { noticeErrors?: boolean } = {},
    ) => {
      try {
        const uid = await loadSubscriptionProfile(
          client,
          remote.remoteConfig,
          snapshot,
        )
        setLastError(undefined)
        return uid
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setLastError(message)
        if (options.noticeErrors) {
          showNotice.error(`订阅自动加载失败：${message}`)
        }
        return undefined
      }
    },
    [client, remote.remoteConfig],
  )

  const logout = useCallback(
    async (options: { force?: boolean } = {}) => {
      // 防重入：await 关代理期间重复触发（连点按钮 / 登录态失效事件叠加）只执行一次
      if (logoutInProgressRef.current) return
      logoutInProgressRef.current = true

      // 立即作废所有进行中的账号/订阅操作，避免 await 期间旧请求回写状态
      authOperationRef.current += 1

      try {
        // 兜底：必须先确认系统代理/TUN 已关闭再清除登录态，
        // 否则登录页的请求会走失效代理导致断网、无法重新登录
        const proxyDisabled = await forceDisableProxy()
        if (!proxyDisabled) {
          if (!options.force) {
            // 手动退出：严格保证“先关代理再登出”，关闭失败则取消本次登出
            showNotice.error(
              '关闭系统代理失败，已取消退出登录；请重试或先手动关闭系统代理',
            )
            return
          }
          // 强制登出（登录态已在服务端失效）无法取消，只能强提示用户手动处理
          showNotice.error(
            '关闭系统代理失败，请在系统设置中手动关闭代理，否则可能无法上网',
          )
        }
      } finally {
        logoutInProgressRef.current = false
      }

      clearXboardSession()
      setSession(null)
      setUserInfo(undefined)
      setSubscribeInfo(undefined)
      setServers([])
      setAppConfig(undefined)
      setNotices([])
      setAccountHydrated(false)
      setConnection({ status: 'disconnected' })
      setRefreshing(false)
      setSubscriptionInitialization({ status: 'idle' })
      clearResourceCache()
    },
    [clearResourceCache],
  )

  const enterOfflineMode = useCallback(() => {
    setOfflineMode(true)
    saveOfflineMode(true)
  }, [])

  const exitOfflineMode = useCallback(() => {
    setOfflineMode(false)
    saveOfflineMode(false)
  }, [])

  const notifyAuthExpired = useCallback((message: string) => {
    const now = Date.now()
    if (now - lastAuthExpiredNoticeAtRef.current < 1000) return
    lastAuthExpiredNoticeAtRef.current = now
    showNotice.error(`登录状态已失效，请重新登录：${message}`)
  }, [])

  const handleAuthExpired = useCallback(
    (error: unknown) => {
      if (!isXboardAuthExpiredError(error)) return false
      const message = error.message || '登录状态已失效，请重新登录'
      setLastError(message)
      setConnection({ status: 'disconnected' })
      void logout({ force: true })
      notifyAuthExpired(message)
      return true
    },
    [logout, notifyAuthExpired],
  )

  useEffect(() => {
    const handleEvent = (event: Event) => {
      const detail =
        event instanceof CustomEvent && typeof event.detail === 'object'
          ? event.detail
          : undefined
      const message =
        typeof detail?.message === 'string' && detail.message
          ? detail.message
          : '登录状态已失效，请重新登录'

      setLastError(message)
      setConnection({ status: 'disconnected' })
      void logout({ force: true })
      notifyAuthExpired(message)
    }

    window.addEventListener(XBOARD_AUTH_EXPIRED_EVENT, handleEvent)
    return () => {
      window.removeEventListener(XBOARD_AUTH_EXPIRED_EVENT, handleEvent)
    }
  }, [logout, notifyAuthExpired])

  const refreshAccount = useCallback(async () => {
    if (!session) return
    setRefreshing(true)
    setLastError(undefined)
    try {
      const snapshot = await loadAccountSnapshot(client, session)
      applySnapshot(snapshot)
      await syncSubscriptionProfile(snapshot, { noticeErrors: true })
    } catch (error) {
      if (handleAuthExpired(error)) return
      const message = error instanceof Error ? error.message : String(error)
      setLastError(message)
      showNotice.error(`账号刷新失败：${message}`)
    } finally {
      setRefreshing(false)
    }
  }, [
    applySnapshot,
    client,
    handleAuthExpired,
    session,
    syncSubscriptionProfile,
  ])

  const loadPlans = useCallback(
    async (force = false) => {
      if (!session) return
      if (!force && resourceCache.plans && resourceCache.payments) return

      const [planPayload, paymentPayload] = await Promise.all([
        client.plans(session.authData),
        client
          .paymentMethods(session.authData)
          .catch((error) => fallbackUnlessAuthExpired(error, [])),
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

  const startAuthenticatedSession = useCallback(
    (
      authenticatedClient: XboardApiClient,
      nextSession: XboardSession,
      actionLabel: '登录' | '注册',
    ) => {
      const operationId = ++authOperationRef.current
      let hasCachedSubscription =
        Boolean(nextSession.subscribeToken) &&
        cachedSubscriptionTokensRef.current.has(nextSession.subscribeToken)

      clearResourceCache()
      setUserInfo(undefined)
      setSubscribeInfo(undefined)
      setServers([])
      setAppConfig(undefined)
      setNotices([])
      setAccountHydrated(false)
      setSession(nextSession)
      saveXboardSession(nextSession)
      // 登录成功后回到正常的账号订阅模式
      setOfflineMode(false)
      saveOfflineMode(false)
      setRefreshing(false)
      setSubscriptionInitialization(
        hasCachedSubscription ? { status: 'idle' } : { status: 'loading' },
      )
      showNotice.success(`${actionLabel}成功，正在后台同步账号与订阅`)

      void (async () => {
        try {
          if (!hasCachedSubscription && nextSession.subscribeToken) {
            const cachedTokens = await getCachedXboardSubscriptionTokens()
            cachedTokens.forEach((token) =>
              cachedSubscriptionTokensRef.current.add(token),
            )
            hasCachedSubscription = cachedSubscriptionTokensRef.current.has(
              nextSession.subscribeToken,
            )
            if (hasCachedSubscription) {
              setSubscriptionInitialization({ status: 'idle' })
            }
          }

          const snapshot = await loadAccountSnapshot(
            authenticatedClient,
            nextSession,
            false,
          )
          if (authOperationRef.current !== operationId) return

          applySnapshot(snapshot)
          if (!snapshot.servers.length) {
            setSubscriptionInitialization({ status: 'idle' })
            return
          }

          const uid = await syncSubscriptionProfile(snapshot, {
            noticeErrors: hasCachedSubscription,
          })
          if (authOperationRef.current !== operationId) return

          if (uid) {
            cachedSubscriptionTokensRef.current.add(
              snapshot.session.subscribeToken,
            )
            setSubscriptionInitialization({ status: 'idle' })
          } else if (!hasCachedSubscription) {
            setSubscriptionInitialization({
              status: 'error',
              message: '订阅初始化失败，请检查网络后重试。',
            })
          }
        } catch (error) {
          if (authOperationRef.current !== operationId) return
          if (handleAuthExpired(error)) return

          const message = error instanceof Error ? error.message : String(error)
          setLastError(message)
          if (hasCachedSubscription) {
            showNotice.error(`后台同步失败：${message}`)
          } else {
            setSubscriptionInitialization({ status: 'error', message })
          }
        }
      })()
    },
    [
      applySnapshot,
      clearResourceCache,
      handleAuthExpired,
      syncSubscriptionProfile,
    ],
  )

  const retrySubscriptionInitialization = useCallback(async () => {
    if (!session) return

    setSubscriptionInitialization({ status: 'loading' })
    setLastError(undefined)
    try {
      const snapshot = await loadAccountSnapshot(client, session)
      applySnapshot(snapshot)

      if (!snapshot.servers.length) {
        setSubscriptionInitialization({ status: 'idle' })
        return
      }

      const uid = await syncSubscriptionProfile(snapshot)
      if (!uid) {
        setSubscriptionInitialization({
          status: 'error',
          message: '订阅初始化失败，请检查网络后重试。',
        })
        return
      }

      cachedSubscriptionTokensRef.current.add(snapshot.session.subscribeToken)
      setSubscriptionInitialization({ status: 'idle' })
    } catch (error) {
      if (handleAuthExpired(error)) return
      const message = error instanceof Error ? error.message : String(error)
      setLastError(message)
      setSubscriptionInitialization({ status: 'error', message })
    }
  }, [
    applySnapshot,
    client,
    handleAuthExpired,
    session,
    syncSubscriptionProfile,
  ])

  const login = useCallback(
    async (email: string, password: string) => {
      setRefreshing(true)
      setLastError(undefined)
      try {
        const payload = extractAuthPayload(await client.login(email, password))
        const authData = payload.auth_data
        const subscribeToken = extractSubscribeToken(payload)

        if (!authData) {
          throw new Error('登录响应缺少 auth_data')
        }

        const nextSession: XboardSession = {
          authData,
          subscribeToken,
          isAdmin: Boolean(payload.is_admin),
          email,
          loggedInAt: Date.now(),
        }
        startAuthenticatedSession(client, nextSession, '登录')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setLastError(message)
        showNotice.error(message)
        setRefreshing(false)
        throw error
      }
    },
    [client, startAuthenticatedSession],
  )

  const register = useCallback(
    async (payload: Record<string, unknown>) => {
      setRefreshing(true)
      setLastError(undefined)
      try {
        const authPayload = extractAuthPayload(await client.register(payload))
        const authData = authPayload.auth_data
        const subscribeToken = extractSubscribeToken(authPayload)

        if (!authData) {
          throw new Error('注册响应缺少 auth_data')
        }

        const nextSession: XboardSession = {
          authData,
          subscribeToken,
          isAdmin: Boolean(authPayload.is_admin),
          email: String(payload.email ?? ''),
          loggedInAt: Date.now(),
        }
        startAuthenticatedSession(client, nextSession, '注册')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setLastError(message)
        showNotice.error(message)
        setRefreshing(false)
        throw error
      }
    },
    [client, startAuthenticatedSession],
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

      await loadSubscriptionProfile(client, remote.remoteConfig, snapshot)
      await restartCoreForXboard()

      setConnection({
        status: 'connected',
        message: '已通过权益校验并加载订阅',
        connectedAt: Date.now(),
      })
      showNotice.success('连接已启动')
    } catch (error) {
      if (handleAuthExpired(error)) throw error
      const message = error instanceof Error ? error.message : String(error)
      setConnection({ status: 'error', message })
      setLastError(message)
      showNotice.error(message)
      throw error
    } finally {
      setRefreshing(false)
    }
  }, [applySnapshot, client, handleAuthExpired, remote.remoteConfig, session])

  const disconnect = useCallback(async () => {
    // 必须先确认系统代理/TUN 已关闭再停内核：若代理还开着就停核，
    // 系统代理会指向已停止的端口，设备立即断网
    const proxyDisabled = await forceDisableProxy()
    if (!proxyDisabled) {
      const message = '关闭系统代理失败，已取消断开连接，以免设备断网'
      showNotice.error(message)
      throw new Error(message)
    }
    await stopCore()
    setConnection({ status: 'disconnected' })
    showNotice.info('已断开连接')
  }, [])

  useEffect(() => {
    let cancelled = false

    const initialize = async () => {
      const storedSession = readXboardSession()
      const cachedTokensPromise = getCachedXboardSubscriptionTokens().catch(
        () => [] as string[],
      )

      // 缓存优先：立即解除整页“正在准备登录环境”遮罩，不再每次启动都被
      // 远程配置拉取 + 登录态校验阻塞。已登录则用本地缓存会话直接进入界面，
      // 登录态校验在后台进行；若校验发现 token 失效会自动登出并跳回登录页。
      setBooting(false)
      if (!storedSession) {
        void cachedTokensPromise.then((tokens) => {
          tokens.forEach((token) =>
            cachedSubscriptionTokensRef.current.add(token),
          )
        })
      }

      try {
        const nextRemote = await refreshRemoteConfig(true)
        if (cancelled) return
        const startupClient = buildClient(nextRemote)

        void loadPublicBootstrap(startupClient)
          .then((bootstrap) => {
            if (cancelled) return
            setRemote((current) =>
              current.fetchedAt === nextRemote.fetchedAt
                ? { ...current, bootstrap }
                : current,
            )
          })
          .catch(() => undefined)

        if (storedSession) {
          const cachedTokens = await cachedTokensPromise
          cachedTokens.forEach((token) =>
            cachedSubscriptionTokensRef.current.add(token),
          )
          const hasCachedSubscription =
            Boolean(storedSession.subscribeToken) &&
            cachedSubscriptionTokensRef.current.has(
              storedSession.subscribeToken,
            )

          await startupClient.checkLogin(storedSession.authData)
          if (cancelled) return

          // 账号信息（套餐/节点/流量）每次启动都刷新，避免误显示“待开通/无节点”。
          // 仅对“重拉订阅 YAML + 重写 profile + 重载内核”这件重活做 2 小时冷却：
          // 已有缓存订阅且距上次拉取不足 2 小时时，沿用本地缓存配置，跳过重拉。
          const lastSyncedAt = readSubscriptionSyncAt()
          const skipProfilePull =
            hasCachedSubscription &&
            lastSyncedAt !== null &&
            Date.now() - lastSyncedAt < SUBSCRIPTION_SYNC_COOLDOWN_MS

          if (!hasCachedSubscription) {
            setSubscriptionInitialization({ status: 'loading' })
          }
          setBooting(false)

          void (async () => {
            try {
              const snapshot = await loadAccountSnapshot(
                startupClient,
                storedSession,
                false,
              )
              if (cancelled) return
              applySnapshot(snapshot)
              if (!snapshot.servers.length) {
                setSubscriptionInitialization({ status: 'idle' })
                return
              }

              if (skipProfilePull) {
                // 冷却期内：账号信息已刷新，订阅节点沿用本地缓存，不重拉。
                cachedSubscriptionTokensRef.current.add(
                  snapshot.session.subscribeToken,
                )
                setSubscriptionInitialization({ status: 'idle' })
                setLastError(undefined)
                return
              }

              await loadSubscriptionProfile(
                startupClient,
                nextRemote.remoteConfig,
                snapshot,
              )
              if (!cancelled) {
                cachedSubscriptionTokensRef.current.add(
                  snapshot.session.subscribeToken,
                )
                setSubscriptionInitialization({ status: 'idle' })
                setLastError(undefined)
              }
            } catch (syncError) {
              if (cancelled || handleAuthExpired(syncError)) return
              const message =
                syncError instanceof Error
                  ? syncError.message
                  : String(syncError)
              setLastError(message)
              if (!hasCachedSubscription) {
                setSubscriptionInitialization({
                  status: 'error',
                  message,
                })
              }
            }
          })()
        }
      } catch (error) {
        if (!cancelled && handleAuthExpired(error)) return
        const message = error instanceof Error ? error.message : String(error)
        if (!cancelled) setLastError(message)
      } finally {
        if (!cancelled) setBooting(false)
      }
    }

    void initialize()

    return () => {
      cancelled = true
    }
  }, [applySnapshot, handleAuthExpired, refreshRemoteConfig])

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
      accountHydrated,
      connection,
      lastError,
      offlineMode,
      enterOfflineMode,
      exitOfflineMode,
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
      accountHydrated,
      appConfig,
      booting,
      client,
      connect,
      connection,
      disconnect,
      enterOfflineMode,
      exitOfflineMode,
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
      offlineMode,
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

  return (
    <XboardContext value={value}>
      {children}
      {subscriptionInitialization.status !== 'idle' && (
        <Box
          sx={{
            position: 'fixed',
            inset: 0,
            zIndex: (theme) => theme.zIndex.modal + 10,
            display: 'grid',
            placeItems: 'center',
            bgcolor: 'background.default',
            p: 3,
          }}
          data-tauri-drag-region="true"
        >
          <Stack
            spacing={2}
            sx={{ width: '100%', maxWidth: 420, alignItems: 'center' }}
          >
            {subscriptionInitialization.status === 'loading' ? (
              <>
                <CircularProgress size={34} />
                <Typography variant="h6" sx={{ fontWeight: 800 }}>
                  首次启动初始化中
                </Typography>
                <Typography color="text.secondary" sx={{ textAlign: 'center' }}>
                  正在拉取并校验订阅配置，请稍候
                </Typography>
              </>
            ) : (
              <>
                <Typography variant="h6" sx={{ fontWeight: 800 }}>
                  首次启动初始化未完成
                </Typography>
                <Alert severity="error" sx={{ width: '100%' }}>
                  {subscriptionInitialization.message ||
                    '订阅初始化失败，请检查网络后重试。'}
                </Alert>
                <Stack direction="row" spacing={1.5}>
                  <Button
                    variant="contained"
                    onClick={() => void retrySubscriptionInitialization()}
                  >
                    重新初始化
                  </Button>
                  <Button variant="outlined" onClick={() => void logout()}>
                    退出登录
                  </Button>
                </Stack>
              </>
            )}
          </Stack>
        </Box>
      )}
    </XboardContext>
  )
}
