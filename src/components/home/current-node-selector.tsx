import {
  Box,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  SelectChangeEvent,
  Typography,
} from '@mui/material'
import { useCallback, useMemo } from 'react'

import { useProfiles } from '@/hooks/use-profiles'
import { useProxySelection } from '@/hooks/use-proxy-selection'
import {
  useAppRefreshers,
  useClashConfigData,
  useProxiesData,
  useRulesData,
} from '@/providers/app-data-context'
import delayManager from '@/services/delay'

const STORAGE_KEY_GROUP = 'muacloud-selected-proxy-group'
const STORAGE_KEY_PROXY = 'muacloud-selected-proxy'

const normalizePolicyName = (value?: string | null) =>
  typeof value === 'string' ? value.trim() : ''

const delayChipColor = (
  delayValue: number,
): 'success' | 'warning' | 'error' | 'primary' | 'default' => {
  const color = delayManager.formatDelayColor(delayValue).split('.')[0]

  if (color === 'success') return 'success'
  if (color === 'warning') return 'warning'
  if (color === 'error') return 'error'
  if (color === 'primary') return 'primary'
  return 'default'
}

type ProxyGroupOption = {
  name: string
  now: string
  all: string[]
  type?: string
}

const toNameList = (items: unknown[]) =>
  items
    .map((item) =>
      typeof item === 'string'
        ? normalizePolicyName(item)
        : normalizePolicyName((item as { name?: string })?.name),
    )
    .filter((value): value is string => Boolean(value))

const getScopedStorageKey = (baseKey: string, profileId?: string | null) =>
  profileId ? `${baseKey}:${profileId}` : baseKey

export const CurrentNodeSelector = () => {
  const { proxies } = useProxiesData()
  const { clashConfig } = useClashConfigData()
  const { rules } = useRulesData()
  const { refreshProxy } = useAppRefreshers()
  const { current: currentProfile } = useProfiles()
  const currentProfileId = currentProfile?.uid || null

  const { handleSelectChange } = useProxySelection({
    onSuccess: () => refreshProxy(),
    onError: () => refreshProxy(),
  })

  const mode = clashConfig?.mode?.toLowerCase() || 'rule'
  const isGlobalMode = mode === 'global'
  const isDirectMode = mode === 'direct'

  const matchPolicyName = useMemo(() => {
    if (!Array.isArray(rules)) return ''

    for (let index = rules.length - 1; index >= 0; index -= 1) {
      const rule = rules[index]
      if (
        typeof rule?.type === 'string' &&
        rule.type.toUpperCase() === 'MATCH'
      ) {
        const policy = normalizePolicyName(rule.proxy)
        if (policy) return policy
      }
    }

    return ''
  }, [rules])

  const selectorGroups = useMemo(() => {
    if (!proxies) return []

    const groupsMap = new Map<string, ProxyGroupOption>()

    const registerGroup = (group: any, fallbackName?: string) => {
      const rawName =
        typeof group?.name === 'string' && group.name
          ? group.name
          : fallbackName
      const name = normalizePolicyName(rawName)
      if (!name || groupsMap.has(name)) return

      const all = toNameList(Array.isArray(group?.all) ? group.all : [])
      if (!all.length) return

      groupsMap.set(name, {
        name,
        now: normalizePolicyName(group?.now),
        all: Array.from(new Set(all)),
        type: group?.type,
      })
    }

    if (matchPolicyName) {
      const matchGroup =
        proxies.groups?.find((group: { name: string }) => {
          return group.name === matchPolicyName
        }) ||
        (proxies.global?.name === matchPolicyName ? proxies.global : null) ||
        proxies.records?.[matchPolicyName]
      registerGroup(matchGroup, matchPolicyName)
    }

    ;(proxies.groups || [])
      .filter((group: { type?: string }) => group?.type === 'Selector')
      .forEach((group: any) => registerGroup(group))

    return Array.from(groupsMap.values())
  }, [matchPolicyName, proxies])

  const selectedGroup = useMemo(() => {
    if (!proxies) return null

    if (isDirectMode) {
      return { name: 'DIRECT', now: 'DIRECT', all: ['DIRECT'] }
    }

    if (isGlobalMode && proxies.global) {
      return {
        name: 'GLOBAL',
        now: normalizePolicyName(proxies.global.now),
        all: toNameList(Array.isArray(proxies.global.all) ? proxies.global.all : []),
      }
    }

    const scopedGroupKey = getScopedStorageKey(
      STORAGE_KEY_GROUP,
      currentProfileId,
    )
    const savedGroup =
      typeof window === 'undefined' ? '' : localStorage.getItem(scopedGroupKey)
    const primaryKeywords = [
      'auto',
      'select',
      'proxy',
      '节点选择',
      '自动选择',
    ]

    return (
      selectorGroups.find((group) => group.name === savedGroup) ||
      selectorGroups.find((group) =>
        primaryKeywords.some((keyword) =>
          group.name.toLowerCase().includes(keyword.toLowerCase()),
        ),
      ) ||
      selectorGroups[0] ||
      null
    )
  }, [currentProfileId, isDirectMode, isGlobalMode, proxies, selectorGroups])

  const optionNames = useMemo(() => {
    if (!selectedGroup) return []

    const hiddenInGlobal = new Set(['DIRECT', 'REJECT'])
    const names = selectedGroup.all.filter((name) => {
      return !isGlobalMode || !hiddenInGlobal.has(name) || name === selectedGroup.now
    })

    if (selectedGroup.now && !names.includes(selectedGroup.now)) {
      names.unshift(selectedGroup.now)
    }

    return names
  }, [isGlobalMode, selectedGroup])

  const selectedProxy = useMemo(() => {
    if (!selectedGroup) return ''
    if (selectedGroup.now && optionNames.includes(selectedGroup.now)) {
      return selectedGroup.now
    }
    return optionNames[0] || ''
  }, [optionNames, selectedGroup])

  const getDelay = useCallback(
    (proxyName: string) => {
      const record = proxies?.records?.[proxyName]
      if (!record || !selectedGroup?.name || isDirectMode) return -1
      return delayManager.getDelayFix(record, selectedGroup.name)
    },
    [isDirectMode, proxies?.records, selectedGroup?.name],
  )

  const renderSelectedValue = (value: string) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
      <Typography noWrap sx={{ flex: 1, minWidth: 0 }}>
        {value || '暂无节点'}
      </Typography>
      {!isDirectMode && value && (
        <Chip
          size="small"
          label={delayManager.formatDelay(getDelay(value))}
          color={delayChipColor(getDelay(value))}
          sx={{ height: 22, minWidth: 46, flexShrink: 0 }}
        />
      )}
    </Box>
  )

  const handleProxyChange = useCallback(
    (event: SelectChangeEvent<string>) => {
      const nextProxy = event.target.value
      if (!selectedGroup?.name || !nextProxy || nextProxy === selectedProxy) {
        return
      }

      if (!isGlobalMode && !isDirectMode && typeof window !== 'undefined') {
        localStorage.setItem(
          getScopedStorageKey(STORAGE_KEY_GROUP, currentProfileId),
          selectedGroup.name,
        )
        localStorage.setItem(
          getScopedStorageKey(STORAGE_KEY_PROXY, currentProfileId),
          nextProxy,
        )
      }

      handleSelectChange(
        selectedGroup.name,
        selectedProxy,
        isGlobalMode || isDirectMode,
      )(event)
    },
    [
      currentProfileId,
      handleSelectChange,
      isDirectMode,
      isGlobalMode,
      selectedGroup?.name,
      selectedProxy,
    ],
  )

  return (
    <FormControl
      fullWidth
      size="small"
      disabled={isDirectMode || !selectedGroup || !optionNames.length}
      sx={{
        width: '100%',
        maxWidth: 390,
        mx: 'auto',
        mt: 1,
      }}
    >
      <InputLabel id="current-node-select-label">当前节点</InputLabel>
      <Select
        labelId="current-node-select-label"
        value={selectedProxy}
        label="当前节点"
        onChange={handleProxyChange}
        renderValue={renderSelectedValue}
        MenuProps={{
          slotProps: {
            paper: {
              style: { maxHeight: 420 },
            },
          },
        }}
      >
        {optionNames.map((name) => {
          const delayValue = getDelay(name)

          return (
            <MenuItem
              key={name}
              value={name}
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 1,
              }}
            >
              <Typography noWrap sx={{ minWidth: 0 }}>
                {name}
              </Typography>
              {!isDirectMode && (
                <Chip
                  size="small"
                  label={delayManager.formatDelay(delayValue)}
                  color={delayChipColor(delayValue)}
                  sx={{ height: 22, minWidth: 46, flexShrink: 0 }}
                />
              )}
            </MenuItem>
          )
        })}
      </Select>
    </FormControl>
  )
}
