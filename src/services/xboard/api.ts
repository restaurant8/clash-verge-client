import { isTauriRuntime } from '@/utils/tauri'

import { xboardFetch } from './http'
import type { XboardAuthPayload, XboardOrderCheckoutResult } from './types'

interface RequestOptions {
  method?: 'GET' | 'POST'
  body?: Record<string, unknown> | null
  authData?: string
  subscribeToken?: string
  rawText?: boolean
  includeMessage?: boolean
}

export interface XboardApiResult<T = any> {
  data: T
  message?: string
}

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
  readonly baseUrl: string
  readonly userAgent: string

  constructor(baseUrl: string, userAgent: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.userAgent = userAgent
  }

  get webSubscribeBase() {
    return this.baseUrl
  }

  webSubscribeUrl(subscribePath: string, token: string) {
    return joinUrl(
      this.baseUrl,
      `${subscribePath}/${encodeURIComponent(token)}`,
    )
  }

  private async request<T>(path: string, options: RequestOptions = {}) {
    const method = options.method ?? 'GET'
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

    const response = await xboardFetch(joinUrl(this.baseUrl, path), {
      method,
      connectTimeout: 8000,
      headers,
      body: options.body == null ? undefined : JSON.stringify(options.body),
    })

    const text = await response.text()

    if (!response.ok) {
      const payload = parseJsonMaybe(text)
      throw new Error(
        messageFromPayload(
          payload,
          text || `请求失败：HTTP ${response.status}`,
        ),
      )
    }

    if (options.rawText) {
      return text as T
    }

    const payload = parseJsonMaybe(text)
    if (payload === null && text) {
      throw new Error('后端响应不是合法 JSON')
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
