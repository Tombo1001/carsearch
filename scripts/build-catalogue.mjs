/**
 * Builds public/data/catalogue.json.
 *
 *   npm run data:catalogue
 *
 * Two inputs, merged:
 *   1. scripts/catalogue-seed.mjs  - hand-written UK models/generations/trims.
 *   2. data/manual/*.csv           - anything you drop in yourself.
 *
 * The CSV reader is deliberately forgiving about column names so it can eat a VCA
 * "car fuel data" export, a spec sheet you assembled, or a scrape, without you
 * having to reshape it first. See docs/catalogue-import.md for the columns it looks
 * for. Unknown columns are kept verbatim under `extra`.
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, basename } from 'node:path'
import { SEED_MODELS } from './catalogue-seed.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MANUAL_DIR = resolve(ROOT, 'data/manual')
const OUT = resolve(ROOT, 'public/data/catalogue.json')

// ------------------------------------------------------------ seed expand --

/** One row per body x powertrain x transmission. */
function expandSeed() {
  const rows = []
  for (const m of SEED_MODELS) {
    for (const body of m.bodies) {
      for (const pt of m.powertrains) {
        for (const tx of pt.transmissions) {
          rows.push({
            id: slug(m.make, m.model, m.generation, body, pt.engine, tx.label),
            make: m.make,
            model: m.model,
            generation: m.generation ?? null,
            yearFrom: m.yearFrom ?? null,
            yearTo: m.yearTo ?? null,
            body,
            fuel: pt.fuel,
            engine: pt.engine,
            engineCc: pt.cc ?? null,
            gearbox: tx.gearbox,
            gears: tx.gears,
            transmission: tx.label,
            drivetrain: pt.drivetrain,
            trims: m.trims ?? [],
            provenance: 'seed',
          })
        }
      }
    }
  }
  return rows
}

const slug = (...parts) =>
  parts
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

// -------------------------------------------------------------- csv input --

/** Minimal RFC 4180 reader: handles quotes, escaped quotes and embedded newlines. */
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
      continue
    }
    if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      // Skip blank lines rather than emitting empty rows.
      if (row.some((v) => v.trim() !== '')) rows.push(row)
      row = []
    } else field += c
  }
  row.push(field)
  if (row.some((v) => v.trim() !== '')) rows.push(row)

  if (!rows.length) return []
  const header = rows[0].map((h) => h.trim())
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])))
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Finds the first column whose normalised name matches any candidate. */
function pick(record, candidates) {
  const keys = Object.keys(record)
  for (const cand of candidates) {
    const want = norm(cand)
    const hit = keys.find((k) => norm(k) === want)
    if (hit && record[hit] !== '') return record[hit]
  }
  // Fall back to a substring match, which catches things like
  // "Engine Capacity (cc)" or "Transmission Type".
  for (const cand of candidates) {
    const want = norm(cand)
    const hit = keys.find((k) => norm(k).includes(want))
    if (hit && record[hit] !== '') return record[hit]
  }
  return ''
}

const FUEL_MAP = [
  [/electric|^ev$|^bev$/i, 'bev'],
  [/plug.?in|phev/i, 'phev'],
  [/diesel.*(hybrid|electric)|(hybrid|electric).*diesel/i, 'hybrid-diesel'],
  [/petrol.*(hybrid|electric)|(hybrid|electric).*petrol|^hybrid$/i, 'hybrid-petrol'],
  [/lpg|cng|bi.?fuel/i, 'lpg'],
  [/diesel/i, 'diesel'],
  [/petrol|gasoline/i, 'petrol'],
]

function mapFuel(raw) {
  for (const [re, out] of FUEL_MAP) if (re.test(raw)) return out
  return raw ? 'petrol' : ''
}

/**
 * Decodes a transmission cell. Handles plain English ("6-speed manual") and the
 * VCA shorthand, where the letter is the type and the digit is the gear count:
 * M6 manual, A6 automatic, D7 dual clutch, AV a CVT.
 */
function mapTransmission(raw) {
  if (!raw) return { gearbox: '', gears: null, transmission: '' }
  const s = raw.trim()

  const code = s.match(/^([MADS]|AV|AMT)\s*-?\s*(\d+)?$/i)
  if (code) {
    const letter = code[1].toUpperCase()
    const gears = code[2] ? Number(code[2]) : null
    const gearbox =
      letter === 'M' ? 'manual' : letter === 'D' ? 'dual-clutch' : letter === 'AV' ? 'cvt' : letter === 'AMT' ? 'automated-manual' : 'automatic'
    return { gearbox, gears, transmission: gears ? `${gears}-speed ${gearbox}` : gearbox }
  }

  const gears = Number(s.match(/(\d+)\s*[- ]?\s*speed/i)?.[1] ?? s.match(/^(\d+)/)?.[1] ?? '') || null
  const gearbox = /cvt|e-?cvt|variable/i.test(s)
    ? 'cvt'
    : /dual.?clutch|dsg|dct|pdk|s.?tronic|powershift/i.test(s)
      ? 'dual-clutch'
      : /single.?speed|reduction/i.test(s)
        ? 'single-speed'
        : /auto/i.test(s)
          ? 'automatic'
          : /manual/i.test(s)
            ? 'manual'
            : ''
  return { gearbox, gears, transmission: s }
}

function mapDrivetrain(raw) {
  if (!raw) return ''
  if (/4wd|awd|4x4|quattro|xdrive|4motion|all.?wheel/i.test(raw)) return 'awd'
  if (/rwd|rear.?wheel/i.test(raw)) return 'rwd'
  if (/fwd|front.?wheel/i.test(raw)) return 'fwd'
  return ''
}

function mapBody(raw) {
  if (!raw) return ''
  const s = raw.toLowerCase()
  for (const [re, out] of [
    [/estate|tourer|touring|avant|sportbrake|wagon/, 'estate'],
    [/hatch/, 'hatchback'],
    [/saloon|sedan/, 'saloon'],
    [/coupe|coup/, 'coupe'],
    [/convertible|cabrio|roadster|spider|spyder/, 'convertible'],
    [/mpv|people.?carrier|tourer/, 'mpv'],
    [/suv|crossover|4x4/, 'suv'],
    [/pick.?up|truck/, 'pickup'],
    [/van/, 'van'],
  ]) {
    if (re.test(s)) return out
  }
  return s
}

const KNOWN_COLUMNS = new Set(
  [
    'manufacturer', 'make', 'brand', 'model', 'generation', 'variant', 'description', 'trim', 'trimlevel',
    'derivative', 'year', 'yearfrom', 'yearto', 'body', 'bodystyle', 'bodytype', 'shape', 'fuel', 'fueltype',
    'engine', 'enginecapacity', 'enginesize', 'cc', 'transmission', 'gearbox', 'drivetrain', 'drive',
    'driventhrough', 'wheeldrive', 'power', 'bhp', 'ps', 'kw', 'co2', 'euro', 'eurostandard', 'emissions',
  ].map(norm),
)

function rowFromCsv(record, sourceName) {
  const make = pick(record, ['manufacturer', 'make', 'brand'])
  const model = pick(record, ['model'])
  if (!make || !model) return null

  const description = pick(record, ['description', 'variant', 'derivative'])
  const trim = pick(record, ['trim level', 'trim', 'grade'])
  const tx = mapTransmission(pick(record, ['transmission', 'gearbox']))
  const ccRaw = pick(record, ['engine capacity', 'engine size', 'cc', 'displacement'])
  const yearRaw = pick(record, ['year from', 'year', 'model year'])

  const extra = {}
  for (const [k, v] of Object.entries(record)) {
    if (v !== '' && !KNOWN_COLUMNS.has(norm(k))) extra[k] = v
  }

  return {
    id: slug(make, model, description || trim, tx.transmission, sourceName),
    make,
    model,
    generation: pick(record, ['generation']) || null,
    yearFrom: Number(yearRaw.match(/\d{4}/)?.[0] ?? '') || null,
    yearTo: Number(pick(record, ['year to']).match(/\d{4}/)?.[0] ?? '') || null,
    body: mapBody(pick(record, ['body style', 'body type', 'body', 'shape'])),
    fuel: mapFuel(pick(record, ['fuel type', 'fuel'])),
    engine: description || pick(record, ['engine']) || '',
    engineCc: Number(ccRaw.replace(/[^\d]/g, '')) || null,
    gearbox: tx.gearbox,
    gears: tx.gears,
    transmission: tx.transmission,
    drivetrain: mapDrivetrain(pick(record, ['drivetrain', 'drive', 'driven through', 'wheel drive'])),
    euro: pick(record, ['euro standard', 'euro', 'emissions standard']) || null,
    co2: Number(pick(record, ['co2', 'co2 g/km']).replace(/[^\d.]/g, '')) || null,
    power: pick(record, ['power', 'bhp', 'ps', 'kw']) || null,
    trims: trim ? [trim] : [],
    provenance: `csv:${sourceName}`,
    extra: Object.keys(extra).length ? extra : undefined,
  }
}

async function readManualCsvs() {
  let names = []
  try {
    names = (await readdir(MANUAL_DIR)).filter((n) => n.toLowerCase().endsWith('.csv'))
  } catch {
    return { rows: [], files: [] }
  }

  const rows = []
  const files = []
  for (const name of names) {
    const text = await readFile(resolve(MANUAL_DIR, name), 'utf8')
    const records = parseCsv(text.replace(/^﻿/, ''))
    let kept = 0
    for (const rec of records) {
      const row = rowFromCsv(rec, basename(name, '.csv'))
      if (row) {
        rows.push(row)
        kept++
      }
    }
    files.push({ name, records: records.length, kept })
    console.log(`  ${name}: ${records.length} record(s), ${kept} usable`)
  }
  return { rows, files }
}

// ------------------------------------------------------------------- main --

function facetsOf(rows) {
  const collect = (fn) => [...new Set(rows.flatMap(fn).filter(Boolean))].sort()
  return {
    makes: collect((r) => [r.make]),
    bodies: collect((r) => [r.body]),
    fuels: collect((r) => [r.fuel]),
    gearboxes: collect((r) => [r.gearbox]),
    drivetrains: collect((r) => [r.drivetrain]),
  }
}

async function build() {
  const seed = expandSeed()
  console.log(`  seed: ${SEED_MODELS.length} models -> ${seed.length} variant rows`)

  const { rows: manual, files } = await readManualCsvs()
  if (!files.length) console.log('  data/manual: no CSVs found (seed only)')

  const rows = [...seed, ...manual]
  const seen = new Set()
  const deduped = rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))

  const out = {
    generatedAt: new Date().toISOString(),
    counts: { total: deduped.length, seed: seed.length, imported: manual.length },
    sources: files,
    facets: facetsOf(deduped),
    rows: deduped,
  }

  await mkdir(dirname(OUT), { recursive: true })
  await writeFile(OUT, JSON.stringify(out))
  console.log(
    `\n  wrote ${OUT}\n  ${deduped.length} rows across ${out.facets.makes.length} makes ` +
      `(${(Buffer.byteLength(JSON.stringify(out)) / 1024).toFixed(0)} kB)`,
  )
}

await build()
