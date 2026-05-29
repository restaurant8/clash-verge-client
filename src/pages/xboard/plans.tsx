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
import { formatCurrency, orderStatusText } from '@/services/xboard/format'
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

const availablePeriods = (plan: any) =>
  PERIODS.filter(([key]) => Number(plan[key] ?? 0) > 0)

const asRecord = (value: unknown): XboardRecord =>
  value && typeof value === 'object' ? (value as XboardRecord) : {}

const numberValue = (value: unknown) => {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? number : 0
}

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

const describeCoupon = (coupon: XboardRecord, currency?: string) => {
  const type = Number(coupon.type ?? coupon.discount_type ?? 0)
  const value = numberValue(coupon.value ?? coupon.discount_value)

  if (type === 1) return `立减 ${formatCurrency(value, currency)}`
  if (type === 2) return `优惠 ${value}%`
  return '优惠码可用'
}

const PlansPage = () => {
  const {
    session,
    client,
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
  const [checkedCoupon, setCheckedCoupon] = useState<CouponPreview | null>(null)

  useEffect(() => {
    void loadPlans()
  }, [loadPlans])

  const plans = useMemo(() => resourceCache.plans ?? [], [resourceCache.plans])
  const payments = useMemo(
    () => getUsablePayments(resourceCache.payments ?? []),
    [resourceCache.payments],
  )
  const defaultPayment = useMemo(
    () => getDefaultPaymentId(payments),
    [payments],
  )
  const selectedPaymentValue = selectedPayment || defaultPayment
  const planChangeEnabled = pickBool(
    true,
    appConfig?.features?.plan_change_enable,
    appConfig?.business_rules?.plan_change_enable,
    remote.bootstrap?.features?.plan_change_enable,
  )
  const surplusEnabled = pickBool(
    true,
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

  const couponTarget = useMemo<CouponTarget | null>(() => {
    for (let index = 0; index < plans.length; index += 1) {
      const plan = plans[index]
      const planId = getId(plan)
      if (planId === undefined || planId === null) continue
      const key = String(planId)
      const period = periodByPlan[key] || availablePeriods(plan)[0]?.[0]
      if (period) {
        return {
          planId,
          period,
          planName: String(plan.name ?? `套餐 ${index + 1}`),
        }
      }
    }
    return null
  }, [periodByPlan, plans])

  const verifyCoupon = async (
    target: CouponTarget | null,
    interactive: boolean,
  ) => {
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
      setCheckedCoupon({
        ...target,
        code,
        coupon: couponData,
      })
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
      return result
    } catch (error) {
      setCheckedCoupon(null)
      setCouponMessageType('error')
      setCouponMessage(
        error instanceof Error ? error.message : '优惠码不可用，请检查后重试',
      )
      throw error
    } finally {
      if (interactive) {
        setCheckingCoupon(false)
      }
    }
  }

  const checkCoupon = useLockFn(async () => {
    try {
      await verifyCoupon(couponTarget, true)
    } catch {
      // The field helper text already shows the backend validation message.
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
    const period = periodByPlan[planKey] || periods[0]?.[0]
    if (!period) throw new Error('该套餐没有可购买周期')
    const planChangeOrder = isPlanChangeOrder(planId, period)

    setBusyPlan(planKey)
    setMessageType('info')
    setMessage('')
    try {
      if (!selectedPaymentValue) {
        throw new Error('当前没有可用支付方式，请刷新套餐或检查后台支付配置')
      }
      if (planChangeOrder && !planChangeEnabled) {
        throw new Error('后台当前关闭更换订阅，请联系客服处理')
      }

      if (coupon.trim()) {
        setMessage('正在校验优惠码')
        await verifyCoupon(
          {
            planId,
            planName: String(plan.name ?? '当前套餐'),
            period,
          },
          false,
        )
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

      const order = await client.saveOrder(session.authData, {
        plan_id: planId,
        period,
        coupon_code: coupon.trim() || undefined,
      })
      const tradeNo = getTradeNo(order)
      if (!tradeNo) throw new Error('订单创建失败，请稍后重试')
      void loadOrders(true)
      setMessage(
        planChangeOrder && surplusEnabled
          ? `订单已创建：${tradeNo}，已由后台计算折抵，正在发起支付`
          : `订单已创建：${tradeNo}，正在发起支付`,
      )

      const checkoutResult = await client.checkoutOrder(session.authData, {
        trade_no: tradeNo,
        method: selectedPaymentValue,
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
            '支付请求已提交，请在订单页继续确认状态',
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
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                label="优惠券"
                placeholder="可选"
                value={coupon}
                onChange={(event) => {
                  setCoupon(event.target.value)
                  setCheckedCoupon(null)
                  if (event.target.value.trim()) {
                    setCouponMessageType('info')
                    setCouponMessage('下单时会先校验优惠码')
                  } else {
                    setCouponMessage('')
                  }
                }}
                fullWidth
                helperText={couponMessage || undefined}
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
                            !coupon.trim() || !couponTarget || checkingCoupon
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
            <Grid size={{ xs: 12, md: 6 }}>
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
          </Grid>
        </XboardPanel>

        {plans.length ? (
          <Grid container spacing={2}>
            {plans.map((plan, index) => {
              const planId = getId(plan) ?? index
              const key = String(planId)
              const periods = availablePeriods(plan)
              const period = periodByPlan[key] || periods[0]?.[0] || ''
              const price = plan[period]
              const appliedCoupon =
                checkedCoupon?.code === coupon.trim() &&
                String(checkedCoupon.planId) === String(planId) &&
                checkedCoupon.period === period
                  ? checkedCoupon.coupon
                  : undefined
              const discountedPrice = getDiscountedPrice(price, appliedCoupon)
              const discountAmount = numberValue(price) - discountedPrice
              const planChangeOrder = isPlanChangeOrder(planId, period)
              const purchaseDisabled = planChangeOrder && !planChangeEnabled

              return (
                <Grid size={{ xs: 12, md: 6, xl: 4 }} key={key}>
                  <XboardPanel
                    title={plan.name ?? `套餐 ${index + 1}`}
                    action={
                      <Stack direction="row" spacing={0.75}>
                        {planChangeOrder && surplusEnabled && (
                          <Chip size="small" color="info" label="后台折抵" />
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
                          ? formatCurrency(
                              discountedPrice,
                              plan.currency ?? 'CNY',
                            )
                          : '-'}
                      </Typography>
                      {appliedCoupon && discountAmount > 0 && (
                        <Typography variant="caption" color="text.secondary">
                          原价{' '}
                          <Typography
                            component="span"
                            variant="caption"
                            sx={{ textDecoration: 'line-through' }}
                          >
                            {formatCurrency(price, plan.currency ?? 'CNY')}
                          </Typography>
                          {' · 已优惠 '}
                          {formatCurrency(
                            discountAmount,
                            plan.currency ?? 'CNY',
                          )}
                        </Typography>
                      )}
                      <TextField
                        select
                        size="small"
                        label="周期"
                        value={period}
                        onChange={(event) => {
                          setCheckedCoupon(null)
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
                            {formatCurrency(
                              plan[periodKey],
                              plan.currency ?? 'CNY',
                            )}
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
