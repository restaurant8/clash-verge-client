import {
  CancelRounded,
  OpenInNewRounded,
  PaymentRounded,
  RefreshRounded,
  ReceiptLongRounded,
} from '@mui/icons-material'
import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  Grid,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import { useEffect, useMemo, useState } from 'react'

import { XboardPage } from '@/components/xboard/xboard-page'
import { XboardEmpty, XboardPanel } from '@/components/xboard/xboard-primitives'
import { useXboard } from '@/providers/xboard-context'
import { openWebUrl } from '@/services/cmds'
import {
  formatCurrency,
  formatDateTime,
  orderStatusText,
} from '@/services/xboard/format'
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

import { sleep } from './utils'

const isPayableOrder = (order: any) => {
  const status = String(order.status ?? order.order_status ?? '')
  return status === '0' || status === ''
}

const OrdersPage = () => {
  const {
    session,
    client,
    refreshAccount,
    resourceCache,
    loadOrders,
    loadPlans,
  } = useXboard()
  const [busyTradeNo, setBusyTradeNo] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<
    'pay' | 'cancel' | 'refresh' | null
  >(null)
  const [selectedPayment, setSelectedPayment] = useState('')
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error' | 'info'>(
    'info',
  )

  useEffect(() => {
    void Promise.all([loadOrders(), loadPlans()])
  }, [loadOrders, loadPlans])

  const orders = resourceCache.orders ?? []
  const payments = useMemo(
    () => getUsablePayments(resourceCache.payments ?? []),
    [resourceCache.payments],
  )
  const defaultPayment = useMemo(
    () => getDefaultPaymentId(payments),
    [payments],
  )
  const selectedPaymentValue = selectedPayment || defaultPayment
  const paymentLabel = useMemo(
    () =>
      payments.length
        ? getPaymentLabel(findPaymentById(payments, selectedPaymentValue))
        : '暂无可用支付方式',
    [payments, selectedPaymentValue],
  )
  const hasPayableOrder = orders.some(isPayableOrder)

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
    setMessage('支付状态暂未确认，可稍后刷新订单或再次继续支付')
  }

  const startOrderPolling = (tradeNo: string) => {
    void pollOrder(tradeNo).catch((error) => {
      setMessageType('error')
      setMessage(error instanceof Error ? error.message : '订单状态确认失败')
    })
  }

  const continuePay = useLockFn(async (order: any) => {
    if (!session) return
    const tradeNo =
      getTradeNo(order) || String(order.trade_no ?? order.id ?? '')
    if (!tradeNo) return
    setBusyTradeNo(tradeNo)
    setBusyAction('pay')
    setMessageType('info')
    setMessage('正在发起支付')
    try {
      const paymentId =
        selectedPaymentValue ||
        getPaymentId(order.payment) ||
        String(order.payment_id ?? order.method ?? '')

      if (!paymentId) {
        throw new Error('当前没有可用支付方式，请刷新套餐或检查后台支付配置')
      }

      const checkout = await client.checkoutOrder(session.authData, {
        trade_no: tradeNo,
        method: paymentId,
      })

      if (isCheckoutCompleted(checkout)) {
        await Promise.all([refreshAccount(), loadOrders(true)])
        setMessageType('success')
        setMessage('订单已完成，权益已刷新')
        return
      }

      const checkoutUrl = getCheckoutUrl(checkout)
      if (checkoutUrl) {
        await openWebUrl(checkoutUrl)
        setMessage('已打开支付页，支付完成后会自动尝试确认订单')
      } else {
        setMessage(
          getCheckoutMessage(checkout) ||
            '支付请求已提交，支付完成后请刷新订单状态',
        )
      }
      startOrderPolling(tradeNo)
    } catch (error) {
      setMessageType('error')
      setMessage(
        error instanceof Error ? error.message : '支付失败，请稍后重试',
      )
    } finally {
      setBusyTradeNo(null)
      setBusyAction(null)
    }
  })

  const cancelOrder = useLockFn(async (order: any) => {
    if (!session) return
    const tradeNo = String(order.trade_no ?? order.id ?? '')
    if (!tradeNo) return
    setBusyTradeNo(tradeNo)
    setBusyAction('cancel')
    try {
      await client.cancelOrder(session.authData, tradeNo)
      setMessageType('success')
      setMessage(`订单 ${tradeNo} 已提交取消`)
      await loadOrders(true)
    } catch (error) {
      setMessageType('error')
      setMessage(error instanceof Error ? error.message : '取消订单失败')
    } finally {
      setBusyTradeNo(null)
      setBusyAction(null)
    }
  })

  const refreshOrders = useLockFn(async () => {
    setBusyAction('refresh')
    try {
      await loadOrders(true)
    } finally {
      setBusyAction(null)
    }
  })

  if (!session) {
    return (
      <XboardPage title="订单">
        <XboardEmpty title="请先登录" description="登录后才能查看订单。" />
      </XboardPage>
    )
  }

  return (
    <XboardPage
      title="订单"
      action={
        <Button
          variant="outlined"
          startIcon={
            busyAction === 'refresh' ? (
              <CircularProgress color="inherit" size={16} />
            ) : (
              <RefreshRounded />
            )
          }
          disabled={busyAction === 'refresh'}
          onClick={() => void refreshOrders()}
        >
          刷新订单
        </Button>
      }
    >
      <Stack spacing={2}>
        {message && <Alert severity={messageType}>{message}</Alert>}

        {hasPayableOrder && (
          <XboardPanel title="支付设置">
            <TextField
              select
              label="支付方式"
              value={selectedPaymentValue}
              onChange={(event) => setSelectedPayment(event.target.value)}
              fullWidth
              helperText={`当前：${paymentLabel}`}
              slotProps={{
                input: {
                  startAdornment: <PaymentRounded sx={{ mr: 1 }} />,
                },
              }}
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
          </XboardPanel>
        )}

        {orders.length ? (
          <Grid container spacing={1.5}>
            {orders.map((order, index) => {
              const tradeNo = String(order.trade_no ?? order.id ?? index)
              const status = String(order.status ?? order.order_status ?? '')
              const canPay = isPayableOrder(order)

              return (
                <Grid size={{ xs: 12, md: 6 }} key={tradeNo}>
                  <XboardPanel
                    title={
                      order.plan?.name ?? order.plan_name ?? `订单 ${index + 1}`
                    }
                    action={
                      <Chip
                        size="small"
                        color={
                          status === '3'
                            ? 'success'
                            : canPay
                              ? 'warning'
                              : 'default'
                        }
                        label={orderStatusText(status)}
                      />
                    }
                  >
                    <Stack spacing={1.2}>
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'center' }}
                      >
                        <ReceiptLongRounded fontSize="small" />
                        <Typography variant="body2" sx={{ fontWeight: 800 }}>
                          {tradeNo}
                        </Typography>
                      </Stack>
                      <Typography variant="body2" color="text.secondary">
                        金额：
                        {formatCurrency(
                          order.total_amount ?? order.amount ?? order.price,
                        )}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        创建：
                        {formatDateTime(order.created_at ?? order.createdAt)}
                      </Typography>
                      {canPay && (
                        <Stack direction="row" spacing={1}>
                          <Button
                            variant="contained"
                            disableElevation
                            startIcon={
                              busyTradeNo === tradeNo &&
                              busyAction === 'pay' ? (
                                <CircularProgress color="inherit" size={16} />
                              ) : (
                                <OpenInNewRounded />
                              )
                            }
                            disabled={
                              busyTradeNo === tradeNo || !selectedPaymentValue
                            }
                            onClick={() => void continuePay(order)}
                          >
                            继续支付
                          </Button>
                          <Button
                            color="error"
                            variant="outlined"
                            startIcon={
                              busyTradeNo === tradeNo &&
                              busyAction === 'cancel' ? (
                                <CircularProgress color="inherit" size={16} />
                              ) : (
                                <CancelRounded />
                              )
                            }
                            disabled={busyTradeNo === tradeNo}
                            onClick={() => void cancelOrder(order)}
                          >
                            取消
                          </Button>
                        </Stack>
                      )}
                    </Stack>
                  </XboardPanel>
                </Grid>
              )
            })}
          </Grid>
        ) : (
          <XboardEmpty title="暂无订单" description="当前账户暂无订单记录。" />
        )}
      </Stack>
    </XboardPage>
  )
}

export default OrdersPage
