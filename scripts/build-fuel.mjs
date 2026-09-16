/**
 * Builds public/data/fuel.json: today's median pump prices for each UK region.
 *
 *   npm run data:fuel                        live, from the Fuel Finder API
 *   npm run data:fuel -- --from-dump <file>  from a saved API response (testing)
 *                        --out <file>        write somewhere other than public/data/fuel.json
 *
 * Source: Fuel Finder, the GOV.UK service created by the Motor Fuel Price (Open
 * Data) Regulations 2025. Every UK forecourt must publish price changes within 30
 * minutes. The public API needs OAuth client credentials, created through a
 * GOV.UK One Login on the Fuel Finder developer portal. They are read from:
 *
 *   FUEL_FINDER_CLIENT_ID
 *   FUEL_FINDER_CLIENT_SECRET
 *
 * With no credentials the script says so and exits cleanly, leaving any existing
 * fuel.json alone, so forks and fresh clones still build.
 *
 * Only aggregates are written. Individual forecourts, names and phone numbers
 * never leave this script.
 *
 * Runs daily in CI (.github/workflows/fuel-prices.yml). See docs/data.md.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { politeFetch } from './lib/polite-fetch.mjs'
import { inBBox, pointInMultiPolygon } from './lib/geometry.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REGIONS = resolve(ROOT, 'public/data/regions.json')

const API = 'https://www.fuel-finder.service.gov.uk'
const PORTAL = 'https://www.developer.fuel-finder.service.gov.uk/fuel-finder'

/** The API returns up to this many forecourts per batch. A shorter batch is the last. */
const BATCH_SIZE = 500
/** Stops a runaway loop if the API ever keeps returning full batches. ~8,500 forecourts today. */
const MAX_BATCHES = 60
/** Live limit is 100 requests a minute, one at a time. This keeps well under it. */
const REQUEST_GAP_MS = 1_000

/** Days of history kept for the "change since last week" figure. */
const HISTORY_DAYS = 60
/** A region's median is only published with at least this many forecourts behind it. */
const MIN_SAMPLE = 10
/** Prices outside this band (pence per litre) are data-entry errors, not prices. */
const PLAUSIBLE = { min: 80, max: 300 }

export const FUELS = {
  E10: 'Unleaded (E10)',
  E5: 'Super unleaded (E5)',
  B7S: 'Diesel (B7)',
  B7P: 'Premium diesel',
  B10: 'Diesel (B10)',
  HVO: 'HVO',
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const args = process.argv.slice(2)
const argValue = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null)
const OUT = resolve(argValue('--out') ?? resolve(ROOT, 'public/data/fuel.json'))

// --------------------------------------------------------------------- API --

async function apiJson(path, init = {}) {
  const res = await politeFetch(`${API}${path}`, { timeoutMs: 60_000, ...init })
  const text = await res.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(`${path}: HTTP ${res.status}, response was not JSON`)
  }
  if (!res.ok) {
    // Error bodies nest their message at varying depths; find any readable one.
    const msg = body?.data?.message || body?.data?.data?.message || body?.message?.details || body?.error || body?.message
    throw new Error(`${path}: HTTP ${res.status} ${typeof msg === 'string' ? msg : ''}`.trim())
  }
  return body
}

async function accessToken(clientId, clientSecret) {
  const body = await apiJson('/api/v1/oauth/generate_access_token', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
  })
  const token = body?.data?.access_token
  if (!token) throw new Error('token response had no access_token')
  return token
}

/** Every batch of an endpoint. The spec documents both a bare array and {data: [...]}. */
async function allBatches(path, token) {
  const rows = []
  for (let batch = 1; batch <= MAX_BATCHES; batch++) {
    if (batch > 1) await sleep(REQUEST_GAP_MS)
    const body = await apiJson(`${path}?batch-number=${batch}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    })
    const page = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : null
    if (!page) throw new Error(`${path} batch ${batch}: unexpected response shape`)
    rows.push(...page)
    if (page.length < BATCH_SIZE) return rows
  }
  throw new Error(`${path}: still full after ${MAX_BATCHES} batches; raise MAX_BATCHES if the UK really has that many forecourts`)
}

// ------------------------------------------------------------- aggregate --

const num = (v) => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

function median(values) {
  const s = [...values].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const round1 = (n) => Math.round(n * 10) / 10

/** Region for a forecourt: by coordinates, else by country for the three single-region nations. */
function regionFinder(regions) {
  const byCountry = { scotland: 'TLM', wales: 'TLL', 'northern ireland': 'TLN' }
  return (loc) => {
    const lat = num(loc?.latitude)
    const lon = num(loc?.longitude)
    if (lat !== null && lon !== null && Math.abs(lat) > 0.01) {
      const p = [lon, lat]
      for (const r of regions) if (inBBox(p, r.bbox) && pointInMultiPolygon(p, r.geometry)) return r.code
    }
    return byCountry[String(loc?.country ?? '').trim().toLowerCase()] ?? null
  }
}

export function aggregate(stations, prices, regions) {
  const findRegion = regionFinder(regions)
  const regionOf = new Map()
  const excluded = { closed: 0, unplaced: 0, implausiblePrice: 0, noStation: 0 }

  for (const s of stations) {
    if (s.permanent_closure || s.temporary_closure) {
      excluded.closed++
      continue
    }
    const code = findRegion(s.location)
    if (!code) {
      excluded.unplaced++
      continue
    }
    regionOf.set(s.node_id, code)
  }

  // fuel -> region code (or 'UK') -> prices
  const samples = {}
  let newest = null
  for (const p of prices) {
    const code = regionOf.get(p.node_id)
    if (!code) {
      excluded.noStation++
      continue
    }
    for (const fp of p.fuel_prices ?? []) {
      if (!FUELS[fp.fuel_type]) continue
      const price = num(fp.price)
      if (price === null || price < PLAUSIBLE.min || price > PLAUSIBLE.max) {
        excluded.implausiblePrice++
        continue
      }
      const byRegion = (samples[fp.fuel_type] ??= {})
      ;(byRegion[code] ??= []).push(price)
      ;(byRegion.UK ??= []).push(price)
      const t = fp.price_last_updated
      if (t && (!newest || t > newest)) newest = t
    }
  }

  const summarise = (list) =>
    list && list.length >= MIN_SAMPLE ? { median: round1(median(list)), n: list.length } : list ? { median: null, n: list.length } : null

  const uk = {}
  for (const fuel of Object.keys(FUELS)) {
    const s = summarise(samples[fuel]?.UK)
    if (s) uk[fuel] = s
  }
  const byRegion = regions.map((r) => {
    const out = {}
    for (const fuel of Object.keys(FUELS)) {
      const s = summarise(samples[fuel]?.[r.code])
      if (s) out[fuel] = s
    }
    return { code: r.code, name: r.name, fullName: r.fullName, label: r.label, prices: out }
  })

  return { uk, regions: byRegion, newestPrice: newest, stations: regionOf.size, excluded }
}

/** Today's medians appended to the rolling history, one entry per UTC day. */
function withHistory(previous, today, date) {
  const entry = {
    date,
    uk: Object.fromEntries(Object.entries(today.uk).map(([f, s]) => [f, s.median])),
    regions: Object.fromEntries(
      today.regions.map((r) => [r.code, Object.fromEntries(Object.entries(r.prices).map(([f, s]) => [f, s.median]))]),
    ),
  }
  const kept = (previous ?? []).filter((h) => h.date !== date)
  return [...kept, entry].sort((a, b) => a.date.localeCompare(b.date)).slice(-HISTORY_DAYS)
}

// -------------------------------------------------------------------- main --

async function main() {
  const regions = JSON.parse(await readFile(REGIONS, 'utf8')).regions
  const dumpPath = argValue('--from-dump')

  let stations
  let prices
  if (dumpPath) {
    ;({ stations, prices } = JSON.parse(await readFile(resolve(dumpPath), 'utf8')))
    console.log(`  read ${stations.length} forecourts and ${prices.length} price records from ${dumpPath}`)
  } else {
    const id = process.env.FUEL_FINDER_CLIENT_ID
    const secret = process.env.FUEL_FINDER_CLIENT_SECRET
    if (!id || !secret) {
      console.log('  FUEL_FINDER_CLIENT_ID / FUEL_FINDER_CLIENT_SECRET are not set; skipping. See docs/data.md.')
      return
    }
    const token = await accessToken(id, secret)
    stations = await allBatches('/api/v1/pfs', token)
    await sleep(REQUEST_GAP_MS)
    prices = await allBatches('/api/v1/pfs/fuel-prices', token)
    console.log(`  fetched ${stations.length} forecourts and ${prices.length} price records`)
    if (args.includes('--dump')) {
      // For local debugging only; tmp/ is gitignored. Never commit a dump.
      await mkdir(resolve(ROOT, 'tmp'), { recursive: true })
      await writeFile(resolve(ROOT, 'tmp/fuel-dump.json'), JSON.stringify({ stations, prices }))
    }
  }

  // A thin response is an outage, not a market. Keep yesterday's file instead.
  if (stations.length < 1000 || prices.length < 1000) {
    if (!dumpPath) throw new Error(`only ${stations.length} forecourts / ${prices.length} prices returned; refusing to publish`)
  }

  const today = aggregate(stations, prices, regions)
  let previous = null
  try {
    previous = JSON.parse(await readFile(OUT, 'utf8'))
  } catch {
    // First run.
  }
  const date = new Date().toISOString().slice(0, 10)

  const out = {
    version: 1,
    generatedAt: new Date().toISOString(),
    newestPrice: today.newestPrice,
    source: {
      name: 'Fuel Finder (GOV.UK)',
      url: PORTAL,
      note: 'Median pump price across open forecourts in each ITL1 region. Pence per litre.',
    },
    fuels: FUELS,
    minSample: MIN_SAMPLE,
    stations: today.stations,
    excluded: today.excluded,
    uk: today.uk,
    regions: today.regions,
    history: withHistory(previous?.history, today, date),
  }

  await mkdir(dirname(OUT), { recursive: true })
  await writeFile(OUT, `${JSON.stringify(out)}\n`)

  console.log(`  ${today.stations} open forecourts placed in a region; excluded ${JSON.stringify(today.excluded)}`)
  for (const f of ['E10', 'B7S']) {
    const row = today.regions.map((r) => `${r.code}=${r.prices[f]?.median ?? '-'}`).join(' ')
    console.log(`  ${f}: UK ${today.uk[f]?.median ?? '-'}p | ${row}`)
  }
  console.log(`  wrote ${OUT}`)
}

await main()
