import { Box, Button, SxProps } from '@mui/material'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseSearchBox } from '@/components/base'
import { useVerge } from '@/hooks/use-verge'
import delayManager from '@/services/delay'
import { debugLog } from '@/utils/debug'

import type { ProxySortType } from './use-filter-sort'
import type { HeadState } from './use-head-state'

interface Props {
  sx?: SxProps
  url?: string
  groupName: string
  headState: HeadState
  onLocation: () => void
  onCheckDelay: () => void
  onHeadState: (val: Partial<HeadState>) => void
}

const defaultSx: SxProps = {}

export const ProxyHead = ({
  sx = defaultSx,
  url,
  groupName,
  headState,
  onHeadState,
  onLocation,
  onCheckDelay,
}: Props) => {
  const {
    showType,
    sortType,
    filterText,
    textState,
    testUrl,
    filterMatchCase,
    filterMatchWholeWord,
    filterUseRegularExpression,
  } = headState

  const { t } = useTranslation()
  const [autoFocus, setAutoFocus] = useState(false)
  const sortLabel = [
    t('proxies.page.tooltips.sortDefault'),
    t('proxies.page.tooltips.sortDelay'),
    t('proxies.page.tooltips.sortName'),
  ][sortType]
  const detailLabel = showType
    ? t('proxies.page.tooltips.showBasic')
    : t('proxies.page.tooltips.showDetail')

  useEffect(() => {
    // fix the focus conflict
    const timer = setTimeout(() => setAutoFocus(true), 100)
    return () => clearTimeout(timer)
  }, [])

  const { verge } = useVerge()
  const defaultLatencyUrl =
    verge?.default_latency_test?.trim() ||
    'http://cp.cloudflare.com/generate_204'

  useEffect(() => {
    delayManager.setUrl(groupName, testUrl?.trim() || url || defaultLatencyUrl)
  }, [groupName, testUrl, defaultLatencyUrl, url])

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 0.5,
        ...sx,
      }}
    >
      <Button
        size="small"
        color="inherit"
        title={t('proxies.page.tooltips.locate')}
        onClick={onLocation}
        sx={{ minWidth: 0, px: 1, whiteSpace: 'nowrap' }}
      >
        {t('proxies.page.tooltips.locate')}
      </Button>

      <Button
        size="small"
        color="inherit"
        title={t('proxies.page.tooltips.delayCheck')}
        onClick={() => {
          debugLog(`[ProxyHead] 点击延迟测试按钮，组: ${groupName}`)
          if (testUrl?.trim()) {
            debugLog(`[ProxyHead] 使用自定义测试URL: ${testUrl}`)
          }
          onCheckDelay()
        }}
        sx={{ minWidth: 0, px: 1, whiteSpace: 'nowrap' }}
      >
        {t('proxies.page.tooltips.delayCheck')}
      </Button>

      <Button
        size="small"
        color="inherit"
        title={sortLabel}
        onClick={() =>
          onHeadState({ sortType: ((sortType + 1) % 3) as ProxySortType })
        }
        sx={{ minWidth: 0, px: 1, whiteSpace: 'nowrap' }}
      >
        {sortLabel}
      </Button>

      <Button
        size="small"
        color="inherit"
        variant={showType ? 'contained' : 'text'}
        title={detailLabel}
        aria-pressed={showType}
        onClick={() => onHeadState({ showType: !showType })}
        sx={{ minWidth: 0, px: 1, whiteSpace: 'nowrap' }}
      >
        {detailLabel}
      </Button>

      <Button
        size="small"
        color="inherit"
        variant={textState === 'filter' ? 'contained' : 'text'}
        title={t('proxies.page.tooltips.filter')}
        aria-pressed={textState === 'filter'}
        onClick={() =>
          onHeadState({ textState: textState === 'filter' ? null : 'filter' })
        }
        sx={{ minWidth: 0, px: 1, whiteSpace: 'nowrap' }}
      >
        {t('proxies.page.tooltips.filter')}
      </Button>

      {textState === 'filter' && (
        <Box sx={{ ml: 0.5, flex: '1 1 auto' }}>
          <BaseSearchBox
            autoFocus={autoFocus}
            value={filterText}
            searchState={{
              matchCase: filterMatchCase,
              matchWholeWord: filterMatchWholeWord,
              useRegularExpression: filterUseRegularExpression,
            }}
            onSearch={(_, state) =>
              onHeadState({
                filterText: state.text,
                filterMatchCase: state.matchCase,
                filterMatchWholeWord: state.matchWholeWord,
                filterUseRegularExpression: state.useRegularExpression,
              })
            }
          />
        </Box>
      )}
    </Box>
  )
}
