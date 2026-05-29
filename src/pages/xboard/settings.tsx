import {
  ContentCopyRounded,
  DnsRounded,
  RefreshRounded,
} from '@mui/icons-material'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  Grid,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { useState } from 'react'

import ProxyControlSwitches from '@/components/shared/proxy-control-switches'
import { XboardPage } from '@/components/xboard/xboard-page'
import { XboardEmpty, XboardPanel } from '@/components/xboard/xboard-primitives'
import { useXboard } from '@/providers/xboard-context'
import { isTauriRuntime } from '@/utils/tauri'

const SettingsPage = () => {
  const { remote, refreshRemoteConfig, refreshing, lastError } = useXboard()
  const [copied, setCopied] = useState('')
  const [copying, setCopying] = useState('')
  const isDesktopRuntime = isTauriRuntime()

  const copy = async (value: string, label: string) => {
    setCopying(value)
    try {
      if (isDesktopRuntime) {
        await writeText(value)
      } else {
        await navigator.clipboard?.writeText(value)
      }
      setCopied(`${label} 已复制`)
    } finally {
      setCopying('')
    }
  }

  return (
    <XboardPage
      title="设置"
      subtitle="管理本地代理与服务入口。"
      action={
        <Button
          variant="outlined"
          startIcon={
            refreshing ? (
              <CircularProgress color="inherit" size={16} />
            ) : (
              <RefreshRounded />
            )
          }
          disabled={refreshing}
          onClick={() => void refreshRemoteConfig(true)}
        >
          刷新远程配置
        </Button>
      }
    >
      <Stack spacing={2}>
        {lastError && <Alert severity="warning">{lastError}</Alert>}
        {copied && <Alert severity="success">{copied}</Alert>}

        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 6 }}>
            <XboardPanel title="代理控制">
              {isDesktopRuntime ? (
                <ProxyControlSwitches noRightPadding />
              ) : (
                <XboardEmpty
                  title="桌面端可用"
                  description="系统代理、TUN 和服务模式需要在 Tauri 桌面运行时中控制。"
                />
              )}
            </XboardPanel>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <XboardPanel title="当前线路">
              <Stack spacing={1.2}>
                <TextField
                  label="服务入口"
                  value={remote.activeApiDomain}
                  fullWidth
                  slotProps={{ input: { readOnly: true } }}
                />
                <Button
                  variant="outlined"
                  startIcon={
                    copying === remote.activeApiDomain ? (
                      <CircularProgress color="inherit" size={16} />
                    ) : (
                      <ContentCopyRounded />
                    )
                  }
                  disabled={copying === remote.activeApiDomain}
                  onClick={() => void copy(remote.activeApiDomain, '服务入口')}
                >
                  复制服务入口
                </Button>
              </Stack>
            </XboardPanel>
          </Grid>
        </Grid>

        <XboardPanel title="远程配置">
          <Grid container spacing={1.5}>
            <Grid size={{ xs: 12, md: 4 }}>
              <TextField
                label="品牌"
                value={remote.remoteConfig.APP_NAME}
                fullWidth
                slotProps={{ input: { readOnly: true } }}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <TextField
                label="User-Agent"
                value={remote.remoteConfig.custom_ua}
                fullWidth
                slotProps={{ input: { readOnly: true } }}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <TextField
                label="订阅路径"
                value={remote.remoteConfig.subscribe_path}
                fullWidth
                slotProps={{ input: { readOnly: true } }}
              />
            </Grid>
          </Grid>
          <Divider sx={{ my: 2 }} />
          <Stack spacing={1}>
            {remote.apiDomains.map((domain) => (
              <Box
                key={domain}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  p: 1,
                  borderRadius: 1.5,
                  border: '1px solid',
                  borderColor:
                    domain === remote.activeApiDomain
                      ? 'primary.main'
                      : 'divider',
                }}
              >
                <DnsRounded fontSize="small" color="primary" />
                <Typography sx={{ flex: 1, fontWeight: 700 }}>
                  {domain}
                </Typography>
                <Button
                  size="small"
                  disabled={copying === domain}
                  startIcon={
                    copying === domain ? (
                      <CircularProgress color="inherit" size={14} />
                    ) : undefined
                  }
                  onClick={() => void copy(domain, '灾备域名')}
                >
                  复制
                </Button>
              </Box>
            ))}
          </Stack>
        </XboardPanel>
      </Stack>
    </XboardPage>
  )
}

export default SettingsPage
