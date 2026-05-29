import dayjs from 'dayjs'

export const formatBytes = (value: unknown) => {
  const bytes = Number(value ?? 0)
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  )
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 2)} ${units[index]}`
}

export const formatDateTime = (value: unknown) => {
  const timestamp = Number(value ?? 0)
  if (!timestamp) return '不限期'
  const date = timestamp > 10_000_000_000 ? timestamp : timestamp * 1000
  return dayjs(date).format('YYYY-MM-DD HH:mm')
}

export const formatCurrency = (value: unknown, currency = 'CNY') => {
  const amount = Number(value ?? 0)
  if (!Number.isFinite(amount)) return '-'
  const normalized = amount > 1000 ? amount / 100 : amount
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(normalized)
}

export const orderStatusText = (status: unknown) => {
  const map: Record<string, string> = {
    '0': '待支付',
    '1': '开通中',
    '2': '已取消',
    '3': '已完成',
    '4': '已折抵',
    paid: '支付成功',
    success: '支付成功',
    completed: '支付成功',
    pending: '待支付',
    unpaid: '待支付',
    canceled: '已取消',
    cancelled: '已取消',
  }
  return map[String(status).toLowerCase()] ?? `状态 ${String(status ?? '-')}`
}

export const firstDefined = (...values: unknown[]) =>
  values.find((value) => value !== undefined && value !== null && value !== '')
