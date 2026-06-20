import {
  CloseRounded,
  DnsOutlined,
  EmailRounded,
  LoginRounded,
  RouterOutlined,
} from '@mui/icons-material'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  Grid,
  IconButton,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { LogicalSize } from '@tauri-apps/api/dpi'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useLockFn } from 'ahooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import brandLogo from '@/assets/image/muacloud-logo.svg'
import { ClashModeCard } from '@/components/home/clash-mode-card'
import { EnhancedCard } from '@/components/home/enhanced-card'
import { ProxyTunCard } from '@/components/home/proxy-tun-card'
import { XboardPage } from '@/components/xboard/xboard-page'
import {
  XboardActionButton,
  XboardMetric,
  XboardPanel,
  XboardStatusChip,
  XboardTrafficBar,
} from '@/components/xboard/xboard-primitives'
import { useXboard } from '@/providers/xboard-context'
import { formatBytes, formatDateTime } from '@/services/xboard/format'
import {
  clearRememberedLogin,
  readRememberedLogin,
  saveRememberedLogin,
} from '@/services/xboard/remembered-login'
import type {
  XboardRecord,
  XboardResolvedConfig,
} from '@/services/xboard/types'
import { isTauriRuntime } from '@/utils/tauri'

type LoginMode = 'login' | 'register' | 'forgot'

const AUTH_WINDOW_WIDTH = 520
const AUTH_WINDOW_MIN_HEIGHT = 520
const AUTH_WINDOW_DEFAULT_HEIGHT = 560
const AUTH_WINDOW_MAX_HEIGHT = 840

const hasValue = (value: unknown) =>
  value !== undefined && value !== null && value !== ''

const firstValue = (...values: unknown[]) => values.find(hasValue)

const asRecord = (value: unknown): XboardRecord =>
  value && typeof value === 'object' ? (value as XboardRecord) : {}

const boolFrom = (value: unknown, fallback = false) => {
  if (!hasValue(value)) return fallback
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0

  const normalized = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on', 'enabled', 'enable'].includes(normalized)) {
    return true
  }
  if (['0', 'false', 'no', 'off', 'disabled', 'disable'].includes(normalized)) {
    return false
  }
  return fallback
}

const enabledFrom = (value: unknown, fallback = true) =>
  hasValue(value) ? boolFrom(value, fallback) : fallback

const cleanDisplayText = (value: unknown, fallback: string) => {
  const text = String(value ?? '').trim()
  if (!text || /x\s*board|xborad/i.test(text)) return fallback
  return text
}

const normalizeStringList = (value: unknown) => {
  const values = Array.isArray(value)
    ? value
    : String(value ?? '').split(/[,\s;，、|]+/)

  return values
    .flatMap((item) =>
      Array.isArray(item) ? item : String(item ?? '').split(/[,\s;，、|]+/),
    )
    .map((item) => String(item).trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean)
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const emailDomain = (value: string) =>
  value.trim().toLowerCase().split('@').pop() ?? ''

const formatSuffixes = (suffixes: string[]) => {
  const preview = suffixes.slice(0, 4).join('、')
  return suffixes.length > 4 ? `${preview} 等` : preview
}

const validateEmailAddress = (
  value: string,
  settings: ReturnType<typeof getAuthSettings>,
  enforceRegisterRules = false,
) => {
  const normalized = value.trim()
  if (!normalized) return '请先填写邮箱'
  if (!EMAIL_PATTERN.test(normalized)) return '邮箱格式不正确'

  const domain = emailDomain(normalized)
  const localPart = normalized.split('@')[0]?.toLowerCase() ?? ''

  if (
    enforceRegisterRules &&
    settings.blockGmailAlias &&
    ['gmail.com', 'googlemail.com'].includes(domain) &&
    (localPart.includes('+') || localPart.includes('.'))
  ) {
    return '当前不支持 Gmail 多别名注册'
  }

  if (
    enforceRegisterRules &&
    settings.blockedEmailSuffixes.some(
      (suffix) => domain === suffix || domain.endsWith(`.${suffix}`),
    )
  ) {
    return '该邮箱后缀暂不支持'
  }

  if (
    enforceRegisterRules &&
    settings.allowedEmailSuffixes.length &&
    !settings.allowedEmailSuffixes.some(
      (suffix) => domain === suffix || domain.endsWith(`.${suffix}`),
    )
  ) {
    return `邮箱后缀需为：${formatSuffixes(settings.allowedEmailSuffixes)}`
  }

  if (enforceRegisterRules && settings.emailPattern) {
    try {
      const pattern = new RegExp(settings.emailPattern)
      if (!pattern.test(normalized)) return '邮箱格式不符合当前注册规则'
    } catch {
      return ''
    }
  }

  return ''
}

const loadedScripts = new Map<string, Promise<void>>()

const loadExternalScript = (id: string, src: string) => {
  if (loadedScripts.has(id)) return loadedScripts.get(id)!

  const promise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(id) as HTMLScriptElement | null
    if (existing?.dataset.loaded === 'true') {
      resolve()
      return
    }

    const script = existing ?? document.createElement('script')
    script.id = id
    script.src = src
    script.async = true
    script.defer = true
    script.onload = () => {
      script.dataset.loaded = 'true'
      resolve()
    }
    script.onerror = () => reject(new Error('人机验证加载失败，请稍后重试'))
    if (!existing) document.head.appendChild(script)
  })

  loadedScripts.set(id, promise)
  return promise
}

const getCaptchaSiteKey = (settings: ReturnType<typeof getAuthSettings>) => {
  if (settings.captchaType === 'turnstile') return settings.turnstileSiteKey
  if (settings.captchaType === 'recaptcha-v3')
    return settings.recaptchaV3SiteKey
  return settings.recaptchaSiteKey
}

const captchaPayload = (
  settings: ReturnType<typeof getAuthSettings>,
  token: string,
) => {
  if (!settings.captchaEnabled || !token) return {}
  if (settings.captchaType === 'turnstile') return { turnstile_token: token }
  if (settings.captchaType === 'recaptcha-v3') {
    return { recaptcha_v3_token: token }
  }
  return { recaptcha_data: token }
}

const responseMessage = (value: unknown, fallback: string) =>
  cleanDisplayText(asRecord(value).message, fallback)

const getAuthSettings = (remote: XboardResolvedConfig) => {
  const bootstrap = asRecord(remote.bootstrap)
  const guest = asRecord(bootstrap.guest_config)
  const features = asRecord(bootstrap.features)
  const publicUi = asRecord(bootstrap.public_ui_config)
  const security = asRecord(bootstrap.security_config)
  const ui = asRecord(bootstrap.ui_config)
  const auth = asRecord(
    firstValue(
      bootstrap.auth_config,
      bootstrap.auth,
      security.auth,
      publicUi.auth,
      ui.auth,
    ),
  )

  const stopRegister = firstValue(
    features.stop_register,
    features.disable_registration,
    publicUi.stop_register,
    publicUi.disable_registration,
    ui.stop_register,
    ui.disable_registration,
    security.stop_register,
    security.disable_registration,
    auth.stop_register,
    auth.disable_registration,
    guest.stop_register,
    guest.disable_registration,
  )
  const disableRegister = firstValue(
    stopRegister,
    features.disable_register,
    publicUi.disable_register,
    ui.disable_register,
    security.disable_register,
    auth.disable_register,
    guest.disable_register,
  )
  const registerEnabled = hasValue(disableRegister)
    ? !boolFrom(disableRegister)
    : enabledFrom(
        firstValue(
          features.enable_register,
          features.register,
          publicUi.enable_register,
          ui.enable_register,
          security.enable_register,
          auth.enable_register,
          guest.enable_register,
          guest.register_enable,
          guest.is_register,
        ),
        true,
      )

  const disableForgot = firstValue(
    features.disable_password_reset,
    features.disable_forget_password,
    publicUi.disable_password_reset,
    ui.disable_password_reset,
    security.disable_password_reset,
    auth.disable_password_reset,
    guest.disable_password_reset,
    guest.disable_forget_password,
  )
  const forgotEnabled = hasValue(disableForgot)
    ? !boolFrom(disableForgot)
    : enabledFrom(
        firstValue(
          features.enable_password_reset,
          features.enable_reset_password,
          features.enable_forget_password,
          publicUi.enable_password_reset,
          ui.enable_password_reset,
          security.enable_password_reset,
          auth.enable_password_reset,
          guest.enable_password_reset,
          guest.enable_reset_password,
          guest.enable_forget_password,
        ),
        true,
      )

  const allowedEmailSuffixes = normalizeStringList(
    firstValue(
      features.email_whitelist_suffix,
      features.email_whitelist,
      features.email_allow_suffix,
      publicUi.email_whitelist_suffix,
      publicUi.email_whitelist,
      ui.email_whitelist_suffix,
      ui.email_whitelist,
      security.email_whitelist_suffix,
      security.email_whitelist,
      auth.email_whitelist_suffix,
      auth.email_whitelist,
      guest.email_whitelist_suffix,
      guest.email_whitelist,
      guest.email_allow_suffix,
    ),
  )
  const blockedEmailSuffixes = normalizeStringList(
    firstValue(
      features.email_blacklist_suffix,
      features.email_blacklist,
      publicUi.email_blacklist_suffix,
      publicUi.email_blacklist,
      ui.email_blacklist_suffix,
      ui.email_blacklist,
      security.email_blacklist_suffix,
      security.email_blacklist,
      auth.email_blacklist_suffix,
      auth.email_blacklist,
      guest.email_blacklist_suffix,
      guest.email_blacklist,
    ),
  )

  const captchaType = String(
    firstValue(
      features.captcha_type,
      features.captcha_provider,
      publicUi.captcha_type,
      publicUi.captcha_provider,
      ui.captcha_type,
      ui.captcha_provider,
      security.captcha_type,
      security.captcha_provider,
      auth.captcha_type,
      auth.captcha_provider,
      guest.captcha_type,
      guest.captcha_provider,
      guest.is_recaptcha ? 'recaptcha' : '',
    ) ?? '',
  )
    .trim()
    .toLowerCase()
    .replaceAll('_', '-')

  return {
    registerEnabled,
    registerClosed: boolFrom(stopRegister),
    forgotEnabled,
    allowedEmailSuffixes,
    blockedEmailSuffixes,
    blockGmailAlias: boolFrom(
      firstValue(
        features.email_gmail_limit_enable,
        features.gmail_alias_limit,
        features.disable_gmail_alias,
        publicUi.email_gmail_limit_enable,
        publicUi.gmail_alias_limit,
        publicUi.disable_gmail_alias,
        ui.email_gmail_limit_enable,
        ui.gmail_alias_limit,
        ui.disable_gmail_alias,
        security.email_gmail_limit_enable,
        security.gmail_alias_limit,
        security.disable_gmail_alias,
        auth.email_gmail_limit_enable,
        auth.gmail_alias_limit,
        auth.disable_gmail_alias,
        guest.email_gmail_limit_enable,
        guest.gmail_alias_limit,
        guest.disable_gmail_alias,
      ),
    ),
    emailPattern: String(
      firstValue(
        features.email_pattern,
        features.email_regex,
        publicUi.email_pattern,
        publicUi.email_regex,
        ui.email_pattern,
        ui.email_regex,
        security.email_pattern,
        security.email_regex,
        auth.email_pattern,
        auth.email_regex,
        guest.email_pattern,
        guest.email_regex,
      ) ?? '',
    ).trim(),
    emailVerifyRequired: boolFrom(
      firstValue(
        features.email_verify,
        features.enable_email_verify,
        publicUi.email_verify,
        ui.email_verify,
        security.email_verify,
        security.is_email_verify,
        auth.email_verify,
        guest.email_verify,
        guest.enable_email_verify,
        guest.is_email_verify,
      ),
    ),
    inviteRequired: boolFrom(
      firstValue(
        features.invite_force,
        publicUi.invite_force,
        ui.invite_force,
        security.invite_force,
        security.is_invite_force,
        auth.invite_force,
        guest.invite_force,
        guest.is_invite_force,
      ),
    ),
    captchaEnabled: boolFrom(
      firstValue(
        features.captcha,
        features.enable_captcha,
        features.is_captcha,
        features.captcha_enable,
        features.enable_recaptcha,
        features.is_recaptcha,
        publicUi.captcha,
        publicUi.enable_captcha,
        publicUi.is_captcha,
        publicUi.captcha_enable,
        ui.captcha,
        ui.enable_captcha,
        ui.is_captcha,
        ui.captcha_enable,
        security.captcha,
        security.enable_captcha,
        security.is_captcha,
        security.captcha_enable,
        auth.captcha,
        auth.enable_captcha,
        auth.is_captcha,
        auth.captcha_enable,
        guest.captcha,
        guest.enable_captcha,
        guest.is_captcha,
        guest.captcha_enable,
        guest.enable_recaptcha,
        guest.is_recaptcha,
      ),
    ),
    captchaType: captchaType || 'recaptcha',
    recaptchaSiteKey: String(
      firstValue(
        features.recaptcha_site_key,
        features.captcha_site_key,
        features.site_key,
        publicUi.recaptcha_site_key,
        publicUi.captcha_site_key,
        publicUi.site_key,
        ui.recaptcha_site_key,
        ui.captcha_site_key,
        ui.site_key,
        security.recaptcha_site_key,
        security.captcha_site_key,
        security.site_key,
        auth.recaptcha_site_key,
        auth.captcha_site_key,
        auth.site_key,
        guest.recaptcha_site_key,
        guest.captcha_site_key,
        guest.site_key,
      ) ?? '',
    ),
    recaptchaV3SiteKey: String(
      firstValue(
        features.recaptcha_v3_site_key,
        features.recaptcha_v3_key,
        publicUi.recaptcha_v3_site_key,
        publicUi.recaptcha_v3_key,
        ui.recaptcha_v3_site_key,
        ui.recaptcha_v3_key,
        security.recaptcha_v3_site_key,
        security.recaptcha_v3_key,
        auth.recaptcha_v3_site_key,
        auth.recaptcha_v3_key,
        guest.recaptcha_v3_site_key,
        guest.recaptcha_v3_key,
      ) ?? '',
    ),
    turnstileSiteKey: String(
      firstValue(
        features.turnstile_site_key,
        features.turnstile_key,
        features.cf_turnstile_site_key,
        publicUi.turnstile_site_key,
        publicUi.turnstile_key,
        publicUi.cf_turnstile_site_key,
        ui.turnstile_site_key,
        ui.turnstile_key,
        ui.cf_turnstile_site_key,
        security.turnstile_site_key,
        security.turnstile_key,
        security.cf_turnstile_site_key,
        auth.turnstile_site_key,
        auth.turnstile_key,
        auth.cf_turnstile_site_key,
        guest.turnstile_site_key,
        guest.turnstile_key,
        guest.cf_turnstile_site_key,
      ) ?? '',
    ),
  }
}

const CaptchaControl = ({
  settings,
  resetKey,
  onTokenChange,
  onError,
}: {
  settings: ReturnType<typeof getAuthSettings>
  resetKey: number
  onTokenChange: (token: string) => void
  onError: (message: string) => void
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const widgetRef = useRef<string | number | null>(null)
  const siteKey = getCaptchaSiteKey(settings)

  useEffect(() => {
    if (resetKey < 0) return
    if (!settings.captchaEnabled || !siteKey) return

    let disposed = false
    const container = containerRef.current
    if (!container) return

    onTokenChange('')
    container.innerHTML = ''

    const renderCaptcha = async () => {
      try {
        if (settings.captchaType === 'turnstile') {
          await loadExternalScript(
            'cf-turnstile-api',
            'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
          )
          if (disposed) return
          widgetRef.current = (window as any).turnstile?.render(container, {
            sitekey: siteKey,
            callback: (token: string) => onTokenChange(token),
            'expired-callback': () => onTokenChange(''),
            'error-callback': () => onTokenChange(''),
          })
          return
        }

        if (settings.captchaType === 'recaptcha-v3') {
          await loadExternalScript(
            'google-recaptcha-v3-api',
            `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`,
          )
          if (disposed) return
          ;(window as any).grecaptcha?.ready(() => {
            if (disposed) return
            ;(window as any).grecaptcha
              ?.execute(siteKey, { action: 'register' })
              .then((token: string) => {
                if (!disposed) onTokenChange(token)
              })
              .catch(() => {
                if (!disposed) onError('人机验证失败，请稍后重试')
              })
          })
          return
        }

        await loadExternalScript(
          'google-recaptcha-api',
          'https://www.google.com/recaptcha/api.js?render=explicit',
        )
        if (disposed) return
        widgetRef.current = (window as any).grecaptcha?.render(container, {
          sitekey: siteKey,
          callback: (token: string) => onTokenChange(token),
          'expired-callback': () => onTokenChange(''),
          'error-callback': () => onTokenChange(''),
        })
      } catch {
        if (!disposed) onError('人机验证加载失败，请稍后重试')
      }
    }

    void renderCaptcha()

    return () => {
      disposed = true
      if (settings.captchaType === 'turnstile' && widgetRef.current) {
        ;(window as any).turnstile?.remove?.(widgetRef.current)
      }
      if (settings.captchaType !== 'turnstile' && widgetRef.current !== null) {
        ;(window as any).grecaptcha?.reset?.(widgetRef.current)
      }
      container.innerHTML = ''
      widgetRef.current = null
    }
  }, [
    onError,
    onTokenChange,
    resetKey,
    settings.captchaEnabled,
    settings.captchaType,
    siteKey,
  ])

  if (!settings.captchaEnabled) return null

  if (!siteKey) {
    return (
      <Alert severity="warning">人机验证配置缺少站点密钥，请联系支持</Alert>
    )
  }

  return (
    <Box
      sx={{
        minHeight: settings.captchaType === 'recaptcha-v3' ? 42 : 74,
        display: 'grid',
        alignItems: 'center',
        border: '1px solid',
        borderColor: '#dbe7e2',
        borderRadius: 1,
        px: 1,
        py: 1,
        bgcolor: '#eeeeee',
      }}
    >
      {settings.captchaType === 'recaptcha-v3' && (
        <Typography variant="caption" color="text.secondary">
          正在准备人机验证
        </Typography>
      )}
      <Box ref={containerRef} />
    </Box>
  )
}

const AuthPanel = () => {
  const { client, login, register, remote, refreshing, refreshRemoteConfig } =
    useXboard()
  const authContentRef = useRef<HTMLDivElement | null>(null)
  const [mode, setMode] = useState<LoginMode>('login')
  const [email, setEmail] = useState('')
  const [registerEmailLocal, setRegisterEmailLocal] = useState('')
  const [registerEmailSuffix, setRegisterEmailSuffix] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [emailCode, setEmailCode] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [rememberPassword, setRememberPassword] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [loadingRemembered, setLoadingRemembered] = useState(true)
  const [verificationSent, setVerificationSent] = useState(false)
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaResetKey, setCaptchaResetKey] = useState(0)

  const authSettings = useMemo(() => getAuthSettings(remote), [remote])
  const registerEmailSuffixOptions = authSettings.allowedEmailSuffixes
  const registerEmailSuffixValue =
    registerEmailSuffixOptions.find(
      (suffix) => suffix === registerEmailSuffix,
    ) ??
    registerEmailSuffixOptions[0] ??
    ''
  const usesRegisterEmailSuffixSelect =
    mode === 'register' && registerEmailSuffixOptions.length > 0
  const registerEmailCandidate =
    usesRegisterEmailSuffixSelect &&
    registerEmailLocal.trim() &&
    registerEmailSuffixValue
      ? `${registerEmailLocal.trim()}@${registerEmailSuffixValue}`
      : ''
  const emailCandidate = usesRegisterEmailSuffixSelect
    ? registerEmailCandidate
    : email
  const normalizedEmail = emailCandidate.trim()
  const enforceRegisterEmailRules = mode === 'register'
  const normalizedEmailCode = emailCode.trim()
  const emailValidationMessage = useMemo(
    () =>
      normalizedEmail
        ? validateEmailAddress(
            normalizedEmail,
            authSettings,
            enforceRegisterEmailRules,
          )
        : '',
    [authSettings, enforceRegisterEmailRules, normalizedEmail],
  )
  const passwordValidationMessage =
    mode !== 'login' && password && password.length < 8 ? '密码至少 8 位' : ''
  const needsEmailCode =
    mode === 'forgot' ||
    (mode === 'register' && authSettings.emailVerifyRequired)
  const emailCodeValidationMessage =
    needsEmailCode && emailCode && !/^\d{6}$/.test(normalizedEmailCode)
      ? '验证码为 6 位数字'
      : ''
  const modeDisabled =
    (mode === 'register' && !authSettings.registerEnabled) ||
    (mode === 'forgot' && !authSettings.forgotEnabled)
  const captchaVisible = mode !== 'login' && authSettings.captchaEnabled
  const captchaRequiredForCode = needsEmailCode && captchaVisible
  const captchaRequiredForSubmit = mode === 'register' && captchaVisible
  const canSubmit =
    Boolean(normalizedEmail && password) &&
    !emailValidationMessage &&
    !passwordValidationMessage &&
    !emailCodeValidationMessage &&
    (!needsEmailCode || Boolean(normalizedEmailCode)) &&
    (mode !== 'register' ||
      !authSettings.inviteRequired ||
      Boolean(inviteCode)) &&
    (!captchaRequiredForSubmit || Boolean(captchaToken)) &&
    !modeDisabled &&
    !refreshing &&
    !submitting
  const authWindowContentKey = [
    mode,
    usesRegisterEmailSuffixSelect ? 'suffix' : '',
    needsEmailCode ? 'email-code' : '',
    captchaVisible ? 'captcha' : '',
    error ? 'error' : '',
    success ? 'success' : '',
  ].join(':')

  useEffect(() => {
    if (!isTauriRuntime()) return

    let disposed = false

    const resizeAuthWindow = async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve())
      })
      if (disposed) return

      const contentHeight = authContentRef.current?.scrollHeight ?? 0
      const nextHeight = Math.min(
        Math.max(contentHeight + 80, AUTH_WINDOW_DEFAULT_HEIGHT),
        AUTH_WINDOW_MAX_HEIGHT,
      )
      const window = getCurrentWindow()

      await window.setMinSize(
        new LogicalSize(AUTH_WINDOW_WIDTH, AUTH_WINDOW_MIN_HEIGHT),
      )
      await window.setSize(new LogicalSize(AUTH_WINDOW_WIDTH, nextHeight))
    }

    void resizeAuthWindow().catch((error) => {
      console.warn('[AuthPanel] failed to resize auth window:', error)
    })

    return () => {
      disposed = true
    }
  }, [authWindowContentKey])

  useEffect(() => {
    let disposed = false

    const restoreRememberedLogin = async () => {
      const remembered = await readRememberedLogin()
      if (disposed) return

      if (remembered) {
        setEmail(remembered.email)
        setPassword(remembered.password)
        setRememberPassword(true)
      }
      setLoadingRemembered(false)
    }

    void restoreRememberedLogin().catch(() => {
      if (!disposed) setLoadingRemembered(false)
    })

    return () => {
      disposed = true
    }
  }, [])

  const sendVerificationCode = useLockFn(async () => {
    setError('')
    setSuccess('')

    const emailProblem = validateEmailAddress(
      normalizedEmail,
      authSettings,
      enforceRegisterEmailRules,
    )
    if (emailProblem) {
      setError(emailProblem)
      return
    }
    if (captchaRequiredForCode && !getCaptchaSiteKey(authSettings)) {
      setError('人机验证配置缺少站点密钥，请联系支持')
      return
    }
    if (captchaRequiredForCode && !captchaToken) {
      setError('请先完成人机验证')
      return
    }

    setSendingCode(true)
    try {
      const response = await client.sendEmailVerify({
        email: normalizedEmail,
        ...captchaPayload(authSettings, captchaToken),
      })
      setVerificationSent(true)
      setSuccess(responseMessage(response, '验证码已发送，请查看邮箱'))
      if (captchaVisible) {
        setCaptchaToken('')
        setCaptchaResetKey((value) => value + 1)
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? cleanDisplayText(err.message, '验证码发送失败，请稍后重试')
          : '验证码发送失败，请稍后重试',
      )
      if (captchaVisible) {
        setCaptchaToken('')
        setCaptchaResetKey((value) => value + 1)
      }
    } finally {
      setSendingCode(false)
    }
  })

  useEffect(() => {
    if (mode === 'login') return
    void refreshRemoteConfig().catch((err) => {
      setError(
        err instanceof Error
          ? cleanDisplayText(err.message, '远程配置刷新失败，请稍后重试')
          : '远程配置刷新失败，请稍后重试',
      )
    })
  }, [mode, refreshRemoteConfig])

  const submit = useLockFn(async () => {
    setError('')
    setSuccess('')
    setSubmitting(true)
    try {
      const emailProblem = validateEmailAddress(
        normalizedEmail,
        authSettings,
        enforceRegisterEmailRules,
      )
      if (emailProblem) throw new Error(emailProblem)
      if (passwordValidationMessage) throw new Error(passwordValidationMessage)
      if (emailCodeValidationMessage)
        throw new Error(emailCodeValidationMessage)

      if (mode === 'login') {
        await login(normalizedEmail, password)
        if (rememberPassword) {
          await saveRememberedLogin(normalizedEmail, password).catch(() => {})
        } else {
          clearRememberedLogin()
        }
        return
      }

      if (mode === 'register') {
        if (!authSettings.registerEnabled) {
          throw new Error('注册入口当前由云端关闭')
        }
        if (captchaRequiredForSubmit && !getCaptchaSiteKey(authSettings)) {
          throw new Error('人机验证配置缺少站点密钥，请联系支持')
        }
        if (captchaRequiredForSubmit && !captchaToken) {
          throw new Error('请先完成人机验证')
        }
        if (authSettings.inviteRequired && !inviteCode) {
          throw new Error('请填写邀请码')
        }
        if (authSettings.emailVerifyRequired && !normalizedEmailCode) {
          throw new Error('请填写邮箱验证码')
        }

        await register({
          email: normalizedEmail,
          password,
          invite_code: inviteCode || undefined,
          email_code: normalizedEmailCode || undefined,
          ...captchaPayload(authSettings, captchaToken),
        })
        return
      }

      if (!authSettings.forgotEnabled) {
        throw new Error('找回密码当前由云端关闭')
      }
      if (!normalizedEmailCode) {
        throw new Error('请填写邮箱验证码')
      }

      const response = await client.forgetPassword({
        email: normalizedEmail,
        password,
        email_code: normalizedEmailCode,
      })
      setMode('login')
      setPassword('')
      setEmailCode('')
      setVerificationSent(false)
      setCaptchaToken('')
      setCaptchaResetKey((value) => value + 1)
      setSuccess(responseMessage(response, '密码已重置，请使用新密码登录'))
    } catch (err) {
      setError(
        err instanceof Error
          ? cleanDisplayText(err.message, '操作失败，请稍后重试')
          : '操作失败，请稍后重试',
      )
      if (captchaVisible) {
        setCaptchaToken('')
        setCaptchaResetKey((value) => value + 1)
      }
    } finally {
      setSubmitting(false)
    }
  })

  const brandName = cleanDisplayText(remote.remoteConfig.APP_NAME, 'MuaCloud')
  const modeTitle =
    mode === 'login'
      ? '登录账户'
      : mode === 'register'
        ? '创建账户'
        : '找回密码'
  const modeSubtitle =
    mode === 'login'
      ? cleanDisplayText(
          remote.remoteConfig.login_title,
          '欢迎回来，继续畅享稳定服务',
        )
      : mode === 'register'
        ? '注册后即可开通套餐，开始使用专属加速服务'
        : '验证邮箱后重设密码，继续使用你的账户'
  const passwordLabel = mode === 'forgot' ? '新密码' : '密码'
  const submitLabel =
    mode === 'login' ? '登录' : mode === 'register' ? '注册并登录' : '重置密码'
  const closeAuthWindow = () => {
    if (isTauriRuntime()) {
      void getCurrentWindow().close()
    }
  }

  return (
    <Box
      sx={{
        minHeight: '100%',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        pt: { xs: 4, sm: 5 },
        px: { xs: 2, md: 3 },
        pb: 2,
        bgcolor: 'background.paper',
        boxSizing: 'border-box',
        overflowY: 'auto',
        position: 'relative',
      }}
      data-tauri-drag-region="true"
    >
      <Tooltip title="关闭">
        <IconButton
          size="small"
          aria-label="关闭"
          onClick={closeAuthWindow}
          data-tauri-drag-region="false"
          sx={{
            position: 'absolute',
            top: 10,
            right: 10,
            width: 30,
            height: 30,
            borderRadius: 1,
            color: 'text.secondary',
            '&:hover': {
              bgcolor: '#fee2e2',
              color: '#dc2626',
            },
          }}
        >
          <CloseRounded fontSize="small" />
        </IconButton>
      </Tooltip>
      <Box
        ref={authContentRef}
        sx={{
          width: 'min(460px, 100%)',
          p: { xs: 1, sm: 2 },
        }}
      >
        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
          <Box
            component="img"
            src={brandLogo}
            alt=""
            sx={{
              width: 48,
              height: 48,
              borderRadius: 1,
              objectFit: 'cover',
              boxShadow: '0 12px 28px rgba(21, 148, 102, 0.18)',
            }}
          />
          <Box sx={{ minWidth: 0, py: 0.25 }}>
            <Typography
              sx={{
                fontSize: 22,
                fontWeight: 900,
                lineHeight: 1.18,
                letterSpacing: 0,
                overflow: 'visible',
              }}
            >
              {brandName}
            </Typography>
          </Box>
        </Stack>

        <Typography variant="h5" sx={{ mt: 3, fontWeight: 900 }}>
          {modeTitle}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {modeSubtitle}
        </Typography>

        <Tabs
          value={mode}
          onChange={(_, value) => {
            setMode(value as LoginMode)
            setError('')
            setSuccess('')
            setEmailCode('')
            setVerificationSent(false)
            setCaptchaToken('')
            setCaptchaResetKey((current) => current + 1)
          }}
          variant="fullWidth"
          sx={{ mt: 2 }}
        >
          <Tab value="login" label="登录" />
          <Tab
            value="register"
            label="注册"
            disabled={!authSettings.registerEnabled}
          />
          <Tab
            value="forgot"
            label="找回密码"
            disabled={!authSettings.forgotEnabled}
          />
        </Tabs>

        <Stack spacing={1.5} sx={{ mt: 2 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {success && <Alert severity="success">{success}</Alert>}
          {!authSettings.registerEnabled && (
            <Alert severity="info">注册入口当前由云端关闭</Alert>
          )}
          {!authSettings.forgotEnabled && (
            <Alert severity="info">找回密码当前由云端关闭</Alert>
          )}
          {usesRegisterEmailSuffixSelect ? (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <TextField
                label="邮箱账号"
                value={registerEmailLocal}
                onChange={(event) => setRegisterEmailLocal(event.target.value)}
                autoComplete="email"
                error={Boolean(emailValidationMessage)}
                helperText={emailValidationMessage || undefined}
                fullWidth
              />
              <TextField
                select
                label="邮箱后缀"
                value={registerEmailSuffixValue}
                onChange={(event) => setRegisterEmailSuffix(event.target.value)}
                sx={{ minWidth: { xs: '100%', sm: 172 } }}
              >
                {registerEmailSuffixOptions.map((suffix) => (
                  <MenuItem value={suffix} key={suffix}>
                    @{suffix}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
          ) : (
            <TextField
              label="邮箱"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              error={Boolean(emailValidationMessage)}
              helperText={emailValidationMessage || undefined}
              fullWidth
            />
          )}
          <TextField
            label={passwordLabel}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type={showPassword ? 'text' : 'password'}
            autoComplete={
              mode === 'login' ? 'current-password' : 'new-password'
            }
            error={Boolean(passwordValidationMessage)}
            helperText={passwordValidationMessage || undefined}
            fullWidth
          />
          {mode === 'login' && (
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center', justifyContent: 'space-between' }}
            >
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={rememberPassword}
                    disabled={loadingRemembered || submitting || refreshing}
                    onChange={(event) => {
                      const checked = event.target.checked
                      setRememberPassword(checked)
                      if (!checked) clearRememberedLogin()
                    }}
                  />
                }
                label="记住密码"
              />
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={showPassword}
                    onChange={(event) => setShowPassword(event.target.checked)}
                  />
                }
                label="显示密码"
              />
            </Stack>
          )}
          {mode === 'register' && (
            <TextField
              label={authSettings.inviteRequired ? '邀请码' : '邀请码（选填）'}
              value={inviteCode}
              onChange={(event) => setInviteCode(event.target.value)}
              required={authSettings.inviteRequired}
              fullWidth
            />
          )}
          {captchaVisible && (
            <CaptchaControl
              settings={authSettings}
              resetKey={captchaResetKey}
              onTokenChange={setCaptchaToken}
              onError={setError}
            />
          )}
          {needsEmailCode && (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <TextField
                label="邮箱验证码"
                value={emailCode}
                onChange={(event) => setEmailCode(event.target.value)}
                autoComplete="one-time-code"
                error={Boolean(emailCodeValidationMessage)}
                helperText={emailCodeValidationMessage || undefined}
                slotProps={{
                  htmlInput: {
                    inputMode: 'numeric',
                    maxLength: 6,
                  },
                }}
                required
                fullWidth
              />
              <Button
                variant="outlined"
                startIcon={
                  sendingCode ? (
                    <CircularProgress size={16} />
                  ) : (
                    <EmailRounded />
                  )
                }
                disabled={
                  !normalizedEmail ||
                  Boolean(emailValidationMessage) ||
                  sendingCode ||
                  submitting ||
                  refreshing ||
                  (captchaRequiredForCode &&
                    (!captchaToken || !getCaptchaSiteKey(authSettings)))
                }
                onClick={() => void sendVerificationCode()}
                sx={{
                  minWidth: { xs: '100%', sm: 122 },
                  height: 56,
                  flexShrink: 0,
                }}
              >
                {verificationSent ? '重新发送' : '发送验证码'}
              </Button>
            </Stack>
          )}
          <Box sx={{ display: 'grid', pt: 1 }}>
            <XboardActionButton
              size="large"
              startIcon={
                submitting || refreshing ? (
                  <CircularProgress color="inherit" size={18} />
                ) : mode === 'forgot' ? (
                  <EmailRounded />
                ) : (
                  <LoginRounded />
                )
              }
              disabled={!canSubmit}
              onClick={() => void submit()}
            >
              {submitLabel}
            </XboardActionButton>
          </Box>
        </Stack>
      </Box>
    </Box>
  )
}

const ConnectPage = () => {
  const navigate = useNavigate()
  const { session, userInfo, subscribeInfo, servers, booting, connection } =
    useXboard()

  const used = Number(subscribeInfo?.u ?? 0) + Number(subscribeInfo?.d ?? 0)
  const total = Number(subscribeInfo?.transfer_enable ?? 0)
  const hasServers = servers.length > 0

  if (booting) {
    return (
      <Box
        sx={{
          height: '100%',
          display: 'grid',
          placeItems: 'center',
          bgcolor: 'background.paper',
        }}
        data-tauri-drag-region="true"
      >
        <Stack sx={{ alignItems: 'center' }} spacing={2}>
          <Box
            component="img"
            src={brandLogo}
            alt=""
            sx={{ width: 60, height: 60, borderRadius: 1, objectFit: 'cover' }}
          />
          <CircularProgress size={26} />
          <Typography color="text.secondary">正在准备登录环境</Typography>
        </Stack>
      </Box>
    )
  }

  if (!session) return <AuthPanel />

  return (
    <XboardPage title="系统-网卡双代理" subtitle="真全局">
      <Stack spacing={2}>
        {connection.status === 'error' && connection.message && (
          <Alert severity="error">{connection.message}</Alert>
        )}
        {!hasServers && (
          <Alert
            severity="warning"
            action={
              <Button
                color="inherit"
                size="small"
                onClick={() => navigate('/plans')}
              >
                套餐
              </Button>
            }
          >
            当前账户暂无可用节点，连接前需要开通或续费套餐。
          </Alert>
        )}

        <Grid container spacing={1.5}>
          <Grid size={{ xs: 12, md: 6 }}>
            <EnhancedCard
              title="网络设置"
              icon={<DnsOutlined />}
              iconColor="primary"
            >
              <ProxyTunCard />
            </EnhancedCard>
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <EnhancedCard
              title="代理模式"
              icon={<RouterOutlined />}
              iconColor="info"
            >
              <ClashModeCard showCurrentNodeSelector />
            </EnhancedCard>
          </Grid>
        </Grid>

        <Grid container spacing={1.5}>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <XboardMetric label="已用流量" value={formatBytes(used)} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <XboardMetric label="总流量" value={formatBytes(total)} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <XboardMetric
              label="到期时间"
              value={formatDateTime(subscribeInfo?.expired_at)}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <XboardMetric label="可用节点" value={servers.length} />
          </Grid>
        </Grid>

        <XboardPanel
          title="账户摘要"
          action={
            <XboardStatusChip
              status={subscribeInfo?.expired_at ? 'success' : 'warning'}
              label={subscribeInfo?.expired_at ? '权益有效' : '待开通'}
            />
          }
          sx={{ p: 2.25 }}
        >
          <Stack spacing={1.5}>
            <Box sx={{ minWidth: 0 }}>
              <Typography
                sx={{
                  maxWidth: '100%',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontWeight: 900,
                }}
              >
                {userInfo?.email ?? session.email ?? '已登录账户'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {subscribeInfo?.plan?.name ?? '未开通套餐'}
              </Typography>
            </Box>
            <XboardTrafficBar used={used} total={total} />
          </Stack>
        </XboardPanel>
      </Stack>
    </XboardPage>
  )
}

export default ConnectPage
