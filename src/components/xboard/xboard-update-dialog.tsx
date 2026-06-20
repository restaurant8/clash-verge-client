import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useMemo, useRef, useState } from 'react'

import { useXboard } from '@/providers/xboard-context'
import { openWebUrl } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'
import {
  XBOARD_CHECK_UPDATE_EVENT,
  resolveClientUpdate,
} from '@/services/xboard/update'
import { version as currentVersion } from '@root/package.json'

const SKIP_KEY = 'muacloud.client-update.skipped.v1'

export const XboardUpdateDialog = () => {
  const { remote, refreshRemoteConfig } = useXboard()
  // Track the version the user dismissed/skipped rather than a bare boolean, so a
  // newer version re-opens the dialog automatically without a set-state effect.
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null)
  const [skippedVersion, setSkippedVersion] = useState<string | null>(() =>
    localStorage.getItem(SKIP_KEY),
  )
  const checkingRef = useRef(false)

  const update = useMemo(
    () => resolveClientUpdate(remote.remoteConfig, currentVersion),
    [remote.remoteConfig],
  )

  // Manual "检查更新": force-refresh remote config, then re-show the dialog (even
  // if previously skipped/dismissed) or report that the client is up to date.
  useEffect(() => {
    const onCheck = () => {
      if (checkingRef.current) return
      checkingRef.current = true
      showNotice.info('正在检查更新…')
      void (async () => {
        try {
          const next = await refreshRemoteConfig(true)
          const found = resolveClientUpdate(next.remoteConfig, currentVersion)
          if (found) {
            localStorage.removeItem(SKIP_KEY)
            setSkippedVersion(null)
            setDismissedVersion(null)
          } else {
            showNotice.success('已是最新版本')
          }
        } catch {
          showNotice.error('检查更新失败，请稍后重试')
        } finally {
          checkingRef.current = false
        }
      })()
    }
    window.addEventListener(XBOARD_CHECK_UPDATE_EVENT, onCheck)
    return () => window.removeEventListener(XBOARD_CHECK_UPDATE_EVENT, onCheck)
  }, [refreshRemoteConfig])

  if (!update) return null

  // Optional builds can be skipped permanently for a given version.
  if (!update.forceUpdate && skippedVersion === update.latestVersion) {
    return null
  }

  const open = update.forceUpdate || dismissedVersion !== update.latestVersion

  const handleDownload = () => {
    if (update.downloadUrl) void openWebUrl(update.downloadUrl)
    // Keep the dialog up on force updates so the user can't bypass it.
    if (!update.forceUpdate) setDismissedVersion(update.latestVersion)
  }

  const handleLater = () => setDismissedVersion(update.latestVersion)

  const handleSkip = () => {
    localStorage.setItem(SKIP_KEY, update.latestVersion)
    setSkippedVersion(update.latestVersion)
    setDismissedVersion(update.latestVersion)
  }

  const handleExit = () => void getCurrentWindow().close()

  return (
    <Dialog
      open={open}
      fullWidth
      maxWidth="xs"
      onClose={update.forceUpdate ? undefined : handleLater}
    >
      <DialogTitle sx={{ fontWeight: 900 }}>
        发现新版本 v{update.latestVersion}
      </DialogTitle>
      <DialogContent dividers sx={{ bgcolor: 'background.paper' }}>
        <Stack spacing={1}>
          <Typography variant="body2" color="text.secondary">
            当前版本 v{currentVersion}
          </Typography>
          <Typography
            variant="body2"
            sx={{ whiteSpace: 'pre-wrap' }}
            color="text.primary"
          >
            {update.notes || '有可用的新版本，建议立即更新以获得最佳体验。'}
          </Typography>
          {update.forceUpdate && (
            <Typography variant="body2" color="error">
              此为强制更新，需更新后才能继续使用。
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 2.5, py: 1.5, justifyContent: 'flex-end' }}>
        {update.forceUpdate ? (
          <Button color="inherit" onClick={handleExit}>
            退出应用
          </Button>
        ) : (
          <>
            <Button color="inherit" onClick={handleSkip}>
              跳过此版本
            </Button>
            <Button color="inherit" onClick={handleLater}>
              稍后
            </Button>
          </>
        )}
        <Button
          variant="contained"
          disableElevation
          disabled={!update.downloadUrl}
          onClick={handleDownload}
        >
          立即更新
        </Button>
      </DialogActions>
    </Dialog>
  )
}
