import {
  AccountBalanceWalletRounded,
  CurrencyExchangeRounded,
  GroupsRounded,
  LogoutRounded,
  NotificationsRounded,
  OpenInNewRounded,
  RefreshRounded,
  SmartToyRounded,
  VpnKeyRounded,
} from '@mui/icons-material'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Grid,
  Stack,
  Switch,
  Typography,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import { useEffect, useMemo, useState } from 'react'

import { XboardPage } from '@/components/xboard/xboard-page'
import {
  XboardEmpty,
  XboardMetric,
  XboardPanel,
} from '@/components/xboard/xboard-primitives'
import { useXboard } from '@/providers/xboard-context'
import { openWebUrl } from '@/services/cmds'
import { formatBytes, formatDateTime } from '@/services/xboard/format'
import type { XboardRecord } from '@/services/xboard/types'

const asRecord = (value: unknown): XboardRecord =>
  value && typeof value === 'object' ? (value as XboardRecord) : {}

const numberValue = (value: unknown) => {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? number : 0
}

const flagOn = (value: unknown) =>
  value === true || value === 1 || value === '1' || value === 'true'

const normalizeUrl = (value: unknown) => {
  const text = String(value ?? '').trim()
  if (!text) return ''
  if (text.startsWith('@')) return `https://t.me/${text.slice(1)}`
  if (/^https?:\/\//i.test(text)) return text
  if (/^t\.me\//i.test(text) || /^telegram\.me\//i.test(text)) {
    return `https://${text}`
  }
  if (!text.includes('.') && !text.includes('/')) return `https://t.me/${text}`
  return text
}

const formatAccountMoney = (value: unknown, currency = 'CNY') =>
  new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(numberValue(value) / 100)

const AccountPage = () => {
  const {
    session,
    userInfo,
    subscribeInfo,
    client,
    remote,
    refreshAccount,
    logout,
  } = useXboard()
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error' | 'info'>(
    'info',
  )
  const [refreshingAccount, setRefreshingAccount] = useState(false)
  const [resettingSecurity, setResettingSecurity] = useState(false)
  const [transferring, setTransferring] = useState(false)
  const [loadingExtras, setLoadingExtras] = useState(false)
  const [savingReminder, setSavingReminder] = useState<
    'remind_expire' | 'remind_traffic' | null
  >(null)
  const [commConfig, setCommConfig] = useState<XboardRecord>({})
  const [inviteInfo, setInviteInfo] = useState<XboardRecord>({})
  const [telegramBot, setTelegramBot] = useState<XboardRecord>({})
  const [reminderOverrides, setReminderOverrides] = useState<
    Partial<Record<'remind_expire' | 'remind_traffic', boolean>>
  >({})

  const loadAccountExtras = useLockFn(async () => {
    if (!session) return
    setLoadingExtras(true)
    try {
      const [commPayload, invitePayload, botPayload] = await Promise.all([
        client.userCommConfig(session.authData).catch(() => ({})),
        client.inviteInfo(session.authData).catch(() => ({})),
        client.telegramBotInfo(session.authData).catch(() => ({})),
      ])
      setCommConfig(asRecord(commPayload))
      setInviteInfo(asRecord(invitePayload))
      setTelegramBot(asRecord(botPayload))
    } finally {
      setLoadingExtras(false)
    }
  })

  useEffect(() => {
    void loadAccountExtras()
  }, [loadAccountExtras])

  const resetSecurity = useLockFn(async () => {
    if (!session) return
    setResettingSecurity(true)
    setMessage('')
    try {
      await client.resetSecurity(session.authData)
      await refreshAccount()
      setMessageType('success')
      setMessage(
        '订阅安全已重置，本地订阅 token 已刷新。请重新连接以热更新配置。',
      )
    } catch (error) {
      setMessageType('error')
      setMessage(error instanceof Error ? error.message : '重置订阅失败')
    } finally {
      setResettingSecurity(false)
    }
  })

  const refreshAccountInfo = useLockFn(async () => {
    setRefreshingAccount(true)
    try {
      await Promise.all([refreshAccount(), loadAccountExtras()])
    } finally {
      setRefreshingAccount(false)
    }
  })

  const updateReminder = useLockFn(
    async (key: 'remind_expire' | 'remind_traffic', checked: boolean) => {
      if (!session) return
      setReminderOverrides((prev) => ({ ...prev, [key]: checked }))
      setSavingReminder(key)
      setMessage('')
      try {
        await client.updateUser(session.authData, {
          [key]: checked ? 1 : 0,
        })
        await refreshAccount()
        setReminderOverrides((prev) => {
          const next = { ...prev }
          delete next[key]
          return next
        })
        setMessageType('success')
        setMessage('通知设置已保存')
      } catch (error) {
        setReminderOverrides((prev) => {
          const next = { ...prev }
          delete next[key]
          return next
        })
        setMessageType('error')
        setMessage(error instanceof Error ? error.message : '通知设置保存失败')
      } finally {
        setSavingReminder(null)
      }
    },
  )

  const inviteStat = Array.isArray(inviteInfo.stat) ? inviteInfo.stat : []
  const currency = String(commConfig.currency || 'CNY')
  const balance = numberValue(userInfo?.balance)
  const commissionBalance = numberValue(
    userInfo?.commission_balance ?? inviteStat[4],
  )
  const expireReminder =
    reminderOverrides.remind_expire ?? flagOn(userInfo?.remind_expire)
  const trafficReminder =
    reminderOverrides.remind_traffic ?? flagOn(userInfo?.remind_traffic)

  const transferRebate = useLockFn(async () => {
    if (!session || commissionBalance <= 0) return
    setTransferring(true)
    setMessage('')
    try {
      await client.transferCommission(
        session.authData,
        Math.trunc(commissionBalance),
      )
      await Promise.all([refreshAccount(), loadAccountExtras()])
      setMessageType('success')
      setMessage('返利已转换到余额')
    } catch (error) {
      setMessageType('error')
      setMessage(error instanceof Error ? error.message : '返利转换失败')
    } finally {
      setTransferring(false)
    }
  })

  const openUrl = (url: string) => {
    if (url) void openWebUrl(url)
  }

  const telegramBotUrl = useMemo(() => {
    const username = String(telegramBot.username ?? '').replace(/^@/, '')
    if (username) return `https://t.me/${username}`
    return normalizeUrl(remote.remoteConfig.telegram_bot)
  }, [remote.remoteConfig.telegram_bot, telegramBot.username])

  const telegramGroupUrl = useMemo(
    () =>
      normalizeUrl(
        commConfig.telegram_discuss_link || remote.remoteConfig.tg_channel,
      ),
    [commConfig.telegram_discuss_link, remote.remoteConfig.tg_channel],
  )

  if (!session) {
    return (
      <XboardPage title="我的账户" subtitle="登录后展示账户和订阅信息。">
        <XboardEmpty title="请先登录" />
      </XboardPage>
    )
  }

  const used = Number(subscribeInfo?.u ?? 0) + Number(subscribeInfo?.d ?? 0)

  return (
    <XboardPage
      title="我的账户"
      subtitle="账号、订阅和安全状态会随云端实时同步。"
      action={
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            startIcon={
              refreshingAccount || loadingExtras ? (
                <CircularProgress color="inherit" size={16} />
              ) : (
                <RefreshRounded />
              )
            }
            disabled={refreshingAccount || loadingExtras}
            onClick={() => void refreshAccountInfo()}
          >
            刷新
          </Button>
          <Button
            color="error"
            variant="outlined"
            startIcon={<LogoutRounded />}
            onClick={logout}
          >
            退出
          </Button>
        </Stack>
      }
    >
      <Stack spacing={2}>
        {message && <Alert severity={messageType}>{message}</Alert>}

        <Grid container spacing={1.5}>
          <Grid size={{ xs: 12, md: 4 }}>
            <XboardMetric
              label="邮箱"
              value={userInfo?.email ?? session.email ?? '-'}
              valueSx={{
                fontSize: 16,
                lineHeight: 1.35,
                overflowWrap: 'anywhere',
              }}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 4 }}>
            <XboardMetric
              label="套餐"
              value={subscribeInfo?.plan?.name ?? '未开通'}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 4 }}>
            <XboardMetric label="已用流量" value={formatBytes(used)} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 4 }}>
            <XboardMetric
              label="到期时间"
              value={formatDateTime(subscribeInfo?.expired_at)}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 4 }}>
            <XboardMetric
              label="余额"
              value={formatAccountMoney(balance, currency)}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 4 }}>
            <XboardMetric
              label="返利（转换）"
              value={formatAccountMoney(commissionBalance, currency)}
              helper={
                inviteStat[3] !== undefined
                  ? `比例 ${numberValue(inviteStat[3])}%`
                  : undefined
              }
            />
          </Grid>
        </Grid>

        <XboardPanel
          title="返利"
          action={
            <Button
              variant="outlined"
              startIcon={
                transferring ? (
                  <CircularProgress color="inherit" size={16} />
                ) : (
                  <CurrencyExchangeRounded />
                )
              }
              disabled={transferring || commissionBalance <= 0}
              onClick={() => void transferRebate()}
            >
              转换到余额
            </Button>
          }
        >
          <Grid container spacing={1.5}>
            <Grid size={{ xs: 12, sm: 4 }}>
              <Typography variant="caption" color="text.secondary">
                已邀请
              </Typography>
              <Typography sx={{ fontWeight: 800 }}>
                {numberValue(inviteStat[0])} 人
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <Typography variant="caption" color="text.secondary">
                累计返利
              </Typography>
              <Typography sx={{ fontWeight: 800 }}>
                {formatAccountMoney(inviteStat[1], currency)}
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <Typography variant="caption" color="text.secondary">
                确认中
              </Typography>
              <Typography sx={{ fontWeight: 800 }}>
                {formatAccountMoney(inviteStat[2], currency)}
              </Typography>
            </Grid>
          </Grid>
        </XboardPanel>

        <XboardPanel title="Telegram">
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button
              variant="outlined"
              startIcon={<SmartToyRounded />}
              endIcon={<OpenInNewRounded />}
              disabled={!telegramBotUrl}
              onClick={() => openUrl(telegramBotUrl)}
            >
              Telegram 机器人
            </Button>
            <Button
              variant="outlined"
              startIcon={<GroupsRounded />}
              endIcon={<OpenInNewRounded />}
              disabled={!telegramGroupUrl}
              onClick={() => openUrl(telegramGroupUrl)}
            >
              Telegram 群组
            </Button>
          </Stack>
        </XboardPanel>

        <XboardPanel title="通知">
          <Stack spacing={1}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 2,
              }}
            >
              <Stack direction="row" spacing={1.2} sx={{ alignItems: 'center' }}>
                <NotificationsRounded color="action" />
                <Typography>到期邮件提醒</Typography>
              </Stack>
              <Switch
                checked={expireReminder}
                disabled={savingReminder === 'remind_expire'}
                onChange={(event) =>
                  void updateReminder('remind_expire', event.target.checked)
                }
              />
            </Box>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 2,
              }}
            >
              <Stack direction="row" spacing={1.2} sx={{ alignItems: 'center' }}>
                <AccountBalanceWalletRounded color="action" />
                <Typography>流量邮件提醒</Typography>
              </Stack>
              <Switch
                checked={trafficReminder}
                disabled={savingReminder === 'remind_traffic'}
                onChange={(event) =>
                  void updateReminder('remind_traffic', event.target.checked)
                }
              />
            </Box>
          </Stack>
        </XboardPanel>

        <XboardPanel
          title="订阅安全"
          action={
            <Button
              color="warning"
              variant="outlined"
              startIcon={
                resettingSecurity ? (
                  <CircularProgress color="inherit" size={16} />
                ) : (
                  <VpnKeyRounded />
                )
              }
              disabled={resettingSecurity}
              onClick={() => void resetSecurity()}
            >
              重置订阅
            </Button>
          }
        >
          <Typography variant="body2" color="text.secondary">
            重置订阅安全会更换订阅密钥。客户端会重新拉取订阅配置，连接前仍会校验套餐和可用节点。
          </Typography>
        </XboardPanel>
      </Stack>
    </XboardPage>
  )
}

export default AccountPage
