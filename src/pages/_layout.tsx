import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Box, List, Menu, MenuItem, Paper, ThemeProvider } from '@mui/material'
import { LogicalSize } from '@tauri-apps/api/dpi'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import type { CSSProperties } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet, useLocation, useNavigate } from 'react-router'

import brandLogo from '@/assets/image/muacloud-logo.svg'
import { BaseErrorBoundary } from '@/components/base'
import { LayoutItem } from '@/components/layout/layout-item'
import { LayoutTraffic } from '@/components/layout/layout-traffic'
import { NoticeManager } from '@/components/layout/notice-manager'
import { UpdateButton } from '@/components/layout/update-button'
import { WindowControls } from '@/components/layout/window-controller'
import { CrispSupport } from '@/components/xboard/crisp-support'
import { XboardAnnouncementDialog } from '@/components/xboard/xboard-announcement-dialog'
import { XboardUpdateDialog } from '@/components/xboard/xboard-update-dialog'
import { useI18n } from '@/hooks/use-i18n'
import { useVerge } from '@/hooks/use-verge'
import { useWindow } from '@/hooks/use-window'
import { useWindowDecorations } from '@/hooks/use-window'
import { useXboard } from '@/providers/xboard-context'
import { useThemeMode } from '@/services/states'
import getSystem from '@/utils/get-system'
import { isTauriRuntime } from '@/utils/tauri'

import {
  useCustomTheme,
  useLayoutEvents,
  useLoadingOverlay,
  useNavMenuOrder,
} from './_layout/hooks'
import { handleNoticeMessage } from './_layout/utils'
import { navItems } from './_nav-items'

import 'dayjs/locale/ru'
import 'dayjs/locale/zh-cn'

export const portableFlag = false

type NavItem = (typeof navItems)[number]

type MenuContextPosition = { top: number; left: number }

// 仅“高级”保留隐藏（5 次点击账户解锁）；“设置”直接显示在导航中。
const SETTINGS_ENTRY_PATHS = new Set(['/advanced'])
const SETTINGS_UNLOCK_STORAGE_KEY = 'muacloud:settings-menu-unlocked'
const SETTINGS_UNLOCK_CLICK_COUNT = 5
const SETTINGS_UNLOCK_CLICK_WINDOW_MS = 2000

interface SortableNavMenuItemProps {
  item: NavItem
  label: string
  onActivate?: () => string | void
}

const SortableNavMenuItem = ({
  item,
  label,
  onActivate,
}: SortableNavMenuItemProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.path,
  })

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  if (isDragging) {
    style.zIndex = 100
  }

  return (
    <LayoutItem
      to={item.path}
      icon={item.icon}
      onActivate={onActivate}
      sortable={{
        setNodeRef,
        attributes,
        listeners,
        style,
        isDragging,
      }}
    >
      {label}
    </LayoutItem>
  )
}

dayjs.extend(relativeTime)

const OS = getSystem()
const AUTH_WINDOW_SIZE = new LogicalSize(520, 560)
const AUTH_WINDOW_MIN_SIZE = new LogicalSize(520, 520)
const APP_WINDOW_SIZE = new LogicalSize(940, 700)
const APP_WINDOW_MIN_SIZE = new LogicalSize(860, 620)

const Layout = () => {
  const mode = useThemeMode()
  const { t } = useTranslation()
  const { remote, session, booting, appConfig } = useXboard()
  const { theme } = useCustomTheme()
  const { verge, mutateVerge, patchVerge } = useVerge()
  const { language } = verge ?? {}
  const navCollapsed = verge?.collapse_navbar ?? false
  const { switchLanguage } = useI18n()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const shouldShowAppShell = Boolean(session)
  const themeReady = useMemo(() => Boolean(theme), [theme])
  const resolveNavLabel = useCallback(
    (label: string) => (label.includes('.') ? t(label) : label),
    [t],
  )

  const [menuUnlocked, setMenuUnlocked] = useState(false)
  const [menuContextPosition, setMenuContextPosition] =
    useState<MenuContextPosition | null>(null)
  const [settingsMenuUnlocked, setSettingsMenuUnlocked] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.sessionStorage.getItem(SETTINGS_UNLOCK_STORAGE_KEY) === '1'
  })

  const windowControlsRef = useRef<any>(null)
  const lastWindowModeRef = useRef<'auth' | 'app' | null>(null)
  const accountMenuClickRef = useRef({ count: 0, lastAt: 0 })
  const { currentWindow } = useWindow()
  const { decorated, refreshDecorated } = useWindowDecorations()

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const handleMenuOrderOptimisticUpdate = useCallback(
    (order: string[]) => {
      mutateVerge(
        (prev) => (prev ? { ...prev, menu_order: order } : prev),
        false,
      )
    },
    [mutateVerge],
  )

  const handleMenuOrderPersist = useCallback(
    (order: string[]) => patchVerge({ menu_order: order }),
    [patchVerge],
  )

  const visibleNavItems = useMemo(() => {
    const features = appConfig?.features ?? remote.bootstrap?.features ?? {}
    const isFeatureEnabled = (key: string) =>
      ![false, 0, '0', 'false'].includes(features[key])

    return navItems.filter((item) => {
      if (SETTINGS_ENTRY_PATHS.has(item.path)) {
        return settingsMenuUnlocked
      }
      if (item.path === '/tickets') {
        return isFeatureEnabled('enable_ticket_system')
      }
      if (item.path === '/traffic-records') {
        return isFeatureEnabled('enable_traffic_log')
      }
      return true
    })
  }, [appConfig?.features, remote.bootstrap?.features, settingsMenuUnlocked])

  const {
    menuOrder,
    navItemMap,
    handleMenuDragEnd,
    isDefaultOrder,
    resetMenuOrder,
  } = useNavMenuOrder({
    enabled: menuUnlocked,
    items: visibleNavItems,
    storedOrder: verge?.menu_order,
    onOptimisticUpdate: handleMenuOrderOptimisticUpdate,
    onPersist: handleMenuOrderPersist,
  })

  const handleMenuContextMenu = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      event.preventDefault()
      event.stopPropagation()
      setMenuContextPosition({ top: event.clientY, left: event.clientX })
    },
    [],
  )

  const handleMenuContextClose = useCallback(() => {
    setMenuContextPosition(null)
  }, [])

  const handleResetMenuOrder = useCallback(() => {
    setMenuContextPosition(null)
    void resetMenuOrder()
  }, [resetMenuOrder])

  const handleUnlockMenu = useCallback(() => {
    setMenuUnlocked(true)
    setMenuContextPosition(null)
  }, [])

  const handleLockMenu = useCallback(() => {
    setMenuUnlocked(false)
    setMenuContextPosition(null)
  }, [])

  const handleToggleNavCollapsed = useCallback(() => {
    setMenuContextPosition(null)
    void patchVerge({ collapse_navbar: !navCollapsed })
  }, [navCollapsed, patchVerge])

  const handleNavItemActivate = useCallback(
    (item: NavItem) => {
      if (settingsMenuUnlocked) return undefined

      if (item.path !== '/account') {
        accountMenuClickRef.current = { count: 0, lastAt: 0 }
        return undefined
      }

      const now = Date.now()
      const isContinuous =
        now - accountMenuClickRef.current.lastAt <=
        SETTINGS_UNLOCK_CLICK_WINDOW_MS
      const count = isContinuous ? accountMenuClickRef.current.count + 1 : 1

      accountMenuClickRef.current = { count, lastAt: now }

      if (count >= SETTINGS_UNLOCK_CLICK_COUNT) {
        accountMenuClickRef.current = { count: 0, lastAt: 0 }
        setSettingsMenuUnlocked(true)
        window.sessionStorage.setItem(SETTINGS_UNLOCK_STORAGE_KEY, '1')
        return '/advanced'
      }

      return undefined
    },
    [settingsMenuUnlocked],
  )

  const customTitlebar = useMemo(
    () =>
      shouldShowAppShell && !decorated ? (
        <div className="the_titlebar">
          <div
            className="the_titlebar-drag-region"
            data-tauri-drag-region="true"
          />
          <WindowControls ref={windowControlsRef} />
        </div>
      ) : null,
    [decorated, shouldShowAppShell],
  )

  useLoadingOverlay(themeReady)

  const handleNotice = useCallback(
    (payload: [string, string]) => {
      const [status, msg] = payload
      try {
        handleNoticeMessage(status, msg, t, navigate)
      } catch (error) {
        console.error('[通知处理] 失败:', error)
      }
    },
    [t, navigate],
  )

  useLayoutEvents(handleNotice)

  useEffect(() => {
    if (booting || !isTauriRuntime()) return

    const nextMode = session ? 'app' : 'auth'
    if (lastWindowModeRef.current === nextMode) return
    lastWindowModeRef.current = nextMode

    const applyWindowMode = async () => {
      try {
        if (nextMode === 'auth') {
          if (await currentWindow.isMaximized()) {
            await currentWindow.unmaximize()
          }
          if (await currentWindow.isFullscreen()) {
            await currentWindow.setFullscreen(false)
          }
          await currentWindow.setDecorations(false)
          await currentWindow.setShadow(false).catch(() => undefined)
          await currentWindow.setResizable(false)
          await currentWindow.setMinSize(AUTH_WINDOW_MIN_SIZE)
          await currentWindow.setSize(AUTH_WINDOW_SIZE)
          await currentWindow.center()
        } else {
          await currentWindow.setShadow(true).catch(() => undefined)
          await currentWindow.setDecorations(true)
          await currentWindow.setResizable(true)
          await currentWindow.setMinSize(APP_WINDOW_MIN_SIZE)
          await currentWindow.setSize(APP_WINDOW_SIZE)
          await currentWindow.center()
        }

        await refreshDecorated()
      } catch (error) {
        console.warn('[Layout] failed to apply window mode:', error)
      }
    }

    void applyWindowMode()
  }, [booting, currentWindow, refreshDecorated, session])

  useEffect(() => {
    if (!booting && !session && pathname !== '/') {
      navigate('/', { replace: true })
    }
  }, [booting, navigate, pathname, session])

  useEffect(() => {
    if (
      shouldShowAppShell &&
      !settingsMenuUnlocked &&
      SETTINGS_ENTRY_PATHS.has(pathname)
    ) {
      navigate('/account', { replace: true })
    }
  }, [navigate, pathname, settingsMenuUnlocked, shouldShowAppShell])

  useEffect(() => {
    if (language) {
      dayjs.locale(language === 'zh' ? 'zh-cn' : language)
      switchLanguage(language)
    }
  }, [language, switchLanguage])

  if (!themeReady) {
    return (
      <div
        style={{
          width: '100vw',
          height: '100vh',
          background: mode === 'light' ? '#fff' : '#181a1b',
          transition: 'background 0.2s',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: mode === 'light' ? '#333' : '#fff',
        }}
      ></div>
    )
  }

  return (
    <ThemeProvider theme={theme}>
      {/* 左侧底部窗口控制按钮 */}
      <NoticeManager position={verge?.notice_position} />
      <CrispSupport />
      <XboardAnnouncementDialog />
      <XboardUpdateDialog />
      <div
        style={{
          animation: 'fadeIn 0.5s',
          WebkitAnimation: 'fadeIn 0.5s',
        }}
      />
      <style>
        {`
            @keyframes fadeIn {
              from { opacity: 0; }
              to { opacity: 1; }
            }
          `}
      </style>
      <Paper
        square
        elevation={0}
        className={`${OS} layout${navCollapsed ? ' layout--nav-collapsed' : ''}`}
        style={{
          borderTopLeftRadius: '0px',
          borderTopRightRadius: '0px',
        }}
        onContextMenu={(e) => {
          if (
            OS === 'windows' &&
            !['input', 'textarea'].includes(
              e.currentTarget.tagName.toLowerCase(),
            ) &&
            !e.currentTarget.isContentEditable
          ) {
            e.preventDefault()
          }
        }}
        sx={[
          ({ palette }) => ({ bgcolor: palette.background.paper }),
          OS === 'linux'
            ? {
                borderRadius: '8px',
                width: '100vw',
                height: '100vh',
              }
            : {},
        ]}
      >
        {/* Custom titlebar - rendered only when decorated is false, memoized for performance */}
        {customTitlebar}

        <div
          className={`layout-content${shouldShowAppShell ? '' : ' layout-content--auth'}`}
        >
          {shouldShowAppShell && (
            <div className="layout-content__left">
              <div className="the-logo" data-tauri-drag-region="false">
                <div
                  data-tauri-drag-region="true"
                  style={{
                    minHeight: '44px',
                    minWidth: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-start',
                  }}
                >
                  <img src={brandLogo} alt="" className="brand-logo" />
                </div>
                <UpdateButton className="the-newbtn" />
              </div>

              {menuUnlocked && (
                <Box
                  sx={(theme) => ({
                    px: 1.5,
                    py: 0.75,
                    mx: 'auto',
                    mb: 1,
                    maxWidth: 250,
                    borderRadius: 1.5,
                    fontSize: 12,
                    fontWeight: 600,
                    textAlign: 'center',
                    color: theme.palette.warning.contrastText,
                    bgcolor:
                      theme.palette.mode === 'light'
                        ? theme.palette.warning.main
                        : theme.palette.warning.dark,
                  })}
                >
                  {t('layout.components.navigation.menu.reorderMode')}
                </Box>
              )}

              {menuUnlocked ? (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleMenuDragEnd}
                >
                  <SortableContext items={menuOrder}>
                    <List
                      className="the-menu"
                      onContextMenu={handleMenuContextMenu}
                    >
                      {menuOrder.map((path) => {
                        const item = navItemMap.get(path)
                        if (!item) {
                          return null
                        }
                        return (
                          <SortableNavMenuItem
                            key={item.path}
                            item={item}
                            label={resolveNavLabel(item.label)}
                            onActivate={() => handleNavItemActivate(item)}
                          />
                        )
                      })}
                    </List>
                  </SortableContext>
                </DndContext>
              ) : (
                <List
                  className="the-menu"
                  onContextMenu={handleMenuContextMenu}
                >
                  {menuOrder.map((path) => {
                    const item = navItemMap.get(path)
                    if (!item) {
                      return null
                    }
                    return (
                      <LayoutItem
                        key={item.path}
                        to={item.path}
                        icon={item.icon}
                        onActivate={() => handleNavItemActivate(item)}
                      >
                        {resolveNavLabel(item.label)}
                      </LayoutItem>
                    )
                  })}
                </List>
              )}

              <Menu
                open={Boolean(menuContextPosition)}
                onClose={handleMenuContextClose}
                anchorReference="anchorPosition"
                anchorPosition={
                  menuContextPosition
                    ? {
                        top: menuContextPosition.top,
                        left: menuContextPosition.left,
                      }
                    : undefined
                }
                transitionDuration={200}
                slotProps={{
                  list: {
                    sx: { py: 0.5 },
                  },
                }}
              >
                <MenuItem onClick={handleToggleNavCollapsed} dense>
                  {navCollapsed
                    ? t('layout.components.navigation.menu.expandNavBar')
                    : t('layout.components.navigation.menu.collapseNavBar')}
                </MenuItem>
                <MenuItem
                  onClick={menuUnlocked ? handleLockMenu : handleUnlockMenu}
                  dense
                >
                  {menuUnlocked
                    ? t('layout.components.navigation.menu.lock')
                    : t('layout.components.navigation.menu.unlock')}
                </MenuItem>
                <MenuItem
                  onClick={handleResetMenuOrder}
                  dense
                  disabled={isDefaultOrder}
                >
                  {t('layout.components.navigation.menu.restoreDefaultOrder')}
                </MenuItem>
              </Menu>

              <div className="the-traffic">
                <LayoutTraffic />
              </div>
            </div>
          )}

          <div className="layout-content__right">
            <div className="the-bar"></div>
            <div className="the-content">
              <BaseErrorBoundary>
                <Outlet />
              </BaseErrorBoundary>
            </div>
          </div>
        </div>
      </Paper>
    </ThemeProvider>
  )
}

export default Layout
