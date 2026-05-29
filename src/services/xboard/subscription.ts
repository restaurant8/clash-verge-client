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

const buildProfileOption = (
  remoteConfig: XboardRemoteConfig,
  base?: IProfileOption,
): IProfileOption => ({
  ...base,
  with_proxy: true,
  self_proxy: false,
  user_agent: `${remoteConfig.custom_ua} clashmeta`,
  allow_auto_update: false,
})

const findXboardProfile = (
  items: IProfileItem[],
  profileName: string,
  subscribeUrl: string,
  preferredUid?: string,
) =>
  items.find((item) => item.uid === preferredUid) ??
  items.find((item) => item.url === subscribeUrl) ??
  items.find((item) => item.uid === XBOARD_PROFILE_UID) ??
  items.find((item) => item.name === profileName)

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

  const profileName = `${remoteConfig.APP_NAME} 订阅`
  const subscribeUrl = client.webSubscribeUrl(
    remoteConfig.subscribe_path,
    subscribeToken,
  )
  const profiles = await getProfiles()
  const items = profiles.items ?? []
  const existing = findXboardProfile(items, profileName, subscribeUrl)

  const buildPatch = (
    uid: string,
    baseOption?: IProfileOption,
  ): Partial<IProfileItem> => ({
    uid,
    type: 'local',
    name: profileName,
    desc: '由云端订阅服务生成，连接前会重新校验套餐和节点。',
    url: subscribeUrl,
    extra: subscribeExtra(subscribeInfo),
    option: buildProfileOption(remoteConfig, baseOption),
  })

  let uid = existing?.uid

  if (existing && uid) {
    await saveProfileFile(uid, yamlText)
    await patchProfile(uid, buildPatch(uid, existing.option))
  } else {
    const createdUid = await createProfile(
      {
        type: 'local',
        name: profileName,
        desc: '由云端订阅服务生成，连接前会重新校验套餐和节点。',
        option: buildProfileOption(remoteConfig),
      },
      yamlText,
    )
    const createdProfiles = await getProfiles()
    const created = findXboardProfile(
      createdProfiles.items ?? [],
      profileName,
      subscribeUrl,
      createdUid,
    )

    if (!created?.uid) {
      throw new Error('订阅配置已创建，但未找到对应 profile')
    }

    uid = created.uid
    await patchProfile(uid, buildPatch(uid, created.option))
  }

  if (!uid) {
    throw new Error('订阅配置 uid 为空')
  }

  const nextProfiles = await getProfiles()
  const switched = await patchProfilesConfig({
    ...nextProfiles,
    current: uid,
  })
  if (!switched) {
    throw new Error('订阅配置校验失败，未能切换到 Xboard profile')
  }

  const enhanced = await enhanceProfiles()
  if (!enhanced) {
    throw new Error('订阅配置生成失败')
  }

  return uid
}

export const restartCoreForXboard = async () => {
  try {
    await restartCore()
  } catch {
    await startCore()
  }
}
