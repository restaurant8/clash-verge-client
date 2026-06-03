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
  alpha,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
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

const statusColor = (status: unknown): 'success' | 'default' =>
  String(status ?? '0') === '1' ? 'default' : 'success'

const normalizeUrl = (value: unknown) => {
  const text = String(value ?? '').trim()
  if (!text) return ''
  return /^https?:\/\//i.test(text) ? text : `https://${text}`
}

const ticketTitle = (ticket: any, index: number) =>
  String(ticket?.subject ?? ticket?.title ?? `工单 ${index + 1}`)

const ticketDate = (value: unknown) => (value ? formatDateTime(value) : '-')

const messageText = (item: any) =>
  String(item?.message ?? item?.content ?? item?.text ?? JSON.stringify(item))

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

  const selectedStatus = selectedTicket?.status ?? detail?.status
  const selectedClosed = String(selectedStatus ?? '0') === '1'

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
      subtitle="提交问题、查看进度，并与客服持续沟通。"
      action={
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
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
            官方网站
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
        </Stack>
      }
    >
      <Stack spacing={2} sx={{ minHeight: 0 }}>
        {feedback && <Alert severity={feedbackType}>{feedback}</Alert>}

        <Grid container spacing={2} sx={{ alignItems: 'stretch' }}>
          <Grid size={{ xs: 12, lg: 4 }}>
            <Stack spacing={2} sx={{ height: '100%' }}>
              <XboardPanel
                title="新建工单"
                action={<Chip size="small" label={levelText(level)} />}
              >
                <Stack spacing={1.5}>
                  <Grid container spacing={1.5}>
                    <Grid size={{ xs: 12, sm: 7, lg: 12, xl: 7 }}>
                      <TextField
                        label="主题"
                        value={subject}
                        onChange={(event) => setSubject(event.target.value)}
                        fullWidth
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 5, lg: 12, xl: 5 }}>
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
                  </Grid>
                  <TextField
                    label="消息"
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    fullWidth
                    multiline
                    minRows={4}
                  />
                  <Button
                    variant="contained"
                    disableElevation
                    fullWidth
                    startIcon={
                      creating ? (
                        <CircularProgress color="inherit" size={16} />
                      ) : (
                        <AddCommentRounded />
                      )
                    }
                    disabled={creating || !subject.trim() || !message.trim()}
                    onClick={() => void createTicket()}
                    sx={{ minHeight: 42, fontWeight: 800 }}
                  >
                    提交工单
                  </Button>
                </Stack>
              </XboardPanel>

              <XboardPanel
                title="我的工单"
                action={
                  <Tooltip title="刷新工单">
                    <span>
                      <IconButton
                        size="small"
                        disabled={refreshingTickets}
                        onClick={() => void refreshTickets()}
                      >
                        {refreshingTickets ? (
                          <CircularProgress color="inherit" size={18} />
                        ) : (
                          <RefreshRounded fontSize="small" />
                        )}
                      </IconButton>
                    </span>
                  </Tooltip>
                }
                sx={{
                  flex: 1,
                  minHeight: 260,
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                {tickets.length ? (
                  <Stack
                    spacing={1}
                    sx={{
                      flex: 1,
                      minHeight: 0,
                      maxHeight: { xs: 320, lg: 430 },
                      overflow: 'auto',
                      pr: 0.5,
                    }}
                  >
                    {tickets.map((ticket, index) => {
                      const id = String(getId(ticket) ?? index)
                      const selected = selectedId === id
                      return (
                        <Box
                          key={id}
                          onClick={() => setSelectedIdOverride(id)}
                          sx={(theme) => ({
                            p: 1.5,
                            borderRadius: 1,
                            border: '1px solid',
                            borderColor: selected
                              ? theme.palette.primary.main
                              : theme.palette.divider,
                            bgcolor: selected
                              ? alpha(theme.palette.primary.main, 0.07)
                              : theme.palette.background.paper,
                            cursor: 'pointer',
                            transition:
                              'border-color .16s ease, background-color .16s ease',
                            '&:hover': {
                              borderColor: theme.palette.primary.main,
                              bgcolor: alpha(theme.palette.primary.main, 0.04),
                            },
                          })}
                        >
                          <Stack spacing={1}>
                            <Stack
                              direction="row"
                              spacing={1}
                              sx={{
                                alignItems: 'flex-start',
                                justifyContent: 'space-between',
                                minWidth: 0,
                              }}
                            >
                              <Box sx={{ minWidth: 0 }}>
                                <Typography noWrap sx={{ fontWeight: 800 }}>
                                  {ticketTitle(ticket, index)}
                                </Typography>
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                >
                                  {ticketDate(ticket.created_at)}
                                </Typography>
                              </Box>
                              <Chip
                                size="small"
                                color={statusColor(ticket.status)}
                                label={statusText(ticket.status)}
                                sx={{ flex: '0 0 auto', fontWeight: 700 }}
                              />
                            </Stack>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{ display: 'block' }}
                            >
                              优先级：{levelText(ticket.level)}
                            </Typography>
                          </Stack>
                        </Box>
                      )
                    })}
                  </Stack>
                ) : (
                  <XboardEmpty
                    title="暂无工单"
                    description="创建工单后会在这里显示处理进度。"
                  />
                )}
              </XboardPanel>
            </Stack>
          </Grid>

          <Grid size={{ xs: 12, lg: 8 }}>
            {selectedId ? (
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
                    disabled={closing || selectedClosed}
                    onClick={() => void closeTicket()}
                  >
                    关闭
                  </Button>
                }
                sx={{
                  height: '100%',
                  minHeight: 540,
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <Stack spacing={1.5} sx={{ flex: 1, minHeight: 0 }}>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                    }}
                  >
                    <Typography variant="body2" color="text.secondary">
                      工单 #{selectedId}
                    </Typography>
                    <Stack direction="row" spacing={1}>
                      <Chip
                        size="small"
                        label={levelText(selectedTicket?.level ?? detail?.level)}
                        variant="outlined"
                      />
                      <Chip
                        size="small"
                        color={statusColor(selectedStatus)}
                        label={statusText(selectedStatus)}
                        sx={{ fontWeight: 700 }}
                      />
                    </Stack>
                  </Stack>

                  <Divider />

                  <Stack
                    spacing={1.2}
                    sx={{
                      flex: 1,
                      minHeight: 0,
                      overflow: 'auto',
                      pr: 0.5,
                    }}
                  >
                    {messages.length ? (
                      messages.map((item, index) => {
                        const fromAdmin = Boolean(item.is_admin)
                        return (
                          <Box
                            key={item.id ?? index}
                            sx={(theme) => ({
                              alignSelf: fromAdmin ? 'flex-start' : 'flex-end',
                              width: { xs: '100%', md: '82%' },
                              p: 1.5,
                              borderRadius: 1,
                              bgcolor: fromAdmin
                                ? theme.palette.background.paper
                                : alpha(theme.palette.primary.main, 0.08),
                              border: '1px solid',
                              borderColor: fromAdmin
                                ? theme.palette.divider
                                : alpha(theme.palette.primary.main, 0.24),
                            })}
                          >
                            <Stack spacing={0.5}>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
                                {fromAdmin ? '客服' : '用户'} ·{' '}
                                {ticketDate(item.created_at)}
                              </Typography>
                              <Typography sx={{ whiteSpace: 'pre-wrap' }}>
                                {messageText(item)}
                              </Typography>
                            </Stack>
                          </Box>
                        )
                      })
                    ) : (
                      <XboardEmpty
                        title="暂无对话内容"
                        description="选择工单后会显示详细沟通记录。"
                      />
                    )}
                  </Stack>

                  <Divider />

                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1.2}
                    sx={{ alignItems: 'stretch' }}
                  >
                    <TextField
                      label={selectedClosed ? '工单已关闭' : '回复'}
                      value={reply}
                      onChange={(event) => setReply(event.target.value)}
                      fullWidth
                      multiline
                      minRows={2}
                      disabled={selectedClosed}
                    />
                    <Button
                      variant="contained"
                      disableElevation
                      startIcon={
                        replying ? (
                          <CircularProgress color="inherit" size={16} />
                        ) : (
                          <SendRounded />
                        )
                      }
                      disabled={replying || selectedClosed || !reply.trim()}
                      onClick={() => void replyTicket()}
                      sx={{
                        minWidth: { xs: '100%', sm: 116 },
                        fontWeight: 800,
                      }}
                    >
                      回复
                    </Button>
                  </Stack>
                </Stack>
              </XboardPanel>
            ) : (
              <XboardPanel
                title="工单详情"
                sx={{ height: '100%', minHeight: 540 }}
              >
                <XboardEmpty
                  title="请选择工单"
                  description="左侧选择一条工单后查看对话和处理状态。"
                />
              </XboardPanel>
            )}
          </Grid>
        </Grid>
      </Stack>
    </XboardPage>
  )
}

export default TicketsPage
