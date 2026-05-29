import {
  AddCommentRounded,
  CloseRounded,
  OpenInNewRounded,
  RefreshRounded,
  SendRounded,
  SupportAgentRounded,
} from '@mui/icons-material'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  Grid,
  IconButton,
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
import { formatDateTime } from '@/services/xboard/format'

import { getId, listFrom } from './utils'

const levelText = (level: unknown) => {
  const map: Record<string, string> = {
    '0': '低',
    '1': '普通',
    '2': '高',
  }
  return map[String(level ?? '1')] ?? '普通'
}

const statusText = (status: unknown) => {
  const map: Record<string, string> = {
    '0': '处理中',
    '1': '已关闭',
  }
  return map[String(status ?? '0')] ?? '处理中'
}

const normalizeUrl = (value: unknown) => {
  const text = String(value ?? '').trim()
  if (!text) return ''
  return /^https?:\/\//i.test(text) ? text : `https://${text}`
}

const TicketsPage = () => {
  const {
    session,
    client,
    appConfig,
    remote,
    resourceCache,
    loadTickets,
    loadTicketDetail,
  } = useXboard()
  const [selectedIdOverride, setSelectedIdOverride] = useState<string>('')
  const [subject, setSubject] = useState('')
  const [level, setLevel] = useState('1')
  const [message, setMessage] = useState('')
  const [reply, setReply] = useState('')
  const [feedback, setFeedback] = useState('')
  const [feedbackType, setFeedbackType] = useState<
    'success' | 'error' | 'info'
  >('info')
  const [creating, setCreating] = useState(false)
  const [replying, setReplying] = useState(false)
  const [closing, setClosing] = useState(false)
  const [openingOfficial, setOpeningOfficial] = useState(false)
  const [refreshingTickets, setRefreshingTickets] = useState(false)

  const ticketMustWaitReply = Boolean(
    appConfig?.features?.ticket_must_wait_reply,
  )

  useEffect(() => {
    void loadTickets()
  }, [loadTickets])

  const tickets = useMemo(
    () => resourceCache.tickets ?? [],
    [resourceCache.tickets],
  )
  const firstTicketId = useMemo(
    () => String(getId(tickets[0]) ?? ''),
    [tickets],
  )
  const selectedId = useMemo(() => {
    if (
      selectedIdOverride &&
      tickets.some((ticket) => String(getId(ticket)) === selectedIdOverride)
    ) {
      return selectedIdOverride
    }
    return firstTicketId
  }, [firstTicketId, selectedIdOverride, tickets])
  const detail = selectedId
    ? resourceCache.ticketDetails[selectedId]
    : undefined
  const hasCrisp = Boolean(remote.remoteConfig.crisp_id)
  const fallbackOfficialUrl =
    normalizeUrl(remote.remoteConfig.official_url) ||
    normalizeUrl(remote.remoteConfig.APP_URL) ||
    remote.activeApiDomain

  useEffect(() => {
    if (selectedId) void loadTicketDetail(selectedId)
  }, [loadTicketDetail, selectedId])

  const selectedTicket = useMemo(
    () => tickets.find((ticket) => String(getId(ticket)) === selectedId),
    [selectedId, tickets],
  )

  const createTicket = useLockFn(async () => {
    if (!session) return
    setFeedback('')
    setCreating(true)
    try {
      await client.createTicket(session.authData, {
        subject: subject.trim(),
        level: Number(level),
        message: message.trim(),
      })
      setSubject('')
      setMessage('')
      setFeedbackType('success')
      setFeedback('工单已提交')
      await loadTickets(true)
    } catch (error) {
      setFeedbackType('error')
      setFeedback(error instanceof Error ? error.message : '提交工单失败')
    } finally {
      setCreating(false)
    }
  })

  const replyTicket = useLockFn(async () => {
    if (!session || !selectedId) return
    setFeedback('')
    setReplying(true)
    try {
      if (ticketMustWaitReply && detail?.last_reply_from === 'user') {
        throw new Error('请等待回复后再继续追加消息')
      }
      await client.replyTicket(session.authData, {
        id: selectedId,
        message: reply.trim(),
      })
      setReply('')
      setFeedbackType('success')
      setFeedback('回复已发送')
      await loadTicketDetail(selectedId, true)
    } catch (error) {
      setFeedbackType('error')
      setFeedback(error instanceof Error ? error.message : '回复失败')
    } finally {
      setReplying(false)
    }
  })

  const closeTicket = useLockFn(async () => {
    if (!session || !selectedId) return
    setFeedback('')
    setClosing(true)
    try {
      await client.closeTicket(session.authData, { id: selectedId })
      setFeedbackType('success')
      setFeedback('工单已关闭')
      await loadTickets(true)
      await loadTicketDetail(selectedId, true)
    } catch (error) {
      setFeedbackType('error')
      setFeedback(error instanceof Error ? error.message : '关闭工单失败')
    } finally {
      setClosing(false)
    }
  })

  const refreshTickets = useLockFn(async () => {
    setRefreshingTickets(true)
    try {
      await loadTickets(true)
    } finally {
      setRefreshingTickets(false)
    }
  })

  const openOfficialWebsite = useLockFn(async () => {
    if (!session) return
    setOpeningOfficial(true)
    try {
      const quickUrl = await client.quickLoginUrl(session.authData, 'dashboard')
      await openWebUrl(quickUrl || fallbackOfficialUrl)
    } catch {
      await openWebUrl(fallbackOfficialUrl)
    } finally {
      setOpeningOfficial(false)
    }
  })

  const openOnlineSupport = () => {
    const crisp = (window as any).$crisp
    if (crisp?.push) {
      crisp.push(['do', 'chat:show'])
      crisp.push(['do', 'chat:open'])
    }
  }

  const messages: any[] = listFrom(
    detail?.message ?? detail?.messages ?? detail,
  )

  if (!session) {
    return (
      <XboardPage title="工单">
        <XboardEmpty title="请先登录" description="登录后才能提交工单。" />
      </XboardPage>
    )
  }

  return (
    <XboardPage
      title="工单"
      action={
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            startIcon={
              openingOfficial ? (
                <CircularProgress color="inherit" size={16} />
              ) : (
                <OpenInNewRounded />
              )
            }
            disabled={openingOfficial || !fallbackOfficialUrl}
            onClick={() => void openOfficialWebsite()}
          >
            官网网站
          </Button>
          {hasCrisp && (
            <Button
              variant="contained"
              disableElevation
              startIcon={<SupportAgentRounded />}
              onClick={openOnlineSupport}
            >
              在线客服
            </Button>
          )}
          <Button
            variant="outlined"
            startIcon={
              refreshingTickets ? (
                <CircularProgress color="inherit" size={16} />
              ) : (
                <RefreshRounded />
              )
            }
            disabled={refreshingTickets}
            onClick={() => void refreshTickets()}
          >
            刷新
          </Button>
        </Stack>
      }
    >
      <Stack spacing={2}>
        {feedback && <Alert severity={feedbackType}>{feedback}</Alert>}

        <XboardPanel title="新建工单">
          <Grid container spacing={1.5} sx={{ alignItems: 'center' }}>
            <Grid size={{ xs: 12, md: 3 }}>
              <TextField
                label="主题"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                fullWidth
              />
            </Grid>
            <Grid size={{ xs: 12, md: 5 }}>
              <TextField
                label="消息"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                fullWidth
              />
            </Grid>
            <Grid size={{ xs: 12, md: 3 }}>
              <TextField
                select
                label="工单等级"
                value={level}
                onChange={(event) => setLevel(event.target.value)}
                fullWidth
              >
                <MenuItem value="0">低</MenuItem>
                <MenuItem value="1">普通</MenuItem>
                <MenuItem value="2">高</MenuItem>
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, md: 1 }}>
              <IconButton
                color="primary"
                disabled={creating || !subject.trim() || !message.trim()}
                onClick={() => void createTicket()}
                sx={{
                  width: { xs: '100%', md: 48 },
                  height: 48,
                  borderRadius: 1,
                  bgcolor: 'primary.main',
                  color: 'primary.contrastText',
                  '&:hover': { bgcolor: 'primary.dark' },
                  '&.Mui-disabled': {
                    bgcolor: 'action.disabledBackground',
                    color: 'action.disabled',
                  },
                }}
              >
                {creating ? (
                  <CircularProgress color="inherit" size={18} />
                ) : (
                  <AddCommentRounded />
                )}
              </IconButton>
            </Grid>
          </Grid>
        </XboardPanel>

        <XboardPanel title="工单">
          {tickets.length ? (
            <Stack spacing={1}>
              {tickets.map((ticket, index) => {
                const id = String(getId(ticket) ?? index)
                const selected = selectedId === id
                return (
                  <Box
                    key={id}
                    onClick={() => setSelectedIdOverride(id)}
                    sx={{
                      p: 1.5,
                      borderRadius: 1.5,
                      border: '1px solid',
                      borderColor: selected ? 'primary.main' : 'divider',
                      bgcolor: '#fff',
                      cursor: 'pointer',
                    }}
                  >
                    <Stack
                      direction={{ xs: 'column', sm: 'row' }}
                      spacing={1}
                      sx={{
                        alignItems: { xs: 'flex-start', sm: 'center' },
                        justifyContent: 'space-between',
                      }}
                    >
                      <Box sx={{ minWidth: 0 }}>
                        <Typography noWrap sx={{ fontWeight: 800 }}>
                          {ticket.subject ?? `工单 ${index + 1}`}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {formatDateTime(ticket.created_at)}
                        </Typography>
                      </Box>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ flex: '0 0 auto' }}
                      >
                        {levelText(ticket.level)} · {statusText(ticket.status)}
                      </Typography>
                    </Stack>
                  </Box>
                )
              })}
            </Stack>
          ) : (
            <Typography color="text.secondary">暂无工单</Typography>
          )}
        </XboardPanel>

        {selectedId && (
          <XboardPanel
            title={selectedTicket?.subject ?? '工单详情'}
            action={
              <Button
                color="error"
                startIcon={
                  closing ? (
                    <CircularProgress color="inherit" size={16} />
                  ) : (
                    <CloseRounded />
                  )
                }
                disabled={closing}
                onClick={() => void closeTicket()}
              >
                关闭
              </Button>
            }
          >
            <Stack spacing={1.2}>
              {messages.length ? (
                messages.map((item, index) => (
                  <Box
                    key={item.id ?? index}
                    sx={{
                      p: 1.25,
                      borderRadius: 1.5,
                      bgcolor: '#fff',
                      border: '1px solid',
                      borderColor: 'divider',
                    }}
                  >
                    <Typography variant="caption" color="text.secondary">
                      {item.is_admin ? '客服' : '用户'} ·{' '}
                      {formatDateTime(item.created_at)}
                    </Typography>
                    <Typography sx={{ whiteSpace: 'pre-wrap' }}>
                      {item.message ?? item.content ?? JSON.stringify(item)}
                    </Typography>
                  </Box>
                ))
              ) : (
                <Typography color="text.secondary">暂无对话内容</Typography>
              )}
              <Divider />
              <Grid container spacing={1.5} sx={{ alignItems: 'center' }}>
                <Grid size={{ xs: 12, md: 10 }}>
                  <TextField
                    label="回复"
                    value={reply}
                    onChange={(event) => setReply(event.target.value)}
                    fullWidth
                  />
                </Grid>
                <Grid size={{ xs: 12, md: 2 }}>
                  <Button
                    variant="contained"
                    disableElevation
                    fullWidth
                    startIcon={
                      replying ? (
                        <CircularProgress color="inherit" size={16} />
                      ) : (
                        <SendRounded />
                      )
                    }
                    disabled={replying || !reply.trim()}
                    onClick={() => void replyTicket()}
                  >
                    回复
                  </Button>
                </Grid>
              </Grid>
            </Stack>
          </XboardPanel>
        )}
      </Stack>
    </XboardPage>
  )
}

export default TicketsPage
