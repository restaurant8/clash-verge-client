import { RefreshRounded } from '@mui/icons-material'
import { Box, Button, CircularProgress } from '@mui/material'
import { useLockFn } from 'ahooks'
import { useMemo, useState } from 'react'

import { ProxyGroups } from '@/components/proxy/proxy-groups'
import { XboardPage } from '@/components/xboard/xboard-page'
import { XboardEmpty } from '@/components/xboard/xboard-primitives'
import {
  useAppRefreshers,
  useClashConfigData,
  useProxiesData,
} from '@/providers/app-data-context'
import { useXboard } from '@/providers/xboard-context'

const VALID_MODES = new Set(['rule', 'global', 'direct'])

const NodesPage = () => {
  const { session, refreshAccount, refreshing } = useXboard()
  const { clashConfig } = useClashConfigData()
  const { isProxiesPending } = useProxiesData()
  const { refreshProxy } = useAppRefreshers()
  const [refreshingNodes, setRefreshingNodes] = useState(false)

  const mode = useMemo(() => {
    const normalized = clashConfig?.mode?.toLowerCase() || 'rule'
    return VALID_MODES.has(normalized) ? normalized : 'rule'
  }, [clashConfig?.mode])

  const refreshNodes = useLockFn(async () => {
    setRefreshingNodes(true)
    try {
      await Promise.all([refreshAccount(), refreshProxy()])
    } finally {
      setRefreshingNodes(false)
    }
  })

  if (!session) {
    return (
      <XboardPage title="节点">
        <XboardEmpty
          title="请先登录"
          description="登录后才能读取并选择可用节点。"
        />
      </XboardPage>
    )
  }

  return (
    <XboardPage
      title="节点"
      action={
        <Button
          variant="outlined"
          startIcon={
            refreshingNodes || refreshing || isProxiesPending ? (
              <CircularProgress color="inherit" size={16} />
            ) : (
              <RefreshRounded />
            )
          }
          disabled={refreshingNodes || refreshing || isProxiesPending}
          onClick={() => void refreshNodes()}
        >
          刷新节点
        </Button>
      }
    >
      <Box
        sx={{
          height: 'calc(100vh - 126px)',
          minHeight: 500,
          mx: -0.5,
          px: 0.5,
          pt: 0.25,
        }}
      >
        <ProxyGroups
          mode={mode}
          defaultOpenFirst
          hideGroupNames={['自动选择', '故障转移']}
          hideGroupTypes={['URLTest', 'Fallback']}
        />
      </Box>
    </XboardPage>
  )
}

export default NodesPage
