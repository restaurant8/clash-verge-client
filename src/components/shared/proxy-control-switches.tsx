import {
  BuildRounded,
  DeleteForeverRounded,
  PauseCircleOutlineRounded,
  PlayCircleOutlineRounded,
  SettingsRounded,
  WarningRounded,
} from '@mui/icons-material'
import { Box, Typography, alpha, useTheme } from '@mui/material'
import { useLockFn } from 'ahooks'
import type React from 'react'
import { Suspense, lazy, useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { type DialogRef, Switch, TooltipIcon } from '@/components/base'
import { useServiceInstaller } from '@/hooks/use-service-installer'
import { useServiceUninstaller } from '@/hooks/use-service-uninstaller'
import { useSystemProxyState } from '@/hooks/use-system-proxy-state'
import { useSystemState } from '@/hooks/use-system-state'
import { useVerge } from '@/hooks/use-verge'
import { showNotice } from '@/services/notice-service'
import { isTauriRuntime } from '@/utils/tauri'

const SysproxyViewer = lazy(() =>
  import('@/components/setting/mods/sysproxy-viewer').then((module) => ({
    default: module.SysproxyViewer,
  })),
)
const TunViewer = lazy(() =>
  import('@/components/setting/mods/tun-viewer').then((module) => ({
    default: module.TunViewer,
  })),
)

interface ProxySwitchProps {
  label?: string
  mode?: 'system' | 'tun'
  onError?: (err: Error) => void
  noRightPadding?: boolean
}

interface SwitchRowProps {
  label: string
  active: boolean
  disabled?: boolean
  infoTitle: string
  onInfoClick?: () => void
  extraIcons?: React.ReactNode
  onToggle: (value: boolean) => Promise<void>
  onError?: (err: Error) => void
  highlight?: boolean
}

/**
 * 抽取的子组件：统一的开关 UI
 * active = 真实状态OS/配置 乐观更新
 */
const SwitchRow = ({
  label,
  active,
  disabled,
  infoTitle,
  onInfoClick,
  extraIcons,
  onToggle,
  onError,
  highlight,
}: SwitchRowProps) => {
  const theme = useTheme()
  const [checked, setChecked] = useState(active)
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)

  if (pendingRef.current) {
    if (active === checked) pendingRef.current = false
  } else if (checked !== active) {
    setChecked(active)
  }

  const handleChange = (_: React.ChangeEvent, value: boolean) => {
    pendingRef.current = true
    setPending(true)
    setChecked(value)
    onToggle(value)
      .catch((err: any) => {
        setChecked(active)
        onError?.(err)
      })
      .finally(() => {
        pendingRef.current = false
        setPending(false)
      })
  }

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        p: 1,
        pr: 2,
        borderRadius: 1.5,
        bgcolor: highlight
          ? alpha(theme.palette.success.main, 0.07)
          : 'transparent',
        opacity: disabled ? 0.6 : 1,
        transition: 'background-color 0.3s',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center' }}>
        {active ? (
          <PlayCircleOutlineRounded sx={{ color: 'success.main', mr: 1 }} />
        ) : (
          <PauseCircleOutlineRounded sx={{ color: 'text.disabled', mr: 1 }} />
        )}
        <Typography
          variant="subtitle1"
          sx={{ fontWeight: 500, fontSize: '15px' }}
        >
          {label}
        </Typography>
        <TooltipIcon
          title={infoTitle}
          icon={SettingsRounded}
          onClick={onInfoClick}
          sx={{ ml: 1 }}
        />
        {extraIcons}
      </Box>

      <Switch
        edge="end"
        disabled={disabled || pending}
        checked={checked}
        onChange={handleChange}
      />
    </Box>
  )
}

const ProxyControlSwitches = ({
  label,
  mode,
  onError,
  noRightPadding = false,
}: ProxySwitchProps) => {
  const { t } = useTranslation()
  const { verge, mutateVerge, patchVerge } = useVerge()
  const { installServiceAndRestartCore } = useServiceInstaller()
  const { uninstallServiceAndRestartCore } = useServiceUninstaller()
  const { indicator: systemProxyIndicator, toggleSystemProxy } =
    useSystemProxyState()
  const { isServiceOk, isTunModeAvailable, mutateSystemState } =
    useSystemState()

  const sysproxyRef = useRef<DialogRef>(null)
  const tunRef = useRef<DialogRef>(null)
  const canOpenPlatformDialogs = isTauriRuntime()

  const { enable_tun_mode } = verge ?? {}

  const showErrorNotice = useCallback(
    (msg: string) => showNotice.error(msg),
    [],
  )

  const handleTunToggle = async (value: boolean) => {
    if (!isTunModeAvailable) {
      const msgKey = 'settings.sections.proxyControl.tooltips.tunUnavailable'
      showErrorNotice(msgKey)
      throw new Error(t(msgKey))
    }
    mutateVerge({ ...verge, enable_tun_mode: value }, false)
    await patchVerge({ enable_tun_mode: value })
  }

  const onInstallService = useLockFn(async () => {
    try {
      await installServiceAndRestartCore()
      await mutateSystemState()
    } catch (err) {
      showNotice.error(err)
    }
  })

  const onUninstallService = useLockFn(async () => {
    try {
      if (verge?.enable_tun_mode) {
        await handleTunToggle(false)
      }
      await uninstallServiceAndRestartCore()
      await mutateSystemState()
    } catch (err) {
      showNotice.error(err)
    }
  })

  const switchMode =
    mode ??
    (label === t('settings.sections.system.toggles.tunMode') ? 'tun' : 'system')
  const isSystemProxyMode = switchMode === 'system'
  const isTunMode = switchMode === 'tun'

  return (
    <Box sx={{ width: '100%', pr: noRightPadding ? 1 : 2 }}>
      {isSystemProxyMode && (
        <SwitchRow
          label={t('settings.sections.proxyControl.fields.systemProxy')}
          active={systemProxyIndicator}
          infoTitle={t('settings.sections.proxyControl.tooltips.systemProxy')}
          onInfoClick={() =>
            canOpenPlatformDialogs
              ? sysproxyRef.current?.open()
              : showNotice.info('系统代理详细设置需要在桌面客户端中打开')
          }
          onToggle={(value) => toggleSystemProxy(value)}
          onError={onError}
          highlight={systemProxyIndicator}
        />
      )}

      {isTunMode && (
        <SwitchRow
          label={t('settings.sections.proxyControl.fields.tunMode')}
          active={enable_tun_mode || false}
          infoTitle={t('settings.sections.proxyControl.tooltips.tunMode')}
          onInfoClick={() =>
            canOpenPlatformDialogs
              ? tunRef.current?.open()
              : showNotice.info('TUN 详细设置需要在桌面客户端中打开')
          }
          onToggle={handleTunToggle}
          onError={onError}
          disabled={!isTunModeAvailable}
          highlight={enable_tun_mode || false}
          extraIcons={
            <>
              {!isTunModeAvailable && (
                <>
                  <TooltipIcon
                    title={t(
                      'settings.sections.proxyControl.tooltips.tunUnavailable',
                    )}
                    icon={WarningRounded}
                    sx={{ color: 'warning.main', ml: 1 }}
                  />
                  <TooltipIcon
                    title={t(
                      'settings.sections.proxyControl.actions.installService',
                    )}
                    icon={BuildRounded}
                    color="primary"
                    onClick={onInstallService}
                    sx={{ ml: 1 }}
                  />
                </>
              )}
              {isServiceOk && (
                <TooltipIcon
                  title={t(
                    'settings.sections.proxyControl.actions.uninstallService',
                  )}
                  icon={DeleteForeverRounded}
                  color="secondary"
                  onClick={onUninstallService}
                  sx={{ ml: 1 }}
                />
              )}
            </>
          }
        />
      )}

      {canOpenPlatformDialogs && (
        <Suspense fallback={null}>
          <SysproxyViewer ref={sysproxyRef} />
          <TunViewer ref={tunRef} />
        </Suspense>
      )}
    </Box>
  )
}

export default ProxyControlSwitches
