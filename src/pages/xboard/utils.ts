import { firstDefined } from '@/services/xboard/format'

export const listFrom = (value: any) => {
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.data)) return value.data
  if (Array.isArray(value?.items)) return value.items
  if (Array.isArray(value?.list)) return value.list
  return []
}

export const textFrom = (...values: unknown[]) =>
  String(firstDefined(...values) ?? '')

export const numberFrom = (...values: unknown[]) => {
  const value = firstDefined(...values)
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

export const getId = (value: any) => value?.id ?? value?.plan_id ?? value?.uid

export const sleep = (ms: number) =>
  new Promise((resolve) => window.setTimeout(resolve, ms))
