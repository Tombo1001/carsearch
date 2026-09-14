/**
 * Checks whether the zone and vehicle data are still current.
 *
 *   npm run data:check                 report only; changes nothing
 *   npm run data:check -- --apply      also refresh the committed data files
 *
 * Writes a Markdown report to tmp/data-check.md. Runs weekly in CI
 * (.github/workflows/data-check.yml), which turns the result into a pull request
 * or an issue. See docs/data.md.
 *
 * What can be checked by machine, and what cannot:
 *
 *   Boundaries       machine-readable feeds, so fully automatic. A changed boundary
 *                    is applied; a failed fetch keeps the last official boundary
 *                    rather than deleting the zone from the live map.
 *   DfT vehicles     the release has a publication timestamp, so fully automatic.
 *   Charges, hours,  exist only as prose on council and TfL pages. The check
 *   new zones        fingerprints each page's main text and reports the lines that
 *                    changed, but a person has to read them and update
 *                    scripts/zone-sources.mjs. It cannot tell "10 pounds" in a
 *                    press release from a tariff change, and pretending otherwise
 *                    would put wrong charges in front of people deciding what car
 *                    to buy.
 *
 * All fetching goes through scripts/lib/polite-fetch.mjs: robots.txt is obeyed,
 * Crawl-delay is honoured, and a refusal is final. Pages a site will not serve to
 * this check are listed for checking by hand - never retried around.
 */

import { execFile } from 'node:child_process'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { CHARGES_AS_OF, NATIONAL_LISTINGS, ZONE_INFO, ZONE_SOURCES } from './zone-sources.mjs'
import { dftRelease } from './dft-vehicles.mjs'
import { govukContent } from './lib/govuk.mjs'
import { politeFetch, RobotsDisallowed } from './lib/polite-fetch.mjs'

const run = promisify(execFile)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ZONES = resolve(ROOT, 'public/data/zones.json')
const CATALOGUE = resolve(ROOT, 'public/data/catalogue.json')
const WATCH = resolve(ROOT, 'data/watch/pages.json')
const REPORT = resolve(ROOT, 'tmp/data-check.md')
const CANDIDATE = resolve(ROOT, 'tmp/zones.candidate.json')

const APPLY = process.argv.includes('--apply')
const TODAY = new Date().toISOString().slice(0, 10)

/** Charges older than this get flagged for a manual re-verification pass. */
const CHARGES_MAX_AGE_DAYS = 120


/** A human has to look at these. Anything here makes CI open an issue or PR. */
const review = []
/** Pages the check may not or cannot read. Listed every run, never escalated. */
const byHand = []
/** Informational: applied automatically, or probably transient. */
const notes = []
const sections = []

// ---------------------------------------------------------------- helpers --

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const stable = (zone) => JSON.stringify({ ...zone })

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return fallback
  }
}

// ------------------------------------------------------------- boundaries --

async function checkBoundaries() {
  const lines = []
  await mkdir(dirname(CANDIDATE), { recursive: true })
  try {
    await run(process.execPath, [resolve(ROOT, 'scripts/build-zones.mjs'), '--out', CANDIDATE], {
      cwd: ROOT,
      maxBuffer: 16 * 1024 * 1024,
      timeout: 15 * 60_000,
    })
  } catch (err) {
    // build-zones exits 0 even with per-zone failures; a throw here is a crash.
    review.push(`The boundary build crashed: ${String(err.stderr || err.message).trim().split('\n').pop()}`)
    sections.push(['Boundaries', ['The boundary build crashed, so nothing was compared. See the workflow log.']])
    return
  }

  const current = await readJson(ZONES, { zones: [] })
  const candidate = await readJson(CANDIDATE, null)
  const before = new Map(current.zones.map((z) => [z.id, z]))
  const after = new Map(candidate.zones.map((z) => [z.id, z]))

  const changedGeometry = []
  const changedMeta = []
  for (const [id, z] of after) {
    const old = before.get(id)
    if (!old) {
      lines.push(`- **Added:** ${z.name}`)
      continue
    }
    if (JSON.stringify(old.geometry) !== JSON.stringify(z.geometry)) changedGeometry.push(z.name)
    const { geometry: _a, bbox: _b, ...oldMeta } = old
    const { geometry: _c, bbox: _d, ...newMeta } = z
    if (stable(oldMeta) !== stable(newMeta)) changedMeta.push(z.name)
  }

  // A failed fetch is not evidence the zone has gone. Keep the last official shape.
  const carried = []
  for (const f of candidate.failures) {
    const old = before.get(f.id)
    lines.push(`- **Could not fetch** ${f.name}: ${f.error}${old ? ' - kept the previous boundary' : ''}`)
    if (old) {
      after.set(f.id, old)
      carried.push(f.id)
    }
  }
  for (const [id, z] of before) {
    if (!after.has(id)) lines.push(`- **Removed from the registry:** ${z.name}`)
  }

  if (changedGeometry.length) {
    lines.push(`- **Boundary changed:** ${changedGeometry.join(', ')}`)
    review.push(
      `Boundary changed for ${changedGeometry.join(', ')} - check the map against the authority before merging.`,
    )
  }
  if (changedMeta.length) lines.push(`- **Registry details changed:** ${changedMeta.join(', ')}`)
  if (candidate.failures.length) {
    notes.push(`${plural(candidate.failures.length, 'boundary fetch')} failed; previous boundaries kept.`)
  }

  for (const r of candidate.retained ?? []) {
    lines.push(
      `- **Not refreshed:** ${r.name} - its data service's robots.txt excludes automated clients, so the ` +
        `official boundary from ${r.keptFrom?.slice(0, 10) ?? 'the last build'} is kept. Refresh it by hand: see docs/data.md.`,
    )
  }
  if (!lines.length) lines.push(`All ${candidate.zones.length} boundaries match their official sources.`)
  sections.push(['Boundaries', lines])

  const differs = changedGeometry.length || changedMeta.length || after.size !== before.size
  if (APPLY && differs) {
    const order = [...candidate.zones.map((z) => z.id), ...carried.filter((id) => !candidate.zones.some((z) => z.id === id))]
    const merged = {
      ...candidate,
      zones: order.map((id) => after.get(id)),
      // Carried-over zones are present, so they are not user-visible failures.
      failures: candidate.failures.filter((f) => !carried.includes(f.id)),
    }
    await writeFile(ZONES, JSON.stringify(merged))
    notes.push('Updated public/data/zones.json.')
  }
}

// ----------------------------------------------------------------- pages --

/**
 * The readable text of a page as a list of lines: <main> if there is one, with
 * scripts, navigation and boilerplate removed. Deliberately crude - the goal is a
 * diff a person can read, not a faithful rendering.
 */
function mainText(html) {
  let s = html
  const main = s.match(/<main[\s\S]*?<\/main>/i) ?? s.match(/<article[\s\S]*?<\/article>/i)
  if (main) s = main[0]
  s = s
    .replace(/<(script|style|noscript|svg|nav|header|footer|form|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|p|div|li|h[1-6]|tr|td|th|dt|dd|section)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  const text = decodeEntities(s)
  const seen = new Set()
  return text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 2 && l.length < 400)
    .filter((l) => !/cookie|javascript|last updated|page last|share this|skip to|feedback|was this page/i.test(l))
    .filter((l) => (seen.has(l) ? false : (seen.add(l), true)))
    .slice(0, 300)
}

function decodeEntities(s) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', pound: '£', ndash: '-', mdash: '-', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', hellip: '...' }
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => named[n.toLowerCase()] ?? m)
}

/**
 * Fetches a page for watching. Only a plain 200 counts: bot-protection services
 * answer 202 with a challenge page, and treating that as content would record the
 * challenge as the baseline.
 */
async function fetchPage(url) {
  try {
    const res = await politeFetch(url, { timeoutMs: 45_000, headers: { accept: 'text/html,application/xhtml+xml' } })
    return { status: res.status, finalUrl: res.url, html: res.status === 200 ? await res.text() : '' }
  } catch (err) {
    if (err instanceof RobotsDisallowed) return { status: 'robots', finalUrl: url, html: '' }
    return { status: 0, finalUrl: url, html: '', error: err.cause?.code || err.name || String(err) }
  }
}

/** Place names a national listing currently links to. */
function listedPlaces(listing, html, govukBody) {
  if (govukBody) {
    // The GOV.UK guidance links each zone's name to its council's page.
    const names = new Set()
    for (const [, href, text] of govukBody.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
      const t = decodeEntities(text.replace(/<[^>]+>/g, '')).trim()
      // Council sites are themselves *.gov.uk, so only GOV.UK's own hosts are excluded.
      const host = /^https?:\/\//.test(href) ? new URL(href).hostname : ''
      const ownSite = host === 'www.gov.uk' || host.endsWith('.service.gov.uk')
      if (host && !ownSite && /^[A-Z][A-Za-z&' -]{2,30}( \(.*\))?$/.test(t)) {
        if (!/form|service|video|complain|contact/i.test(t)) names.add(t.replace(/ \(.*\)$/, ''))
      }
    }
    return [...names]
  }
  const sentence = decodeEntities(html.replace(/<[^>]+>/g, ' ')).match(/located in the city centres of ([^.]+)\./i)
  return sentence ? sentence[1].split(/,|\band\b/).map((s) => s.trim()).filter(Boolean) : null
}

async function checkPages() {
  const state = await readJson(WATCH, { pages: {} })
  const next = { pages: {} }

  const targets = [
    ...ZONE_SOURCES.map((z) => ({ key: z.id, label: z.name, ...ZONE_INFO[z.id] })),
    ...NATIONAL_LISTINGS.map((l) => ({ key: l.id, label: l.name, url: l.url, listing: l })),
  ]

  const changed = []
  const lines = []

  for (const t of targets) {
    const prev = state.pages[t.key]
    const page = await fetchPage(t.url)
    let govuk = null
    if (page.status === 200 && t.listing?.govukPath) {
      try {
        govuk = await govukContent(t.listing.govukPath)
      } catch (err) {
        notes.push(`${t.label}: GOV.UK content API failed (${err.message}); compared page text only.`)
      }
    }

    if (page.status !== 200) {
      if (prev) next.pages[t.key] = prev
      const dead = page.status === 404 || page.status === 410
      if (dead) {
        // The page is gone, not refused: someone has to find where it moved.
        lines.push(`- **Dead link**: [${t.label}](${t.url}) - HTTP ${page.status}`)
        review.push(`${t.label}: ${t.url} returns HTTP ${page.status}. Find its new page and update ZONE_INFO.`)
      } else if (page.status === 'robots') {
        byHand.push({ ...t, why: 'robots.txt asks automated clients not to fetch it' })
      } else if (page.status === 0) {
        lines.push(`- Could not reach [${t.label}](${t.url}) - ${page.error}; will try again next run`)
      } else {
        // 401/403/202/429: the site will not serve this check. That is the site's
        // call; it is listed for a person rather than retried or worked around.
        byHand.push({ ...t, why: `the site refused this automated request (HTTP ${page.status})` })
      }
      continue
    }

    const text = mainText(page.html)
    const entry = {
      url: t.url,
      checkedAt: TODAY,
      ...(govuk ? { publicUpdatedAt: govuk.public_updated_at } : {}),
      ...(page.finalUrl !== t.url ? { redirectsTo: page.finalUrl } : {}),
      lines: text,
    }

    if (t.listing) {
      const places = listedPlaces(t.listing, page.html, govuk?.details?.body)
      entry.places = places
      if (!places?.length) {
        review.push(`${t.label}: could not read its list of zones - the page layout may have changed.`)
      } else {
        const known = new Set(t.listing.names)
        const added = places.filter((p) => !known.has(p))
        const gone = t.listing.names.filter((n) => !places.includes(n))
        if (added.length) review.push(`${t.label} now lists ${added.join(', ')} - a new zone? Add it to scripts/zone-sources.mjs.`)
        if (gone.length) review.push(`${t.label} no longer lists ${gone.join(', ')} - has a zone ended?`)
      }
    }

    next.pages[t.key] = entry
    if (!prev) {
      lines.push(`- Baseline recorded: [${t.label}](${t.url})`)
      continue
    }

    const had = new Set(prev.lines)
    const has = new Set(text)
    const added = text.filter((l) => !had.has(l))
    const removed = prev.lines.filter((l) => !has.has(l))
    const govukMoved = govuk && prev.publicUpdatedAt && prev.publicUpdatedAt !== govuk.public_updated_at
    if (added.length || removed.length || govukMoved) {
      changed.push({ t, added, removed, govukMoved, prev, govuk })
    }
  }

  for (const c of changed) {
    const money = [...c.added, ...c.removed].some((l) => /£\s?\d|per day|daily charge|penalty/i.test(l))
    review.push(`${c.t.label} changed${money ? ' - including lines about charges' : ''}.`)
    lines.push(`\n#### [${c.t.label}](${c.t.url})${money ? ' - mentions charges' : ''}`)
    if (c.govukMoved) lines.push(`GOV.UK says it was updated: ${c.prev.publicUpdatedAt} -> ${c.govuk.public_updated_at}`)
    lines.push('```diff')
    for (const l of c.removed.slice(0, 25)) lines.push(`- ${l}`)
    for (const l of c.added.slice(0, 25)) lines.push(`+ ${l}`)
    if (c.removed.length > 25 || c.added.length > 25) lines.push('  ... (truncated)')
    lines.push('```')
  }

  if (!lines.length) lines.push(`No changes on ${plural(targets.length, 'watched page')}.`)
  sections.push(['Authority pages', lines])

  if (APPLY) {
    await mkdir(dirname(WATCH), { recursive: true })
    await writeFile(WATCH, `${JSON.stringify(next, null, 1)}\n`)
  }
}

// ------------------------------------------------------------- vehicles --

async function checkVehicles() {
  const catalogue = await readJson(CATALOGUE, null)
  const had = catalogue?.sources?.dft
  let release
  try {
    release = await dftRelease()
  } catch (err) {
    sections.push(['Vehicles', [`Could not read the DfT release page: ${err.message}`]])
    notes.push('DfT release check failed; will retry next run.')
    return
  }

  const sameFiles = had && JSON.stringify(had.files?.map((f) => f.url)) === JSON.stringify(release.files.map((f) => f.url))
  if (had && had.releaseUpdatedAt === release.updatedAt && sameFiles) {
    sections.push(['Vehicles', [`Up to date with the DfT release of ${release.updatedAt.slice(0, 10)}.`]])
    return
  }

  const lines = [
    `New DfT vehicle licensing release: ${release.updatedAt.slice(0, 10)} (catalogue has ${had?.releaseUpdatedAt?.slice(0, 10) ?? 'none'}).`,
  ]
  if (APPLY) {
    try {
      const { stdout } = await run(process.execPath, [resolve(ROOT, 'scripts/build-catalogue.mjs')], {
        cwd: ROOT,
        maxBuffer: 16 * 1024 * 1024,
        timeout: 30 * 60_000,
      })
      lines.push('Rebuilt public/data/catalogue.json:', '```', stdout.trim(), '```')
      notes.push('Rebuilt the vehicle catalogue from the new DfT release.')
    } catch (err) {
      lines.push(`Rebuild failed: ${String(err.stderr || err.message).trim().split('\n').pop()}`)
      review.push('A new DfT release is out but the catalogue rebuild failed - the file layout may have changed.')
    }
  }
  sections.push(['Vehicles', lines])
}

// ---------------------------------------------------------------- charges --

function checkChargesAge() {
  const age = Math.floor((Date.now() - Date.parse(CHARGES_AS_OF)) / 86_400_000)
  const lines = [`Charges were last verified by hand on ${CHARGES_AS_OF} (${plural(age, 'day')} ago).`]
  if (age > CHARGES_MAX_AGE_DAYS) {
    review.push(
      `Charges have not been re-verified in ${age} days. Check each zone's page in ZONE_INFO, then bump CHARGES_AS_OF.`,
    )
  }
  sections.push(['Charges', lines])

  if (byHand.length) {
    sections.push([
      'Not watched automatically',
      [
        'These pages cannot be checked by this job, so changes to them will not be reported. ' +
          'Look at them yourself whenever you re-verify charges:',
        '',
        ...byHand.map((t) => `- [${t.label}](${t.url}) - ${t.why}`),
      ],
    ])
  }
}

// ------------------------------------------------------------------- main --

console.log(`carsearch data check${APPLY ? ' (--apply)' : ''}\n`)
console.log('  boundaries...')
await checkBoundaries()
console.log('  authority pages...')
await checkPages()
console.log('  vehicles...')
await checkVehicles()
checkChargesAge()

const report = [
  `## Data check - ${TODAY}`,
  '',
  review.length
    ? `**${plural(review.length, 'item')} ${review.length === 1 ? 'needs' : 'need'} a person to look at ${review.length === 1 ? 'it' : 'them'}:**\n\n${review.map((r) => `- [ ] ${r}`).join('\n')}`
    : '**Nothing needs review.**',
  notes.length ? `\n${notes.map((n) => `- ${n}`).join('\n')}` : '',
  ...sections.flatMap(([title, lines]) => ['', `### ${title}`, '', ...lines]),
  '',
  '---',
  '<sub>Generated by <code>npm run data:check</code>. Charges and new zones cannot be read ' +
    'reliably by machine: when a page above changed, read the diff, update ' +
    '<code>scripts/zone-sources.mjs</code> if a charge moved, and bump <code>CHARGES_AS_OF</code>. See docs/data.md.</sub>',
].join('\n')

await mkdir(dirname(REPORT), { recursive: true })
await writeFile(REPORT, `${report}\n`)

console.log(`\n${report}\n`)
console.log(`  report: ${REPORT}`)

if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, `review=${review.length > 0}\nreport=${REPORT}\n`)
}
