import { isTauriRuntime } from '@/utils/tauri'

import {
  XBOARD_API_CDN_TIMEOUT_MS,
  XBOARD_API_ORIGIN_TIMEOUT_MS,
  clearApiCdnFailure,
  isApiCdnCoolingDown,
  markApiCdnFailure,
} from './api-domain-health'
import { xboardFetch } from './http'
import type { XboardAuthPayload, XboardOrderCheckoutResult } from './types'

interface RequestOptions {
  method?: 'GET' | 'POST'
  body?: Record<string, unknown> | null
  authData?: string
  subscribeToken?: string
  rawText?: boolean
  includeMessage?: boolean
  failover?: boolean
}

export interface XboardApiResult<T = any> {
  data: T
  message?: string
}

export const XBOARD_AUTH_EXPIRED_EVENT = 'xboard:auth-expired'

export class XboardAuthExpiredError extends Error {
  readonly status?: number

  constructor(message = '登录状态已失效，请重新登录', status?: number) {
    super(message)
    this.name = 'XboardAuthExpiredError'
    this.status = status
  }
}

export const isXboardAuthExpiredError = (
  error: unknown,
): error is XboardAuthExpiredError =>
  error instanceof XboardAuthExpiredError ||
  (error instanceof Error && error.name === 'XboardAuthExpiredError')

const trimSlashes = (value: string) => value.replace(/^\/+|\/+$/g, '')

const joinUrl = (base: string, path: string) => {
  if (/^https?:\/\//i.test(path)) return path
  return `${base.replace(/\/+$/, '')}/${trimSlashes(path)}`
}

const parseJsonMaybe = (text: string) => {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const normalizeMessage = (value: unknown) => {
  if (typeof value === 'string' && value) return value
  if (Array.isArray(value)) {
    const text = value.find((item) => typeof item === 'string' && item)
    if (text) return text
  }
  if (value && typeof value === 'object') {
    const text = Object.values(value).find(
      (item) => typeof item === 'string' && item,
    )
    if (text) return text as string
  }
  return ''
}

const messageFromPayload = (payload: any, fallback: string) => {
  return (
    normalizeMessage(payload?.message) ||
    normalizeMessage(payload?.error) ||
    normalizeMessage(payload?.errors) ||
    fallback
  )
}

const isAuthExpiredMessage = (message: string) =>
  /unauthenticated|unauthorized|not\s*login|login\s*expired|invalid\s*token|token\s*(expired|invalid)|未登录|未登入|请先登录|请先登入|登录状态|登录.*(过期|失效)|登入状态|登入.*(過期|失效)|token.*(过期|失效|无效|過期|無效)/i.test(
    message,
  )

const emitAuthExpired = (error: XboardAuthExpiredError) => {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent(XBOARD_AUTH_EXPIRED_EVENT, {
      detail: {
        message: error.message,
        status: error.status,
      },
    }),
  )
}

const throwAuthExpired = (message: string, status?: number): never => {
  const error = new XboardAuthExpiredError(message, status)
  emitAuthExpired(error)
  throw error
}

const unwrapResult = (payload: any): XboardApiResult => {
  if (
    payload &&
    typeof payload === 'object' &&
    'status' in payload &&
    payload.status === 'fail'
  ) {
    throw new Error(messageFromPayload(payload, '请求失败'))
  }

  const message = messageFromPayload(payload, '')

  if (
    payload &&
    typeof payload === 'object' &&
    'status' in payload &&
    payload.status === 'success'
  ) {
    return { data: payload.data, message: message || undefined }
  }

  if (
    payload &&
    typeof payload === 'object' &&
    Object.keys(payload).length === 1 &&
    'data' in payload
  ) {
    return { data: payload.data, message: undefined }
  }

  return { data: payload, message: message || undefined }
}

export class XboardApiClient {
  private activeApiBaseUrl: string
  private readonly webBaseUrl: string
  private readonly originBaseUrls: string[]
  private readonly apiBaseUrls: string[]
  private readonly cdnApiBaseUrls: Set<string>
  readonly userAgent: string

  constructor(
    baseUrl: string,
    userAgent: string,
    originBaseUrls: string[] = [],
    apiBaseUrls: string[] = [],
  ) {
    const normalizedOriginBaseUrls = [baseUrl, ...originBaseUrls]
      .map((value) => value.replace(/\/+$/, ''))
      .filter(Boolean)
    this.originBaseUrls = [...new Set(normalizedOriginBaseUrls)]
    this.webBaseUrl = this.originBaseUrls[0] || baseUrl.replace(/\/+$/, '')

    const normalizedApiBaseUrls = apiBaseUrls
      .map((value) => value.replace(/\/+$/, ''))
      .filter(Boolean)
    this.cdnApiBaseUrls = new Set(
      normalizedApiBaseUrls.filter(
        (apiBaseUrl) => !this.originBaseUrls.includes(apiBaseUrl),
      ),
    )
    this.apiBaseUrls = [
      ...new Set([...normalizedApiBaseUrls, ...this.originBaseUrls]),
    ]
    this.activeApiBaseUrl = this.apiBaseUrls[0] || this.webBaseUrl
    this.userAgent = userAgent
  }

  get baseUrl() {
    return this.activeApiBaseUrl
  }

  get webSubscribeBase() {
    return this.webBaseUrl
  }

  webSubscribeUrl(subscribePath: string, token: string) {
    return joinUrl(
      this.webBaseUrl,
      `${subscribePath}/${encodeURIComponent(token)}`,
    )
  }

  private isApiPath(path: string) {
    return /^\/?api\/v[12](?:[/?#]|$)/i.test(path)
  }

  private orderedBaseUrlTiers(path: string) {
    if (!this.isApiPath(path)) return [this.originBaseUrls]

    const cdnTier = this.apiBaseUrls.filter(
      (baseUrl) =>
        this.cdnApiBaseUrls.has(baseUrl) && !isApiCdnCoolingDown(baseUrl),
    )
    const originTier = this.apiBaseUrls.filter(
      (baseUrl) => !this.cdnApiBaseUrls.has(baseUrl),
    )

    return [cdnTier, originTier].filter((tier) => tier.length > 0)
  }

  private shouldFailoverStatus(status: number) {
    return status === 404 || status === 408 || status === 429 || status >= 500
  }

  private shouldFailoverCdnStatus(status: number) {
    return status === 403 || status === 404 || this.shouldFailoverStatus(status)
  }

  private normalizeTransportError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    if (
      /request failed|failed to fetch|network error|request cancelled|abort/i.test(
        message,
      )
    ) {
      return new Error('无法连接 API 服务，请检查网络后重试')
    }
    return error instanceof Error ? error : new Error(message)
  }

  private async request<T>(path: string, options: RequestOptions = {}) {
    const method = options.method ?? 'GET'
    const canFailover = options.failover ?? method === 'GET'
    const headers: Record<string, string> = {
      Accept: options.rawText
        ? 'text/yaml, text/plain, */*'
        : 'application/json',
    }

    if (isTauriRuntime()) {
      headers['User-Agent'] = this.userAgent
    }

    if (options.body) {
      headers['Content-Type'] = 'application/json'
    }
    if (options.authData) {
      headers.Authorization = `Bearer ${options.authData}`
    }

    type AttemptResult = {
      baseUrl: string
      response: Response
      text: string
    }

    const attempt = async (
      baseUrl: string,
      signal?: AbortSignal,
    ): Promise<AttemptResult> => {
      const url = joinUrl(baseUrl, path)
      const isCdnApiRequest =
        this.isApiPath(path) && this.cdnApiBaseUrls.has(baseUrl)

      try {
        const response = await xboardFetch(url, {
          method,
          connectTimeout: isCdnApiRequest
            ? XBOARD_API_CDN_TIMEOUT_MS
            : XBOARD_API_ORIGIN_TIMEOUT_MS,
          signal,
          headers,
          body: options.body == null ? undefined : JSON.stringify(options.body),
        })
        const text = await response.text()

        if (
          !response.ok &&
          (isCdnApiRequest
            ? this.shouldFailoverCdnStatus(response.status)
            : this.shouldFailoverStatus(response.status))
        ) {
          throw new Error(
            messageFromPayload(
              parseJsonMaybe(text),
              text || `请求失败：HTTP ${response.status}`,
            ),
          )
        }

        if (!options.rawText && text && parseJsonMaybe(text) === null) {
          throw new Error('后端响应不是合法 JSON')
        }

        if (isCdnApiRequest) clearApiCdnFailure(baseUrl)
        return { baseUrl, response, text }
      } catch (error) {
        if (isCdnApiRequest && !signal?.aborted) {
          markApiCdnFailure(baseUrl)
        }
        throw this.normalizeTransportError(error)
      }
    }

    const raceTier = async (baseUrls: string[]) => {
      const controllers = baseUrls.map(() => new AbortController())
      try {
        return await Promise.any(
          baseUrls.map((baseUrl, index) =>
            attempt(baseUrl, controllers[index].signal),
          ),
        )
      } finally {
        controllers.forEach((controller) => controller.abort())
      }
    }

    const tiers = this.orderedBaseUrlTiers(path)
    let attemptResult: AttemptResult | undefined
    let lastError: unknown

    if (canFailover) {
      for (const tier of tiers) {
        try {
          attemptResult = await raceTier(tier)
          break
        } catch (error) {
          const aggregateErrors =
            error instanceof AggregateError ? error.errors : []
          lastError =
            aggregateErrors[aggregateErrors.length - 1] ??
            this.normalizeTransportError(error)
        }
      }
    } else {
      const baseUrl = tiers[0]?.[0] || this.webBaseUrl
      try {
        attemptResult = await attempt(baseUrl)
      } catch (error) {
        lastError = error
      }
    }

    if (!attemptResult) {
      throw lastError instanceof Error ? lastError : new Error('请求失败')
    }

    const { baseUrl, response, text } = attemptResult

    if (!response.ok) {
      const payload = parseJsonMaybe(text)
      const error = new Error(
        messageFromPayload(
          payload,
          text || `请求失败：HTTP ${response.status}`,
        ),
      )

      if (
        options.authData &&
        (response.status === 401 || response.status === 403)
      ) {
        throwAuthExpired(error.message, response.status)
      }

      throw error
    }

    if (this.isApiPath(path)) this.activeApiBaseUrl = baseUrl

    if (options.rawText) {
      return text as T
    }

    const payload = parseJsonMaybe(text)

    if (
      options.authData &&
      payload &&
      typeof payload === 'object' &&
      payload.status === 'fail'
    ) {
      const message = messageFromPayload(payload, '登录状态已失效，请重新登录')
      if (
        path.includes('/api/v1/user/checkLogin') ||
        isAuthExpiredMessage(message)
      ) {
        throwAuthExpired(message)
      }
    }

    const result = unwrapResult(payload)
    return (options.includeMessage ? result : result.data) as T
  }

  appBootstrap() {
    return this.request<any>('/api/v1/app/bootstrap')
  }

  guestConfig() {
    return this.request<any>('/api/v1/guest/comm/config')
  }

  guestPlans() {
    return this.request<any[]>('/api/v1/guest/plan/fetch')
  }

  sendEmailVerify(payload: Record<string, unknown>) {
    return this.request<XboardApiResult>(
      '/api/v1/passport/comm/sendEmailVerify',
      {
        method: 'POST',
        body: payload,
        includeMessage: true,
      },
    )
  }

  register(payload: Record<string, unknown>) {
    return this.request<XboardAuthPayload>('/api/v1/passport/auth/register', {
      method: 'POST',
      body: payload,
    })
  }

  login(email: string, password: string) {
    return this.request<XboardAuthPayload>('/api/v1/passport/auth/login', {
      method: 'POST',
      body: { email, password },
      failover: true,
    })
  }

  forgetPassword(payload: Record<string, unknown>) {
    return this.request<XboardApiResult>('/api/v1/passport/auth/forget', {
      method: 'POST',
      body: payload,
      includeMessage: true,
    })
  }

  checkLogin(authData: string) {
    return this.request<any>('/api/v1/user/checkLogin', { authData })
  }

  userInfo(authData: string) {
    return this.request<any>('/api/v1/user/info', { authData })
  }

  updateUser(authData: string, payload: Record<string, unknown>) {
    return this.request<XboardApiResult>('/api/v1/user/update', {
      method: 'POST',
      authData,
      body: payload,
      includeMessage: true,
    })
  }

  transferCommission(authData: string, amount: number) {
    return this.request<XboardApiResult>('/api/v1/user/transfer', {
      method: 'POST',
      authData,
      body: { transfer_amount: amount },
      includeMessage: true,
    })
  }

  quickLoginUrl(authData: string, redirect = 'dashboard') {
    return this.request<string>('/api/v1/user/getQuickLoginUrl', {
      method: 'POST',
      authData,
      body: { redirect },
    })
  }

  getSubscribe(authData: string) {
    return this.request<any>('/api/v1/user/getSubscribe', { authData })
  }

  fetchServers(authData: string) {
    return this.request<any>('/api/v1/user/server/fetch', { authData })
  }

  getStat(authData: string) {
    return this.request<any>('/api/v1/user/getStat', { authData })
  }

  trafficLogs(authData: string) {
    return this.request<any>('/api/v1/user/stat/getTrafficLog', { authData })
  }

  userCommConfig(authData: string) {
    return this.request<any>('/api/v1/user/comm/config', { authData })
  }

  inviteInfo(authData: string) {
    return this.request<any>('/api/v1/user/invite/fetch', { authData })
  }

  inviteDetails(authData: string) {
    return this.request<any>('/api/v1/user/invite/details', { authData })
  }

  telegramBotInfo(authData: string) {
    return this.request<any>('/api/v1/user/telegram/getBotInfo', {
      authData,
    })
  }

  notices(authData: string, current = 1) {
    return this.request<any>(`/api/v1/user/notice/fetch?current=${current}`, {
      authData,
    })
  }

  appConfig(subscribeToken: string) {
    return this.request<any>(
      `/api/v2/client/app/getConfig?token=${encodeURIComponent(subscribeToken)}`,
    )
  }

  version(subscribeToken: string) {
    return this.request<any>(
      `/api/v2/client/app/getVersion?token=${encodeURIComponent(subscribeToken)}`,
    )
  }

  subscribeYaml(subscribeToken: string, extraQuery = '') {
    const query = new URLSearchParams({
      token: subscribeToken,
      flag: 'clashmeta',
    })
    if (extraQuery) {
      const extra = new URLSearchParams(extraQuery)
      extra.forEach((value, key) => {
        query.set(key, value)
      })
    }
    return this.request<string>(`/api/v1/client/subscribe?${query}`, {
      rawText: true,
    })
  }

  plans(authData: string, planId?: number | string) {
    const query = planId ? `?id=${encodeURIComponent(String(planId))}` : ''
    return this.request<any>(`/api/v1/user/plan/fetch${query}`, { authData })
  }

  checkCoupon(authData: string, payload: Record<string, unknown>) {
    const body: Record<string, unknown> = {
      ...payload,
      code: payload.code ?? payload.coupon_code,
    }
    delete body.coupon_code

    return this.request<XboardApiResult>('/api/v1/user/coupon/check', {
      method: 'POST',
      authData,
      body,
      includeMessage: true,
    })
  }

  saveOrder(authData: string, payload: Record<string, unknown>) {
    return this.request<any>('/api/v1/user/order/save', {
      method: 'POST',
      authData,
      body: payload,
    })
  }

  paymentMethods(authData: string) {
    return this.request<any>('/api/v1/user/order/getPaymentMethod', {
      authData,
    })
  }

  checkoutOrder(authData: string, payload: Record<string, unknown>) {
    return this.request<XboardOrderCheckoutResult>(
      '/api/v1/user/order/checkout',
      {
        method: 'POST',
        authData,
        body: payload,
      },
    )
  }

  checkOrder(authData: string, tradeNo: string) {
    return this.request<any>(
      `/api/v1/user/order/check?trade_no=${encodeURIComponent(tradeNo)}`,
      { authData },
    )
  }

  orderDetail(authData: string, tradeNo: string) {
    return this.request<any>(
      `/api/v1/user/order/detail?trade_no=${encodeURIComponent(tradeNo)}`,
      { authData },
    )
  }

  orders(authData: string) {
    return this.request<any>('/api/v1/user/order/fetch', { authData })
  }

  cancelOrder(authData: string, tradeNo: string) {
    return this.request<any>('/api/v1/user/order/cancel', {
      method: 'POST',
      authData,
      body: { trade_no: tradeNo },
    })
  }

  tickets(authData: string, id?: number | string) {
    const query = id ? `?id=${encodeURIComponent(String(id))}` : ''
    return this.request<any>(`/api/v1/user/ticket/fetch${query}`, { authData })
  }

  createTicket(authData: string, payload: Record<string, unknown>) {
    return this.request<any>('/api/v1/user/ticket/save', {
      method: 'POST',
      authData,
      body: payload,
    })
  }

  replyTicket(authData: string, payload: Record<string, unknown>) {
    return this.request<any>('/api/v1/user/ticket/reply', {
      method: 'POST',
      authData,
      body: payload,
    })
  }

  closeTicket(authData: string, payload: Record<string, unknown>) {
    return this.request<any>('/api/v1/user/ticket/close', {
      method: 'POST',
      authData,
      body: payload,
    })
  }

  knowledge(authData: string, query = 'language=zh-CN') {
    return this.request<any>(`/api/v1/user/knowledge/fetch?${query}`, {
      authData,
    })
  }

  activeSessions(authData: string) {
    return this.request<any>('/api/v1/user/getActiveSession', { authData })
  }

  resetSecurity(authData: string) {
    return this.request<any>('/api/v1/user/resetSecurity', { authData })
  }
}
