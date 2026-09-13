/**
 * Every car model on UK roads, from the Department for Transport's vehicle
 * licensing statistics.
 *
 * Two data files, joined on make + generic model + model:
 *
 *   VEH0220  licensed vehicles by make, model, fuel type and engine size
 *   VEH0124  licensed vehicles by make, model and year of first use
 *
 * Together they give, for each variant DVLA knows about: its fuel, its engine size
 * band, how many are licensed today, and the span of years in which they were first
 * registered - which is what decides a car's likely Euro standard.
 *
 * What the register cannot tell you, and this therefore does not claim: body shape,
 * trim list, or exact engine capacity (DfT publishes 100 cc bands). Gearbox and
 * all-wheel drive are inferred only where the DVLA model string says so outright
 * ("AUTO", "XDRIVE"); an unmarked string is left unknown, not assumed manual.
 *
 * Year ranges are per DVLA *model name*, because VEH0124 has no fuel or engine
 * column. A model name spanning two engine generations reports the wider span.
 *
 * Contains public sector information licensed under the Open Government Licence v3.0.
 */

import { mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findAttachment, govukContent } from './lib/govuk.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = resolve(ROOT, 'tmp/dft')

export const DFT_PAGE = 'government/statistical-data-sets/vehicle-licensing-statistics-data-files'
const FILES = { fuel: 'df_VEH0220.csv', years: ['df_VEH0124_AM.csv', 'df_VEH0124_NZ.csv'] }

/**
 * Minimum licensed cars for a variant to be listed. At 50 the catalogue covers
 * ~99% of every licensed car in the UK in ~30k variants, and drops the tail of
 * one-off imports and DVLA typos that would otherwise be most of the rows.
 */
export const MIN_ON_ROAD = 50

/** Drop a stray tail year only if it is both tiny and inside the outer 1% of volume. */
const TAIL_MAX_COUNT = 20
const TAIL_SHARE = 0.01

// ---------------------------------------------------------------- download --

/**
 * Fetches a file once and reuses it until the release changes. The URL is stored
 * beside the file, so a new DfT release (new media ID) invalidates the cache even
 * though the filename is identical.
 */
async function cached({ filename, url, bytes }) {
  await mkdir(CACHE, { recursive: true })
  const path = resolve(CACHE, filename)
  const marker = `${path}.url`
  try {
    const [had, s] = await Promise.all([readFile(marker, 'utf8'), stat(path)])
    if (had.trim() === url && (!bytes || s.size === bytes)) return path
  } catch {
    // Not cached yet.
  }
  console.log(`  downloading ${filename}${bytes ? ` (${(bytes / 1e6).toFixed(0)} MB)` : ''}`)
  const res = await fetch(url, { signal: AbortSignal.timeout(600_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (bytes && buf.length !== bytes) throw new Error(`${filename}: expected ${bytes} bytes, got ${buf.length}`)
  await writeFile(path, buf)
  await writeFile(marker, url)
  return path
}

// ------------------------------------------------------------------- parsing --

/**
 * DfT publishes these as Windows-1252, not UTF-8. Decoding as UTF-8 throws on the
 * first accented character; decoding "leniently" silently corrupts it.
 */
const decode = (buf) => new TextDecoder('windows-1252').decode(buf)

/** Splits one CSV line, honouring quotes. These files never embed newlines in a field. */
function splitLine(line) {
  if (!line.includes('"')) return line.split(',')
  const out = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      out.push(field)
      field = ''
    } else field += c
  }
  out.push(field)
  return out
}

/** Calls fn(cells, header) per data row without materialising a million-line array. */
function eachRow(text, fn) {
  let start = 0
  let header = null
  while (start < text.length) {
    let end = text.indexOf('\n', start)
    if (end === -1) end = text.length
    const line = text.slice(start, text[end - 1] === '\r' ? end - 1 : end)
    start = end + 1
    if (!line) continue
    const cells = splitLine(line)
    if (!header) {
      header = Object.fromEntries(cells.map((h, i) => [h.replace(/^\uFEFF/, '').trim(), i]))
      for (const need of ['BodyType', 'Make', 'GenModel', 'Model', 'LicenceStatus']) {
        if (!(need in header)) throw new Error(`missing column ${need} - has DfT changed the file layout?`)
      }
      continue
    }
    fn(cells, header)
  }
  if (!header) throw new Error('file was empty')
}

/** The newest year column, so the build does not need editing each release. */
function latestYearColumn(header) {
  const years = Object.keys(header).filter((k) => /^\d{4}$/.test(k)).map(Number)
  if (!years.length) throw new Error('no year columns in header')
  return String(Math.max(...years))
}

const count = (v) => (/^\d+$/.test(v) ? Number(v) : 0)

// ------------------------------------------------------------- normalising --

const FUEL = {
  PETROL: 'petrol',
  DIESEL: 'diesel',
  GAS: 'lpg',
  'HYBRID ELECTRIC (PETROL)': 'hybrid-petrol',
  'HYBRID ELECTRIC (DIESEL)': 'hybrid-diesel',
  'PLUG-IN HYBRID ELECTRIC (PETROL)': 'phev',
  'PLUG-IN HYBRID ELECTRIC (DIESEL)': 'phev',
  // A range extender is a plug-in with a petrol generator; that is how zones treat it.
  'RANGE EXTENDED ELECTRIC': 'phev',
  'BATTERY ELECTRIC': 'bev',
  // FUEL CELL ELECTRIC and OTHER FUEL TYPES are deliberately absent: the app has no
  // category that describes them honestly, and together they are well under 0.01%
  // of cars. Unmapped fuels are skipped and counted, not guessed.
}

/** Makes DVLA spells in a way no owner would. Everything else is title-cased. */
const MAKE_NAMES = {
  BMW: 'BMW',
  MG: 'MG',
  DS: 'DS',
  BYD: 'BYD',
  MINI: 'MINI',
  SEAT: 'SEAT',
  KGM: 'KGM',
  LEVC: 'LEVC',
  GWM: 'GWM',
  MERCEDES: 'Mercedes-Benz',
  'ROLLS ROYCE': 'Rolls-Royce',
  'ALFA ROMEO': 'Alfa Romeo',
  'LAND ROVER': 'Land Rover',
  'ASTON MARTIN': 'Aston Martin',
  CITROEN: 'Citroen',
  SKODA: 'Skoda',
  SSANGYONG: 'SsangYong',
}

/**
 * Short tokens in DVLA model names are nearly always codes - AMG, GTI, EQC, XC, iX,
 * RS - so they stay as written. These are the exceptions that are real words.
 */
const SHORT_WORDS = new Set(['ONE', 'AIR', 'MAX', 'VAN', 'CAB', 'NEW', 'BUS', 'SKY', 'ZOE', 'KA', 'UP', 'EOS', 'ION', 'ACE', 'ZED'])

const titleWord = (w) =>
  /\d/.test(w) || (w.length <= 3 && !SHORT_WORDS.has(w)) ? w : w[0] + w.slice(1).toLowerCase()
const titleCase = (s) => s.split(/(\s+|-)/).map((w) => (/\w/.test(w) ? titleWord(w) : w)).join('')

const prettyMake = (m) => MAKE_NAMES[m] ?? titleCase(m)

/** "FORD FIESTA" under make FORD -> "Fiesta". */
const prettyModel = (make, genModel) =>
  titleCase(genModel.startsWith(`${make} `) ? genModel.slice(make.length + 1) : genModel)

/**
 * DVLA truncates model strings to ~30 characters, and a lone trailing "A" is how the
 * truncated ones mark an automatic: "RANGE ROVER SPORT HSE SDV6 A".
 */
const AUTOMATIC = /\b(AUTO|AUT|AUTOMATIC|DSG|CVT|S TRONIC|STRONIC|STEPTRONIC|TIPTRONIC|POWERSHIFT|EDC|EAT\d?|DCT|PDK)\b| A$/
/** BMW fuses xDrive to the engine code ("XDRIVE20D"), so it is matched as a prefix. */
const ALL_WHEEL = /\bXDRIVE|\b(4X4|4WD|AWD|QUATTRO|4MOTION|ALL4|4MATIC|ALLGRIP|4XE)\b/

/** 1400 -> "1301-1400cc". DfT's bucket is the 100 cc band ending at that figure. */
function engineBand(simple) {
  const top = Number(simple)
  if (!Number.isFinite(top) || top <= 0) return null
  return top <= 100 ? 'up to 100cc' : `${top - 99}-${top}cc`
}

/** First and last registration year, ignoring a scattering of mis-keyed outliers. */
export function yearSpan(byYear) {
  const years = [...byYear.entries()].filter(([, n]) => n > 0).sort((a, b) => a[0] - b[0])
  if (!years.length) return [null, null]
  const total = years.reduce((n, [, c]) => n + c, 0)

  let lo = 0
  let seen = 0
  while (lo < years.length - 1 && years[lo][1] < TAIL_MAX_COUNT && (seen + years[lo][1]) / total < TAIL_SHARE) {
    seen += years[lo][1]
    lo++
  }
  let hi = years.length - 1
  seen = 0
  while (hi > lo && years[hi][1] < TAIL_MAX_COUNT && (seen + years[hi][1]) / total < TAIL_SHARE) {
    seen += years[hi][1]
    hi--
  }
  return [years[lo][0], years[hi][0]]
}

// --------------------------------------------------------------------- build --

/** Release metadata only - cheap, no download. Used by the freshness check. */
export async function dftRelease() {
  const page = await govukContent(DFT_PAGE)
  return {
    page: `https://www.gov.uk/${DFT_PAGE}`,
    updatedAt: page.public_updated_at,
    files: [findAttachment(page, FILES.fuel), ...FILES.years.map((f) => findAttachment(page, f))],
  }
}

export async function dftVehicleRows() {
  const release = await dftRelease()
  const [fuelFile, ...yearFiles] = release.files
  const fuelPath = await cached(fuelFile)
  const yearPaths = []
  for (const f of yearFiles) yearPaths.push(await cached(f))

  // Registration years per model name.
  const years = new Map()
  for (const p of yearPaths) {
    let latest
    eachRow(decode(await readFile(p)), (c, h) => {
      latest ??= latestYearColumn(h)
      if (c[h.BodyType] !== 'Cars' || c[h.LicenceStatus] !== 'Licensed') return
      const y = c[h.YearFirstUsed]
      if (!/^\d{4}$/.test(y)) return
      const key = `${c[h.Make]}|${c[h.GenModel]}|${c[h.Model]}`
      let m = years.get(key)
      if (!m) years.set(key, (m = new Map()))
      m.set(Number(y), (m.get(Number(y)) ?? 0) + count(c[h[latest]]))
    })
  }

  // Variants with fuel and engine band.
  const variants = new Map()
  const skipped = { unmappedFuel: 0, modelMissing: 0 }
  let asOf
  eachRow(decode(await readFile(fuelPath)), (c, h) => {
    asOf ??= latestYearColumn(h)
    if (c[h.BodyType] !== 'Cars' || c[h.LicenceStatus] !== 'Licensed') return
    const fuel = FUEL[c[h.Fuel]]
    if (!fuel) return void skipped.unmappedFuel++
    if (/MODEL MISSING/.test(c[h.GenModel]) || /MODEL MISSING/.test(c[h.Model])) return void skipped.modelMissing++
    const key = [c[h.Make], c[h.GenModel], c[h.Model], fuel, c[h.EngineSizeSimple]].join('|')
    const n = count(c[h[asOf]])
    const v = variants.get(key)
    if (v) v.onRoad += n
    else
      variants.set(key, {
        make: c[h.Make],
        genModel: c[h.GenModel],
        model: c[h.Model],
        fuel,
        engine: c[h.EngineSizeSimple],
        onRoad: n,
      })
  })

  const rows = []
  let noYears = 0
  for (const v of variants.values()) {
    if (v.onRoad < MIN_ON_ROAD) continue
    const span = years.get(`${v.make}|${v.genModel}|${v.model}`)
    const [yearFrom, yearTo] = span ? yearSpan(span) : [null, null]
    if (yearFrom === null) noYears++
    rows.push({
      make: prettyMake(v.make),
      model: prettyModel(v.make, v.genModel),
      variant: v.model,
      generation: null,
      yearFrom,
      yearTo,
      body: null,
      fuel: v.fuel,
      engine: engineBand(v.engine),
      engineCc: null,
      gearbox: AUTOMATIC.test(v.model) ? 'automatic' : null,
      transmission: null,
      drivetrain: ALL_WHEEL.test(v.model) ? 'awd' : null,
      trims: [],
      onRoad: v.onRoad,
      provenance: 'dft',
    })
  }
  rows.sort((a, b) => b.onRoad - a.onRoad)

  return {
    rows,
    meta: {
      title: 'DfT vehicle licensing statistics (VEH0220, VEH0124)',
      page: release.page,
      releaseUpdatedAt: release.updatedAt,
      onRoadAsOf: `end of ${asOf}`,
      minOnRoad: MIN_ON_ROAD,
      files: release.files,
      licence: 'Open Government Licence v3.0',
      skipped: { ...skipped, withoutYearRange: noYears },
    },
  }
}
