import yaml from 'js-yaml'

import {
  createProfile,
  enhanceProfiles,
  getProfiles,
  patchProfile,
  patchProfilesConfig,
  restartCore,
  saveProfileFile,
  startCore,
} from '@/services/cmds'

import type { XboardApiClient } from './api'
import type { XboardRemoteConfig, XboardRecord } from './types'

const XBOARD_PROFILE_UID = 'xboard-subscription-profile'

const numberValue = (value: unknown) => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

const subscribeExtra = (subscribeInfo?: XboardRecord) => ({
  upload: numberValue(subscribeInfo?.u),
  download: numberValue(subscribeInfo?.d),
  total: numberValue(subscribeInfo?.transfer_enable),
  expire: numberValue(subscribeInfo?.expired_at),
})

export const ensureXboardSubscriptionProfile = async (
  client: XboardApiClient,
  subscribeToken: string,
  remoteConfig: XboardRemoteConfig,
  subscribeInfo?: XboardRecord,
) => {
  const yamlText = await client.subscribeYaml(subscribeToken)

  if (!yamlText.trim()) {
    throw new Error('订阅接口返回空配置')
  }

  yaml.load(yamlText)

  const profiles = await getProfiles()
  const items = profiles.items ?? []
  const existing = items.find(
    (item) =>
      item.uid === XBOARD_PROFILE_UID ||
      item.name === `${remoteConfig.APP_NAME} 订阅`,
  )
  const uid = existing?.uid ?? XBOARD_PROFILE_UID
  const itemPatch: Partial<IProfileItem> = {
    uid,
    type: 'local',
    name: `${remoteConfig.APP_NAME} 订阅`,
    desc: '由云端订阅服务生成，连接前会重新校验套餐和节点。',
    url: client.webSubscribeUrl(remoteConfig.subscribe_path, subscribeToken),
    extra: subscribeExtra(subscribeInfo),
    option: {
      with_proxy: true,
      self_proxy: false,
      user_agent: `${remoteConfig.custom_ua} clashmeta`,
      allow_auto_update: false,
    },
  }

  if (existing) {
    await saveProfileFile(uid, yamlText)
    await patchProfile(uid, itemPatch)
  } else {
    await createProfile(itemPatch, yamlText)
  }

  const nextProfiles = await getProfiles()
  await patchProfilesConfig({
    ...nextProfiles,
    current: uid,
  })
  await enhanceProfiles()

  return uid
}

export const restartCoreForXboard = async () => {
  try {
    await restartCore()
  } catch {
    await startCore()
  }
}
