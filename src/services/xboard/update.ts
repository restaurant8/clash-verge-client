import getSystem from '@/utils/get-system'

import type { XboardRemoteConfig } from './types'

/**
 * Window event the "检查更新" button dispatches; the update dialog listens for it
 * to force a manual check (force-refresh remote config, re-show or report
 * "already up to date").
 */
export const XBOARD_CHECK_UPDATE_EVENT = 'muacloud-check-update'

export interface XboardClientUpdate {
  /** Platform key the update was resolved for. */
  platform: 'windows' | 'macos'
  /** Newer version advertised by the remote config. */
  latestVersion: string
  /** Where to download the new build. */
  downloadUrl: string
  /** Optional release notes. */
  notes: string
  /** When true the user must update before continuing. */
  forceUpdate: boolean
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

  const downloadUrl =
    (platform === 'windows'
      ? remoteConfig.windows_download_url
      : remoteConfig.macos_download_url
    ).trim() || remoteConfig.latest_client_url.trim()

  const notes =
    (platform === 'windows'
      ? remoteConfig.windows_update_notes
      : remoteConfig.macos_update_notes
    ).trim() || remoteConfig.update_notes.trim()

  const forceUpdate =
    platform === 'windows'
      ? remoteConfig.windows_force_update
      : remoteConfig.macos_force_update

  return { platform, latestVersion: latest, downloadUrl, notes, forceUpdate }
}
