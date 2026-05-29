import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Stack,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useRef, useState } from 'react'

import { useXboard } from '@/providers/xboard-context'
import type { XboardRecord } from '@/services/xboard/types'

const READ_KEY_PREFIX = 'muacloud.announcement.read.v1'

const textFrom = (...values: unknown[]) =>
  String(values.find((value) => value !== undefined && value !== null) ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()

const noticeTitle = (notice: XboardRecord, index: number) =>
  textFrom(notice.title, notice.subject, notice.name) || `公告 ${index + 1}`

const noticeContent = (notice: XboardRecord) =>
  textFrom(notice.content, notice.message, notice.body, notice.description) ||
  '暂无详情'

const noticeIdentity = (notice: XboardRecord, index: number) => ({
  title: noticeTitle(notice, index),
  content: noticeContent(notice),
  updatedAt:
    notice.updated_at ??
    notice.updatedAt ??
    notice.created_at ??
    notice.createdAt ??
    '',
})

const hashText = (value: string) => {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash.toString(36)
}

const readKeyFor = (email?: string) =>
  `${READ_KEY_PREFIX}:${String(email || 'anonymous')
    .trim()
    .toLowerCase()}`

export const XboardAnnouncementDialog = () => {
  const { session, notices } = useXboard()
  const [open, setOpen] = useState(false)
  const [doNotShowAgain, setDoNotShowAgain] = useState(false)
  const lastPromptRef = useRef('')
  const sessionEmail = session?.email
  const sessionLoggedInAt = session?.loggedInAt

  const announcementItems = useMemo(
    () =>
      notices.map((notice, index) => {
        const item = noticeIdentity(notice, index)
        return {
          ...item,
          key: String(
            notice.id ??
              notice.notice_id ??
              hashText(`${item.title}:${item.content}:${item.updatedAt}`),
          ),
        }
      }),
    [notices],
  )

  const announcementVersion = useMemo(() => {
    if (!announcementItems.length) return ''
    return hashText(JSON.stringify(announcementItems))
  }, [announcementItems])

  useEffect(() => {
    let disposed = false
    const defer = (callback: () => void) => {
      queueMicrotask(() => {
        if (!disposed) callback()
      })
    }

    if (
      !sessionLoggedInAt ||
      !announcementVersion ||
      !announcementItems.length
    ) {
      defer(() => setOpen(false))
      return
    }

    const readKey = readKeyFor(sessionEmail)
    if (localStorage.getItem(readKey) === announcementVersion) {
      defer(() => setOpen(false))
      return
    }

    const promptKey = `${sessionLoggedInAt}:${announcementVersion}`
    if (lastPromptRef.current === promptKey) return

    lastPromptRef.current = promptKey
    defer(() => {
      setDoNotShowAgain(false)
      setOpen(true)
    })

    return () => {
      disposed = true
    }
  }, [
    announcementItems.length,
    announcementVersion,
    sessionEmail,
    sessionLoggedInAt,
  ])

  const closeDialog = () => {
    if (session && doNotShowAgain && announcementVersion) {
      localStorage.setItem(readKeyFor(session.email), announcementVersion)
    }
    setOpen(false)
  }

  if (!session || !announcementItems.length) return null

  return (
    <Dialog open={open} fullWidth maxWidth="sm" onClose={closeDialog}>
      <DialogTitle sx={{ fontWeight: 900 }}>公告</DialogTitle>
      <DialogContent dividers sx={{ bgcolor: '#fff' }}>
        <Stack spacing={1.5}>
          {announcementItems.map((notice, index) => (
            <Box key={notice.key}>
              <Typography sx={{ fontWeight: 800 }}>{notice.title}</Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 0.75, whiteSpace: 'pre-wrap' }}
              >
                {notice.content}
              </Typography>
              {index < announcementItems.length - 1 && (
                <Divider sx={{ mt: 1.5 }} />
              )}
            </Box>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 2.5, py: 1.5, justifyContent: 'space-between' }}>
        <FormControlLabel
          control={
            <Checkbox
              checked={doNotShowAgain}
              onChange={(event) => setDoNotShowAgain(event.target.checked)}
            />
          }
          label="已阅读，不再显示"
        />
        <Button variant="contained" disableElevation onClick={closeDialog}>
          我知道了
        </Button>
      </DialogActions>
    </Dialog>
  )
}
