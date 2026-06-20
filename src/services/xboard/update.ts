import getSystem from '@/utils/get-system'

import type { XboardRemoteConfig } from './types'

/**
 * Window event the "检查更新" button dispatches; the update dialog listens for it
 * to force a manual check (force-refresh remote config, re-show or report
 * "already up to date").
 */
export const XBOARD_CHECK_UPDATE_EVENT = 'muacloud-check-update'

export interface XboardDownloadOption {
  /** User-facing label, e.g. "Apple 芯片" / "Intel 芯片". */
  label: string
  /** Download URL for this option. */
  url: string
}

export interface XboardClientUpdate {
  /** Platform key the update was resolved for. */
  platform: 'windows' | 'macos'
  /** Newer version advertised by the remote config. */
  latestVersion: string
  /** Primary download URL (first of {@link downloads}); kept for back-compat. */
  downloadUrl: string
  /**
   * One or more download choices. macOS may expose two (Apple Silicon / Intel)
   * when the remote config provides arch-specific URLs; otherwise a single one.
   */
  downloads: XboardDownloadOption[]
  /** Optional release notes. */
  notes: string
  /** When true the user must update before continuing. */
  forceUpdate: boolean
}

/** First non-empty trimmed string among the candidates, or '' if none. */
const firstUrl = (...candidates: unknown[]): string => {
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

/**
 * Build the macOS download choices. When the remote config provides
 * arch-specific URLs (Apple Silicon and/or Intel) they are offered separately
 * so the user picks the build matching their chip — arch can't be reliably
 * auto-detected from the webview. Falls back to the single `macos_download_url`.
 */
const resolveMacDownloads = (
  remoteConfig: XboardRemoteConfig,
): XboardDownloadOption[] => {
  const arm = firstUrl(
    remoteConfig.macos_arm64_download_url,
    remoteConfig.macos_aarch64_download_url,
    remoteConfig.macos_apple_silicon_download_url,
  )
  const intel = firstUrl(
    remoteConfig.macos_intel_download_url,
    remoteConfig.macos_x64_download_url,
    remoteConfig.macos_x86_64_download_url,
  )

  const downloads: XboardDownloadOption[] = []
  if (arm) downloads.push({ label: 'Apple 芯片（M 系列）', url: arm })
  if (intel) downloads.push({ label: 'Intel 芯片', url: intel })
  if (downloads.length) return downloads

  const single = firstUrl(
    remoteConfig.macos_download_url,
    remoteConfig.latest_client_url,
  )
  return single ? [{ label: '立即更新', url: single }] : []
}

/**
 * Compare dotted version strings numerically (e.g. "2.10.0" vs "2.9.5").
 * Returns >0 if [a] is newer than [b], 0 if equal, <0 otherwise. Non-numeric
 * separators are ignored. Mirrors the Android `XboardConfig.compareVersions`.
 */
export const compareVersions = (a: string, b: string): number => {
  const split = (value: string) =>
    value
      .split(/[^0-9]+/)
      .filter(Boolean)
      .map((part) => Number.parseInt(part, 10) || 0)

  const pa = split(a)
  const pb = split(b)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i += 1) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x - y
  }
  return 0
}

/**
 * Whether the resolved remote config advertises a desktop build newer than
 * [currentVersion] for the current platform (windows/macos), falling back to
 * the shared `version` / `latest_client_url`. Returns the update with its
 * download URL / notes / force flag, or null if up to date or unsupported.
 * Mirrors the Android `XboardClient.androidUpdate`.
 */
export const resolveClientUpdate = (
  remoteConfig: XboardRemoteConfig,
  currentVersion: string,
): XboardClientUpdate | null => {
  const system = getSystem()
  const platform: 'windows' | 'macos' | null =
    system === 'windows' ? 'windows' : system === 'macos' ? 'macos' : null
  if (!platform) return null

  const latest =
    (platform === 'windows'
      ? remoteConfig.windows_version
      : remoteConfig.macos_version
    ).trim() || remoteConfig.version.trim()
  if (!latest || compareVersions(latest, currentVersion) <= 0) return null

  const downloads =
    platform === 'windows'
      ? (() => {
          const url = firstUrl(
            remoteConfig.windows_download_url,
            remoteConfig.latest_client_url,
          )
          return url ? [{ label: '立即更新', url }] : []
        })()
      : resolveMacDownloads(remoteConfig)

  const downloadUrl = downloads[0]?.url ?? ''

  const notes =
    (platform === 'windows'
      ? remoteConfig.windows_update_notes
      : remoteConfig.macos_update_notes
    ).trim() || remoteConfig.update_notes.trim()

  const forceUpdate =
    platform === 'windows'
      ? remoteConfig.windows_force_update
      : remoteConfig.macos_force_update

  return {
    platform,
    latestVersion: latest,
    downloadUrl,
    downloads,
    notes,
    forceUpdate,
  }
}
