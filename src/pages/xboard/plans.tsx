import {
  CheckCircleRounded,
  LocalOfferRounded,
  OpenInNewRounded,
  PaymentRounded,
  RefreshRounded,
} from '@mui/icons-material'
import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  Grid,
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import { useEffect, useMemo, useState } from 'react'

import { XboardPage } from '@/components/xboard/xboard-page'
import {
  XboardActionButton,
  XboardEmpty,
  XboardPanel,
} from '@/components/xboard/xboard-primitives'
import { useXboard } from '@/providers/xboard-context'
import { openWebUrl } from '@/services/cmds'
import { orderStatusText } from '@/services/xboard/format'
import {
  findPaymentById,
  getCheckoutMessage,
  getCheckoutUrl,
  getDefaultPaymentId,
  getPaymentId,
  getPaymentLabel,
  getTradeNo,
  getUsablePayments,
  isCheckoutCompleted,
} from '@/services/xboard/order'
import type { XboardRecord } from '@/services/xboard/types'

import { getId, sleep } from './utils'

const PERIODS = [
  ['month_price', '月付'],
  ['quarter_price', '季付'],
  ['half_year_price', '半年'],
  ['year_price', '年付'],
  ['two_year_price', '两年'],
  ['three_year_price', '三年'],
  ['onetime_price', '一次性'],
  ['reset_price', '重置流量'],
] as const

type CouponTarget = {
  planId: string | number
  period: string
  planName: string
}

type CouponPreview = CouponTarget & {
  code: string
  coupon: XboardRecord
}

const couponPreviewKey = (planId: string | number, period: string) =>
  `${String(planId)}::${period}`

const availablePeriods = (plan: any) =>
  PERIODS.filter(([key]) => Number(plan[key] ?? 0) > 0)

const PERIOD_ALIASES: Record<string, (typeof PERIODS)[number][0]> = {
  '月': 'month_price',
  '月付': 'month_price',
  '季': 'quarter_price',
  '季付': 'quarter_price',
  '半年': 'half_year_price',
  '半年付': 'half_year_price',
  '年': 'year_price',
  '年付': 'year_price',
  '2年': 'two_year_price',
  '两年': 'two_year_price',
  '3年': 'three_year_price',
  '三年': 'three_year_price',
  '一次': 'onetime_price',
  '一次性': 'onetime_price',
  '流量包': 'reset_price',
  '重置': 'reset_price',
}

const parseDefaultPeriods = (raw: unknown): Record<string, string> => {
  if (!raw) return {}
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(
      Object.entries(value).flatMap(([planId, period]) => {
        const text = String(period ?? '').trim()
        const key = PERIOD_ALIASES[text] || text
        return PERIODS.some(([candidate]) => candidate === key)
          ? [[String(planId), key]]
          : []
      }),
    )
  } catch {
    return {}
  }
}

const asRecord = (value: unknown): XboardRecord =>
  value && typeof value === 'object' ? (value as XboardRecord) : {}

const numberValue = (value: unknown) => {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? number : 0
}

const formatMoney = (value: unknown, currency = 'CNY') =>
  new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(numberValue(value) / 100)

const hasValue = (value: unknown) =>
  value !== undefined && value !== null && value !== ''

const boolFrom = (value: unknown, fallback = true) => {
  if (!hasValue(value)) return fallback
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
  }
  return fallback
}

const pickBool = (fallback: boolean, ...values: unknown[]) => {
  const value = values.find(hasValue)
  return boolFrom(value, fallback)
}

const getCurrentPlanId = (subscribeInfo: XboardRecord | undefined) =>
  subscribeInfo?.plan_id ?? subscribeInfo?.plan?.id

const isSubscriptionActive = (subscribeInfo: XboardRecord | undefined) => {
  if (!subscribeInfo || !getCurrentPlanId(subscribeInfo)) return false
  const expiredAt = subscribeInfo.expired_at
  if (expiredAt === null) return true
  const timestamp = Number(expiredAt ?? 0)
  return timestamp === 0 || timestamp > Math.floor(Date.now() / 1000)
}

const formatPlanMonthlyTraffic = (value: unknown) => {
  const amount = numberValue(value)
  return `每月流量：${new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: 2,
  }).format(amount)} GB`
}

const getCouponPayload = (value: unknown) => {
  const result = asRecord(value)
  const data = asRecord(result.data)
  return Object.keys(data).length ? data : result
}

const getCouponDiscount = (price: unknown, coupon: XboardRecord) => {
  const rawPrice = numberValue(price)
  const type = Number(coupon.type ?? coupon.discount_type ?? 0)
  const value = numberValue(coupon.value ?? coupon.discount_value)

  if (type === 1) return Math.min(rawPrice, Math.max(0, value))
  if (type === 2) {
    return Math.min(rawPrice, Math.max(0, Math.round(rawPrice * (value / 100))))
  }
  return 0
}

const getDiscountedPrice = (price: unknown, coupon?: XboardRecord) => {
  const rawPrice = numberValue(price)
  if (!coupon) return rawPrice
  return Math.max(0, rawPrice - getCouponDiscount(rawPrice, coupon))
}

const getEstimatedBalanceDeduction = (amount: unknown, balance: unknown) =>
  Math.min(Math.max(0, numberValue(amount)), Math.max(0, numberValue(balance)))

const getOrderAmount = (order: unknown, key: string) => {
  const record = asRecord(order)
  const data = asRecord(record.data)
  return Math.max(0, numberValue(record[key] ?? data[key]))
}

const describeOrderSettlement = (
  order: XboardRecord | undefined,
  currency = 'CNY',
) => {
  if (!order || !Object.keys(order).length) return ''

  const parts: string[] = []
  const discountAmount = getOrderAmount(order, 'discount_amount')
  const surplusAmount = getOrderAmount(order, 'surplus_amount')
  const balanceAmount = getOrderAmount(order, 'balance_amount')
  const refundAmount = getOrderAmount(order, 'refund_amount')
  const totalAmount = getOrderAmount(order, 'total_amount')

  if (discountAmount > 0) {
    parts.push(`优惠 ${formatMoney(discountAmount, currency)}`)
  }
  if (surplusAmount > 0) {
    parts.push(`套餐折抵 ${formatMoney(surplusAmount, currency)}`)
  }
  if (balanceAmount > 0) {
    parts.push(`余额抵扣 ${formatMoney(balanceAmount, currency)}`)
  }
  if (refundAmount > 0) {
    parts.push(`返还余额 ${formatMoney(refundAmount, currency)}`)
  }
  parts.push(`剩余应付 ${formatMoney(totalAmount, currency)}`)

  return parts.join('，')
}

const describeCoupon = (coupon: XboardRecord, currency?: string) => {
  const type = Number(coupon.type ?? coupon.discount_type ?? 0)
  const value = numberValue(coupon.value ?? coupon.discount_value)

  if (type === 1) return `立减 ${formatMoney(value, currency)}`
  if (type === 2) return `优惠 ${value}%`
  return '优惠码可用'
}

const PlansPage = () => {
  const {
    session,
    client,
    userInfo,
    subscribeInfo,
    appConfig,
    remote,
    refreshAccount,
    resourceCache,
    loadPlans,
    loadOrders,
  } = useXboard()
  const [periodByPlan, setPeriodByPlan] = useState<Record<string, string>>({})
  const [coupon, setCoupon] = useState('')
  const [selectedPayment, setSelectedPayment] = useState('')
  const [busyPlan, setBusyPlan] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error' | 'info'>(
    'info',
  )
  const [couponMessage, setCouponMessage] = useState('')
  const [couponMessageType, setCouponMessageType] = useState<
    'success' | 'error' | 'info'
  >('info')
  const [refreshingPlans, setRefreshingPlans] = useState(false)
  const [detailPlan, setDetailPlan] = useState<string | null>(null)
  const [checkingCoupon, setCheckingCoupon] = useState(false)
  const [checkedCoupons, setCheckedCoupons] = useState<
    Record<string, CouponPreview>
  >({})

  useEffect(() => {
    void loadPlans()
  }, [loadPlans])

  const plans = useMemo(() => resourceCache.plans ?? [], [resourceCache.plans])
  const defaultPeriods = useMemo(
    () => parseDefaultPeriods(remote.remoteConfig.plan_default_periods),
    [remote.remoteConfig.plan_default_periods],
  )
  const selectedPeriod = (plan: any, key: string) => {
    const periods = availablePeriods(plan)
    const preferred = defaultPeriods[key]
    return (
      periodByPlan[key] ||
      periods.find(([period]) => period === preferred)?.[0] ||
      periods[0]?.[0] ||
      ''
    )
  }
  const payments = useMemo(
    () => getUsablePayments(resourceCache.payments ?? []),
    [resourceCache.payments],
  )
  const defaultPayment = useMemo(
    () => getDefaultPaymentId(payments),
    [payments],
  )
  const selectedPaymentValue = selectedPayment || defaultPayment
  const accountBalance = numberValue(userInfo?.balance)
  const currency = String(
    appConfig?.payment_config?.currency ??
      appConfig?.currency ??
      remote.bootstrap?.payment_config?.currency ??
      'CNY',
  )
  const planChangeEnabled = pickBool(
    true,
    appConfig?.features?.plan_change_enable,
    appConfig?.business_rules?.plan_change_enable,
    remote.bootstrap?.features?.plan_change_enable,
  )
  const surplusEnabled = pickBool(
    false,
    appConfig?.features?.surplus_enable,
    appConfig?.business_rules?.surplus_enable,
    remote.bootstrap?.features?.surplus_enable,
  )
  const currentPlanId = getCurrentPlanId(subscribeInfo)
  const activeSubscription = isSubscriptionActive(subscribeInfo)
  const isPlanChangeOrder = (planId: unknown, period: string) =>
    activeSubscription &&
    period !== 'reset_price' &&
    hasValue(currentPlanId) &&
    hasValue(planId) &&
    String(currentPlanId) !== String(planId)

  const couponTargets = useMemo<CouponTarget[]>(() => {
    const targets: CouponTarget[] = []
    for (let index = 0; index < plans.length; index += 1) {
      const plan = plans[index]
      const planId = getId(plan)
      if (planId === undefined || planId === null) continue
      const key = String(planId)
      const period = selectedPeriod(plan, key)
      if (period) {
        targets.push({
          planId,
          period,
          planName: String(plan.name ?? `套餐 ${index + 1}`),
        })
      }
    }
    return targets
  }, [defaultPeriods, periodByPlan, plans])

  const verifyCoupon = async (
    target: CouponTarget | null,
    interactive: boolean,
    updatePreview = true,
  ): Promise<CouponPreview | null> => {
    if (!session) return null

    const code = coupon.trim()
    if (!code) {
      if (interactive) {
        setCouponMessageType('error')
        setCouponMessage('请先输入优惠码')
      }
      return null
    }

    if (!target) {
      if (interactive) {
        setCouponMessageType('error')
        setCouponMessage('请选择可购买套餐后再检查优惠码')
      }
      return null
    }

    if (interactive) {
      setCheckingCoupon(true)
      setCouponMessageType('info')
      setCouponMessage(`正在按 ${target.planName} 检查优惠码`)
    }

    try {
      const result = await client.checkCoupon(session.authData, {
        plan_id: target.planId,
        period: target.period,
        code,
      })
      const couponData = getCouponPayload(result?.data ?? result)
      const backendMessage =
        result?.message ||
        couponData.message ||
        couponData.name ||
        couponData.code
      const backendText =
        typeof backendMessage === 'string' ? backendMessage : ''
      const preview = {
        ...target,
        code,
        coupon: couponData,
      }
      if (updatePreview) {
        setCheckedCoupons((prev) => ({
          ...prev,
          [couponPreviewKey(target.planId, target.period)]: preview,
        }))
      }
      if (interactive) {
        setCouponMessageType('success')
        setCouponMessage(
          String(
            backendText &&
              backendText !== '操作成功' &&
              backendText.toLowerCase() !== 'success'
              ? backendText
              : `已应用优惠：${describeCoupon(couponData)}`,
          ),
        )
      }
      return preview
    } catch (error) {
      if (target && updatePreview) {
        setCheckedCoupons((prev) => {
          const next = { ...prev }
          delete next[couponPreviewKey(target.planId, target.period)]
          return next
        })
      }
      if (interactive) {
        setCouponMessageType('error')
        setCouponMessage(
          error instanceof Error ? error.message : '优惠码不可用，请检查后重试',
        )
      }
      throw error
    } finally {
      if (interactive) {
        setCheckingCoupon(false)
      }
    }
  }

  const checkCoupon = useLockFn(async () => {
    if (!coupon.trim()) {
      setCouponMessageType('error')
      setCouponMessage('请先输入优惠码')
      return
    }

    if (!couponTargets.length) {
      setCouponMessageType('error')
      setCouponMessage('请选择可购买套餐后再检查优惠码')
      return
    }

    setCheckingCoupon(true)
    setCouponMessageType('info')
    setCouponMessage(`正在检查 ${couponTargets.length} 个套餐周期`)

    const previews: Record<string, CouponPreview> = {}
    const failures: string[] = []

    try {
      for (const target of couponTargets) {
        try {
          const preview = await verifyCoupon(target, false, false)
          if (preview) {
            previews[couponPreviewKey(target.planId, target.period)] = preview
          }
        } catch {
          failures.push(target.planName)
        }
      }

      setCheckedCoupons(previews)

      const appliedPreviews = Object.values(previews)
      if (!appliedPreviews.length) {
        setCouponMessageType('error')
        setCouponMessage('优惠码不适用于当前可购买套餐')
        return
      }

      setCouponMessageType('success')
      setCouponMessage(
        `已应用优惠：${describeCoupon(appliedPreviews[0].coupon)}，适用于 ${
          appliedPreviews.length
        } 个套餐周期${
          failures.length ? `，${failures.length} 个套餐不可用` : ''
        }`,
      )
    } finally {
      setCheckingCoupon(false)
    }
  })

  const pollOrder = async (tradeNo: string) => {
    if (!session) return
    for (let index = 0; index < 30; index += 1) {
      const result = await client.checkOrder(session.authData, tradeNo)
      const status = result?.status ?? result
      setMessage(`订单 ${tradeNo}：${orderStatusText(status)}`)
      if (String(status) === '3') {
        await Promise.all([refreshAccount(), loadOrders(true)])
        setMessageType('success')
        setMessage('支付已确认，权益已刷新')
        return
      }
      await sleep(3000)
    }
    setMessageType('info')
    setMessage('支付状态暂未确认，可稍后刷新订单或在订单页继续支付')
  }

  const startOrderPolling = (tradeNo: string) => {
    void pollOrder(tradeNo).catch((error) => {
      setMessageType('error')
      setMessage(error instanceof Error ? error.message : '订单状态确认失败')
    })
  }

  const checkout = useLockFn(async (plan: any) => {
    if (!session) return
    const planId = getId(plan)
    const planKey = String(planId)
    const periods = availablePeriods(plan)
    const period = selectedPeriod(plan, planKey)
    if (!period) throw new Error('该套餐没有可购买周期')
    const planChangeOrder = isPlanChangeOrder(planId, period)
    let couponForOrder: XboardRecord | undefined
    const planCurrency = String(plan.currency ?? currency)

    setBusyPlan(planKey)
    setMessageType('info')
    setMessage('')
    try {
      if (planChangeOrder && !planChangeEnabled) {
        throw new Error('后台当前关闭更换订阅，请联系客服处理')
      }

      if (coupon.trim()) {
        setMessage('正在校验优惠码')
        const verifiedCoupon = await verifyCoupon(
          {
            planId,
            planName: String(plan.name ?? '当前套餐'),
            period,
          },
          false,
        )
        couponForOrder = verifiedCoupon?.coupon
        setMessage(
          planChangeOrder && surplusEnabled
            ? '优惠码校验通过，正在按后台折抵规则创建订单'
            : '优惠码校验通过，正在创建订单',
        )
      } else {
        setMessage(
          planChangeOrder && surplusEnabled
            ? '正在按后台折抵规则创建订单'
            : '正在创建订单',
        )
      }

      const estimatedPrice = getDiscountedPrice(plan[period], couponForOrder)
      const estimatedBalanceDeduction = getEstimatedBalanceDeduction(
        estimatedPrice,
        accountBalance,
      )
      const estimatedPayable = Math.max(
        0,
        estimatedPrice - estimatedBalanceDeduction,
      )
      if (
        !selectedPaymentValue &&
        estimatedPayable > 0 &&
        !(planChangeOrder && surplusEnabled)
      ) {
        throw new Error('当前没有可用支付方式，账户余额不足以覆盖该订单')
      }

      const order = await client.saveOrder(session.authData, {
        plan_id: planId,
        period,
        coupon_code: coupon.trim() || undefined,
      })
      const tradeNo = getTradeNo(order)
      if (!tradeNo) throw new Error('订单创建失败，请稍后重试')
      void loadOrders(true)
      const orderDetail = asRecord(
        await client.orderDetail(session.authData, tradeNo).catch(() => ({})),
      )
      const settlement = describeOrderSettlement(orderDetail, planCurrency)
      const remainingAmount =
        Object.keys(orderDetail).length > 0
          ? getOrderAmount(orderDetail, 'total_amount')
          : undefined
      const needsPayment = remainingAmount === undefined || remainingAmount > 0

      if (needsPayment && !selectedPaymentValue) {
        setMessageType('error')
        setMessage(
          `订单已创建：${tradeNo}${
            settlement ? `，${settlement}` : ''
          }，但当前没有可用支付方式，请在订单页稍后继续处理。`,
        )
        await loadOrders(true)
        return
      }

      setMessage(
        planChangeOrder && surplusEnabled
          ? `订单已创建：${tradeNo}${
              settlement ? `，${settlement}` : ''
            }，已由后台计算折抵，正在确认支付`
          : `订单已创建：${tradeNo}${
              settlement ? `，${settlement}` : ''
            }，正在确认支付`,
      )

      const checkoutResult = await client.checkoutOrder(session.authData, {
        trade_no: tradeNo,
        ...(selectedPaymentValue ? { method: selectedPaymentValue } : {}),
      })

      if (isCheckoutCompleted(checkoutResult)) {
        await Promise.all([refreshAccount(), loadOrders(true)])
        setMessageType('success')
        setMessage('订单已完成，权益已刷新')
        return
      }

      const checkoutUrl = getCheckoutUrl(checkoutResult)
      if (checkoutUrl) {
        await openWebUrl(checkoutUrl)
        setMessage('已打开支付页，支付完成后会自动尝试确认订单')
      } else {
        setMessage(
          getCheckoutMessage(checkoutResult) ||
            (needsPayment
              ? '支付请求已提交，请在订单页继续确认状态'
              : '订单确认已提交，请稍后刷新订单状态'),
        )
      }

      startOrderPolling(tradeNo)
    } catch (error) {
      setMessageType('error')
      setMessage(
        error instanceof Error ? error.message : '下单失败，请稍后重试',
      )
    } finally {
      setBusyPlan(null)
    }
  })

  const refreshPlans = useLockFn(async () => {
    setRefreshingPlans(true)
    try {
      await loadPlans(true)
    } finally {
      setRefreshingPlans(false)
    }
  })

  const refreshPlanDetail = useLockFn(
    async (planId: string | number | undefined, key: string) => {
      if (!session) return
      setDetailPlan(key)
      setMessageType('info')
      setMessage('正在重新拉取套餐详情')
      try {
        await client.plans(session.authData, planId)
        setMessageType('success')
        setMessage('套餐详情已刷新')
      } catch (error) {
        setMessageType('error')
        setMessage(error instanceof Error ? error.message : '套餐详情刷新失败')
      } finally {
        setDetailPlan(null)
      }
    },
  )

  const paymentLabel = useMemo(() => {
    if (!payments.length) return '暂无可用支付方式'
    return getPaymentLabel(findPaymentById(payments, selectedPaymentValue))
  }, [payments, selectedPaymentValue])

  if (!session) {
    return (
      <XboardPage title="套餐">
        <XboardEmpty
          title="请先登录"
          description="登录后才能读取用户套餐和创建订单。"
        />
      </XboardPage>
    )
  }

  return (
    <XboardPage
      title="套餐"
      action={
        <Button
          variant="outlined"
          startIcon={
            refreshingPlans ? (
              <CircularProgress color="inherit" size={16} />
            ) : (
              <RefreshRounded />
            )
          }
          disabled={refreshingPlans}
          onClick={() => void refreshPlans()}
        >
          刷新套餐
        </Button>
      }
    >
      <Stack spacing={2}>
        {message && <Alert severity={messageType}>{message}</Alert>}
        {activeSubscription && !planChangeEnabled && (
          <Alert severity="warning">
            后台当前关闭更换订阅。续费当前套餐不受影响，切换到其他套餐会被拦截。
          </Alert>
        )}
        {activeSubscription && planChangeEnabled && surplusEnabled && (
          <Alert severity="info">
            更换订阅时，后台会按折抵规则自动计算原订阅剩余价值。
          </Alert>
        )}

        <XboardPanel title="下单设置">
          <Grid container spacing={1.5}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="优惠券"
                placeholder="可选"
                value={coupon}
                onChange={(event) => {
                  setCoupon(event.target.value)
                  setCheckedCoupons({})
                  if (event.target.value.trim()) {
                    setCouponMessageType('info')
                    setCouponMessage('下单时会先校验优惠码')
                  } else {
                    setCouponMessage('')
                  }
                }}
                fullWidth
                helperText={couponMessage || ' '}
                color={couponMessageType === 'success' ? 'success' : undefined}
                error={couponMessageType === 'error'}
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <LocalOfferRounded />
                      </InputAdornment>
                    ),
                    endAdornment: (
                      <InputAdornment position="end">
                        <Button
                          size="small"
                          variant="text"
                          disabled={
                            !coupon.trim() || !couponTargets.length || checkingCoupon
                          }
                          startIcon={
                            checkingCoupon ? (
                              <CircularProgress color="inherit" size={14} />
                            ) : undefined
                          }
                          onClick={() => void checkCoupon()}
                        >
                          检查
                        </Button>
                      </InputAdornment>
                    ),
                  },
                }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                select
                label="支付方式"
                value={selectedPaymentValue}
                onChange={(event) => setSelectedPayment(event.target.value)}
                fullWidth
                helperText={`当前：${paymentLabel}`}
              >
                {payments.length ? (
                  payments.map((payment) => {
                    const id = getPaymentId(payment)
                    return (
                      <MenuItem key={id} value={id}>
                        {getPaymentLabel(payment)}
                      </MenuItem>
                    )
                  })
                ) : (
                  <MenuItem value="">暂无可用支付方式</MenuItem>
                )}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12 }}>
              <Alert severity="info" sx={{ alignItems: 'center' }}>
                {accountBalance > 0
                  ? `下单时后台会自动使用账户余额抵扣，当前可用 ${formatMoney(
                      accountBalance,
                      currency,
                    )}，最终应付以订单详情为准。`
                  : '下单时如账户存在余额，后台会自动抵扣；最终应付以订单详情为准。'}
              </Alert>
            </Grid>
          </Grid>
        </XboardPanel>

        {plans.length ? (
          <Grid container spacing={2}>
            {plans.map((plan, index) => {
              const planId = getId(plan) ?? index
              const key = String(planId)
              const periods = availablePeriods(plan)
              const period = selectedPeriod(plan, key)
              const price = plan[period]
              const couponPreview = period
                ? checkedCoupons[couponPreviewKey(planId, period)]
                : undefined
              const appliedCoupon =
                couponPreview?.code === coupon.trim()
                  ? couponPreview.coupon
                  : undefined
              const discountedPrice = getDiscountedPrice(price, appliedCoupon)
              const discountAmount = numberValue(price) - discountedPrice
              const balanceDeduction = getEstimatedBalanceDeduction(
                discountedPrice,
                accountBalance,
              )
              const estimatedPayable = Math.max(
                0,
                discountedPrice - balanceDeduction,
              )
              const planChangeOrder = isPlanChangeOrder(planId, period)
              const purchaseDisabled = planChangeOrder && !planChangeEnabled
              const planCurrency = String(plan.currency ?? currency)

              return (
                <Grid size={{ xs: 12, md: 6, xl: 4 }} key={key}>
                  <XboardPanel
                    title={plan.name ?? `套餐 ${index + 1}`}
                    action={
                      <Stack direction="row" spacing={0.75}>
                        {index === 0 && (
                          <Chip size="small" color="error" label="热销" />
                        )}
                        <Chip
                          icon={<CheckCircleRounded />}
                          size="small"
                          color={purchaseDisabled ? 'warning' : 'success'}
                          label={purchaseDisabled ? '禁止更换' : '当前价格'}
                        />
                      </Stack>
                    }
                  >
                    <Stack spacing={1.5}>
                      <Typography variant="body2" color="text.secondary">
                        {formatPlanMonthlyTraffic(plan.transfer_enable)}
                      </Typography>
                      <Typography
                        variant="h4"
                        sx={{ fontWeight: 900, color: 'primary.main' }}
                      >
                        {period
                          ? formatMoney(estimatedPayable, planCurrency)
                          : '-'}
                      </Typography>
                      {balanceDeduction > 0 && (
                        <Typography variant="caption" color="text.secondary">
                          预计余额抵扣 {formatMoney(balanceDeduction, planCurrency)}
                        </Typography>
                      )}
                      {appliedCoupon && discountAmount > 0 && (
                        <Typography variant="caption" color="text.secondary">
                          原价{' '}
                          <Typography
                            component="span"
                            variant="caption"
                            sx={{ textDecoration: 'line-through' }}
                          >
                            {formatMoney(price, planCurrency)}
                          </Typography>
                          {' · 已优惠 '}
                          {formatMoney(discountAmount, planCurrency)}
                        </Typography>
                      )}
                      {planChangeOrder && surplusEnabled && (
                        <Typography variant="caption" color="text.secondary">
                          创建订单后会再按后台规则计算套餐折抵
                        </Typography>
                      )}
                      <TextField
                        select
                        size="small"
                        label="周期"
                        value={period}
                        onChange={(event) => {
                          setCheckedCoupons({})
                          if (coupon.trim()) {
                            setCouponMessageType('info')
                            setCouponMessage('周期已变化，请重新检查优惠码')
                          }
                          setPeriodByPlan((prev) => ({
                            ...prev,
                            [key]: event.target.value,
                          }))
                        }}
                      >
                        {periods.map(([periodKey, label]) => (
                          <MenuItem key={periodKey} value={periodKey}>
                            {label} ·{' '}
                            {formatMoney(plan[periodKey], planCurrency)}
                          </MenuItem>
                        ))}
                      </TextField>
                      <XboardActionButton
                        startIcon={
                          busyPlan === key ? (
                            <CircularProgress color="inherit" size={16} />
                          ) : (
                            <PaymentRounded />
                          )
                        }
                        disabled={!period || busyPlan === key || purchaseDisabled}
                        onClick={() => void checkout(plan)}
                      >
                        {purchaseDisabled
                          ? '后台关闭更换'
                          : busyPlan === key
                            ? '处理中...'
                            : '下单并支付'}
                      </XboardActionButton>
                      <Button
                        size="small"
                        startIcon={
                          detailPlan === key ? (
                            <CircularProgress color="inherit" size={16} />
                          ) : (
                            <OpenInNewRounded />
                          )
                        }
                        disabled={detailPlan === key}
                        onClick={() => void refreshPlanDetail(planId, key)}
                      >
                        重新拉取详情
                      </Button>
                    </Stack>
                  </XboardPanel>
                </Grid>
              )
            })}
          </Grid>
        ) : (
          <XboardEmpty title="暂无套餐" description="当前暂无可购买套餐。" />
        )}
      </Stack>
    </XboardPage>
  )
}

export default PlansPage
