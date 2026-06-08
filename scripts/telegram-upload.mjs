import { basename } from 'node:path'
import { createHash } from 'node:crypto'
import { openAsBlob, readFileSync, statSync } from 'node:fs'

import { glob } from 'glob'

const token = process.env.TELEGRAM_BOT_TOKEN
const chatId = process.env.TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID_RELEASE
const maxMb = Number(process.env.TELEGRAM_UPLOAD_MAX_MB || 50)
const maxBytes = maxMb * 1024 * 1024

const version =
  process.env.VERSION ||
  JSON.parse(readFileSync('package.json', 'utf8')).version
const releaseTag = process.env.RELEASE_TAG || `v${version}`
const buildLabel = process.env.BUILD_LABEL || 'Desktop'
const releaseUrl = `https://github.com/${process.env.GITHUB_REPOSITORY}/releases/tag/${releaseTag}`

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function formatMb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function sha256(file) {
  const hash = createHash('sha256')
  hash.update(readFileSync(file))
  return hash.digest('hex')
}

async function telegram(method, body) {
  const init = {
    body,
    method: 'POST',
  }
  if (typeof body === 'string') {
    init.headers = { 'Content-Type': 'application/json' }
  }

  const response = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    init,
  )
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.ok === false) {
    throw new Error(`${method} failed: ${JSON.stringify(data)}`)
  }
}

async function sendMessage(text) {
  await telegram(
    'sendMessage',
    JSON.stringify({
      chat_id: chatId,
      link_preview_options: { is_disabled: false },
      parse_mode: 'HTML',
      text,
    }),
  )
}

async function sendDocument(file) {
  const stats = statSync(file)
  const name = basename(file)
  const digest = sha256(file)
  const caption = [
    `<b>MuaCloud ${escapeHtml(releaseTag)}</b>`,
    escapeHtml(buildLabel),
    escapeHtml(name),
    `${formatMb(stats.size)}`,
    `<code>${digest}</code>`,
  ].join('\n')

  const form = new FormData()
  form.append('chat_id', chatId)
  form.append('caption', caption)
  form.append('parse_mode', 'HTML')
  form.append('document', await openAsBlob(file), name)

  await telegram('sendDocument', form)
}

if (!token) {
  throw new Error('TELEGRAM_BOT_TOKEN is required when telegram_upload is enabled')
}

if (!chatId) {
  throw new Error('TELEGRAM_CHAT_ID_RELEASE is required when telegram_upload is enabled')
}

const patterns = process.argv.slice(2)
const files = [
  ...new Set(
    (
      await Promise.all(
        patterns.map((pattern) =>
          glob(pattern.replaceAll('\\', '/'), { nodir: true }),
        ),
      )
    ).flat(),
  ),
]

if (files.length === 0) {
  throw new Error(`No Telegram upload files matched: ${patterns.join(', ')}`)
}

for (const file of files) {
  const stats = statSync(file)
  if (stats.size > maxBytes) {
    await sendMessage(
      [
        `<b>MuaCloud ${escapeHtml(releaseTag)}</b>`,
        `${escapeHtml(buildLabel)} artifact is too large for Telegram direct upload.`,
        `${escapeHtml(basename(file))}: ${formatMb(stats.size)}`,
        `<a href="${releaseUrl}">Open GitHub Release</a>`,
      ].join('\n'),
    )
    continue
  }

  await sendDocument(file)
}
