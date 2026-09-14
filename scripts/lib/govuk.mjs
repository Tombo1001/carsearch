/**
 * Small helpers for gov.uk's Content API.
 *
 * Every gov.uk page has a JSON twin at /api/content/<path>. It is the stable way
 * to find a statistics release's files: attachment URLs contain a media ID that
 * changes with every release, so a hardcoded CSV link goes dead each quarter,
 * whereas the page path does not. `public_updated_at` is also the page's own
 * record of its last substantive edit, which makes it a far quieter change
 * signal than hashing the HTML.
 */

import { politeFetch } from './polite-fetch.mjs'

const TIMEOUT_MS = 60_000

export async function govukContent(path) {
  const url = `https://www.gov.uk/api/content/${path.replace(/^\/+/, '')}`
  const res = await politeFetch(url, { timeoutMs: TIMEOUT_MS, headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`gov.uk content API ${res.status} for ${path}`)
  return res.json()
}

/** The attachment whose filename matches, or a thrown error naming what was there instead. */
export function findAttachment(content, filename) {
  const attachments = content.details?.attachments ?? []
  const hit = attachments.find((a) => a.filename === filename)
  if (!hit) {
    const seen = attachments.map((a) => a.filename).filter(Boolean).join(', ')
    throw new Error(`no attachment named ${filename} (found: ${seen || 'none'})`)
  }
  return { filename: hit.filename, url: hit.url, bytes: hit.file_size ?? null }
}
