import type { XboardOrderCheckoutResult, XboardRecord } from './types'

export const getTradeNo = (order: unknown) => {
  if (typeof order === 'string' || typeof order === 'number') {
    return String(order)
  }

  const record =
    order && typeof order === 'object' ? (order as XboardRecord) : {}
  return String(
    record.trade_no ??
      record.tradeNo ??
      record.data?.trade_no ??
      record.data?.tradeNo ??
      '',
  )
}

export const getPaymentId = (payment: unknown) => {
  if (!payment) return ''
  if (typeof payment === 'string' || typeof payment === 'number') {
    return String(payment)
  }
  if (typeof payment !== 'object') return ''

  const record = payment as XboardRecord
  const value =
    record.id ??
    record.payment_id ??
    record.paymentId ??
    record.method_id ??
    record.methodId ??
    record.value ??
    record.method ??
    record.payment

  return value === undefined || value === null ? '' : String(value)
}

export const getPaymentLabel = (payment: XboardRecord | undefined) => {
  if (!payment) return '默认支付'
  return String(
    payment.name ??
      payment.label ??
      payment.title ??
      payment.payment ??
      payment.method ??
      getPaymentId(payment) ??
      '默认支付',
  )
}

export const getUsablePayments = (payments: XboardRecord[]) =>
  payments.filter((payment) => {
    const enabled =
      payment.enable ??
      payment.enabled ??
      payment.status ??
      payment.is_enabled ??
      payment.available

    return getPaymentId(payment) && enabled !== false && enabled !== 0
  })

export const findPaymentById = (payments: XboardRecord[], id: string) =>
  payments.find((payment) => getPaymentId(payment) === id)

export const getDefaultPaymentId = (payments: XboardRecord[]) =>
  getPaymentId(getUsablePayments(payments)[0])

const isWebUrl = (value: unknown) =>
  typeof value === 'string' && /^https?:\/\//i.test(value)

export const getCheckoutUrl = (
  checkout: XboardOrderCheckoutResult | XboardRecord | null | undefined,
) => {
  const record =
    checkout && typeof checkout === 'object' ? (checkout as XboardRecord) : {}
  const data = record.data

  if (isWebUrl(data)) return data
  if (isWebUrl(record.url)) return record.url
  if (isWebUrl(record.pay_url)) return record.pay_url
  if (isWebUrl(record.payment_url)) return record.payment_url
  if (isWebUrl(record.checkout_url)) return record.checkout_url

  if (data && typeof data === 'object') {
    const dataRecord = data as XboardRecord
    if (isWebUrl(dataRecord.url)) return dataRecord.url
    if (isWebUrl(dataRecord.pay_url)) return dataRecord.pay_url
    if (isWebUrl(dataRecord.payment_url)) return dataRecord.payment_url
    if (isWebUrl(dataRecord.checkout_url)) return dataRecord.checkout_url
  }

  return ''
}

export const isCheckoutCompleted = (
  checkout: XboardOrderCheckoutResult | XboardRecord | null | undefined,
) => {
  const record =
    checkout && typeof checkout === 'object' ? (checkout as XboardRecord) : {}

  return (
    record.type === -1 ||
    record.type === 2 ||
    record.data === true ||
    record.status === 3 ||
    record.status === 'paid'
  )
}

export const getCheckoutMessage = (
  checkout: XboardOrderCheckoutResult | XboardRecord | null | undefined,
) => {
  const record =
    checkout && typeof checkout === 'object' ? (checkout as XboardRecord) : {}
  const data = record.data
  if (typeof record.message === 'string') return record.message
  if (typeof record.msg === 'string') return record.msg
  if (data && typeof data === 'object') {
    const dataRecord = data as XboardRecord
    if (typeof dataRecord.message === 'string') return dataRecord.message
    if (typeof dataRecord.msg === 'string') return dataRecord.msg
  }
  return ''
}
