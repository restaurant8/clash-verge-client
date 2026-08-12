import { invoke } from '@tauri-apps/api/core'

import { isTauriRuntime } from '@/utils/tauri'

/** mihomo `dns.nameserver-policy` 的值:单个上游或上游列表。 */
export type XboardNameserverPolicy = Record<string, string | string[]>

// React effects may publish a cached value and a freshly fetched value almost
// simultaneously. Keep writes ordered so an older request cannot finish last
// and overwrite the newest remote policy.
let policyWriteQueue: Promise<boolean> = Promise.resolve(false)

const normalizeServers = (raw: unknown): string | string[] | undefined => {
  const servers = (Array.isArray(raw) ? raw.join(',') : String(raw ?? ''))
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  if (servers.length === 0) return undefined
  return servers.length === 1 ? servers[0] : servers
}

/**
 * 解析远程下发的 nameserver-policy,两种写法都支持:
 *
 *   JSON   `{"snejsat.baidu.com":"https://xxx.alidns.com/dns-query"}`
 *   键值对 `snejsat.baidu.com=https://xxx.alidns.com/dns-query;+.foo.com=8.8.8.8`
 *
 * 条目之间用 `;` 或换行分隔;同一域名要指定多个上游时,上游之间用 `,` 分隔。
 */
export const parseNameserverPolicy = (raw: unknown): XboardNameserverPolicy => {
  const policy: XboardNameserverPolicy = {}

  const collect = (domain: unknown, servers: unknown) => {
    const key = String(domain ?? '').trim()
    const value = normalizeServers(servers)
    if (!key || value === undefined) return
    policy[key] = value
  }

  const collectObject = (input: Record<string, unknown>) => {
    Object.entries(input).forEach(([domain, servers]) =>
      collect(domain, servers),
    )
  }

  if (raw && typeof raw === 'object') {
    collectObject(raw as Record<string, unknown>)
    return policy
  }

  const text = String(raw ?? '').trim()
  if (!text) return policy

  if (text.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(text)
      if (parsed && typeof parsed === 'object') {
        collectObject(parsed as Record<string, unknown>)
        return policy
      }
    } catch {
      console.warn('[Xboard] invalid dns_nameserver_policy JSON, ignored')
      return policy
    }
  }

  text
    .split(/[;\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .forEach((entry) => {
      const index = entry.indexOf('=')
      if (index <= 0) return
      collect(entry.slice(0, index), entry.slice(index + 1))
    })

  return policy
}

/**
 * 把远程 policy 落盘到内核配置生成流程。优先级高于 DNS 设置页与手动覆写:
 * 后端在所有覆写之后才合并这份 policy。返回内容是否发生了变化。
 */
export const pushNameserverPolicy = async (raw: unknown): Promise<boolean> => {
  if (!isTauriRuntime()) return false

  const policy = parseNameserverPolicy(raw)
  const write = policyWriteQueue.then(() =>
    invoke<boolean>('save_remote_dns_policy', { policy }),
  )
  policyWriteQueue = write.catch((error) => {
    console.warn('[Xboard] failed to apply remote dns policy', error)
    return false
  })
  return policyWriteQueue
}
