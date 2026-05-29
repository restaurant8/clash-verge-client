import {
  DownloadRounded,
  RefreshRounded,
  UploadRounded,
} from '@mui/icons-material'
import {
  Button,
  Chip,
  CircularProgress,
  Grid,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
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
import { formatBytes, formatDateTime } from '@/services/xboard/format'

const TrafficRecordsPage = () => {
  const { session, appConfig, resourceCache, loadTrafficLogs } = useXboard()
  const [refreshingLogs, setRefreshingLogs] = useState(false)

  useEffect(() => {
    void loadTrafficLogs()
  }, [loadTrafficLogs])

  const refreshLogs = useLockFn(async () => {
    setRefreshingLogs(true)
    try {
      await loadTrafficLogs(true)
    } finally {
      setRefreshingLogs(false)
    }
  })

  const trafficLogs = useMemo(
    () => resourceCache.trafficLogs ?? [],
    [resourceCache.trafficLogs],
  )
  const featureEnabled = ![false, 0, '0', 'false'].includes(
    appConfig?.features?.enable_traffic_log,
  )

  const summary = useMemo(
    () =>
      trafficLogs.reduce(
        (acc, item) => {
          const upload = Number(item.u ?? 0)
          const download = Number(item.d ?? 0)
          acc.upload += Number.isFinite(upload) ? upload : 0
          acc.download += Number.isFinite(download) ? download : 0
          return acc
        },
        { upload: 0, download: 0 },
      ),
    [trafficLogs],
  )

  if (!session) {
    return (
      <XboardPage title="流量记录">
        <XboardEmpty title="请先登录" description="登录后才能查看流量记录。" />
      </XboardPage>
    )
  }

  if (!featureEnabled) {
    return (
      <XboardPage title="流量记录">
        <XboardEmpty title="后台未开启流量记录" />
      </XboardPage>
    )
  }

  return (
    <XboardPage
      title="流量记录"
      action={
        <Button
          variant="outlined"
          startIcon={
            refreshingLogs ? (
              <CircularProgress color="inherit" size={16} />
            ) : (
              <RefreshRounded />
            )
          }
          disabled={refreshingLogs}
          onClick={() => void refreshLogs()}
        >
          刷新记录
        </Button>
      }
    >
      <Stack spacing={2}>
        <Grid container spacing={1.5}>
          <Grid size={{ xs: 12, md: 4 }}>
            <XboardMetric
              label="本月上传"
              value={formatBytes(summary.upload)}
              helper={<UploadRounded fontSize="small" />}
            />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <XboardMetric
              label="本月下载"
              value={formatBytes(summary.download)}
              helper={<DownloadRounded fontSize="small" />}
            />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <XboardMetric
              label="本月合计"
              value={formatBytes(summary.upload + summary.download)}
              helper={`${trafficLogs.length} 条记录`}
            />
          </Grid>
        </Grid>

        <XboardPanel title="官方流量记录">
          {trafficLogs.length ? (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>时间</TableCell>
                    <TableCell align="right">上传</TableCell>
                    <TableCell align="right">下载</TableCell>
                    <TableCell align="right">合计</TableCell>
                    <TableCell align="right">倍率</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {trafficLogs.map((item) => {
                    const upload = Number(item.u ?? 0)
                    const download = Number(item.d ?? 0)
                    const total =
                      (Number.isFinite(upload) ? upload : 0) +
                      (Number.isFinite(download) ? download : 0)

                    return (
                      <TableRow
                        key={`${item.record_at ?? 'record'}-${item.u ?? 0}-${item.d ?? 0}-${item.server_rate ?? 1}`}
                      >
                        <TableCell>
                          <Typography variant="body2" sx={{ fontWeight: 700 }}>
                            {formatDateTime(item.record_at)}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          {formatBytes(upload)}
                        </TableCell>
                        <TableCell align="right">
                          {formatBytes(download)}
                        </TableCell>
                        <TableCell align="right">
                          {formatBytes(total)}
                        </TableCell>
                        <TableCell align="right">
                          <Chip
                            size="small"
                            variant="outlined"
                            label={item.server_rate ?? 1}
                          />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          ) : (
            <XboardEmpty title="暂无流量记录" />
          )}
        </XboardPanel>
      </Stack>
    </XboardPage>
  )
}

export default TrafficRecordsPage
