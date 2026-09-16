/**
 * Builds public/data/regions.json: the UK's 12 ITL1 statistical regions.
 *
 *   npm run data:regions
 *
 * Source: ONS Open Geography Portal, "International Territorial Level 1 (January
 * 2025) Boundaries UK BUC" - the ultra-generalised cut, which is plenty for
 * deciding which region a forecourt is in and for drawing a faint outline.
 * Contains OS data (c) Crown copyright and database right; Open Government Licence v3.0.
 *
 * Regions change rarely (the 2025 set replaced 2021), so this is run by hand when
 * ONS publishes a new edition, not on a schedule.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { politeFetch } from './lib/polite-fetch.mjs'
import { bboxOf, countPositions, simplifyMultiPolygon, toMultiPolygon } from './lib/geometry.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'public/data/regions.json')

export const REGIONS_LAYER =
  'https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/ITL1_JAN_2025_UK_BUC/FeatureServer/0'

/**
 * Coarser than the zones' 15 m on purpose. The outline is decoration and the
 * point-in-polygon test only has to be right for forecourts, which are not
 * clustered on regional borders.
 */
const SIMPLIFY_METRES = 250

/** Shorter names for the map label; the full ONS name is kept for tooltips. */
const SHORT = {
  TLC: 'North East',
  TLD: 'North West',
  TLE: 'Yorkshire & Humber',
  TLF: 'East Midlands',
  TLG: 'West Midlands',
  TLH: 'East of England',
  TLI: 'London',
  TLJ: 'South East',
  TLK: 'South West',
  TLL: 'Wales',
  TLM: 'Scotland',
  TLN: 'Northern Ireland',
}

const r5 = (n) => Math.round(n * 1e5) / 1e5

const res = await politeFetch(`${REGIONS_LAYER}/query?where=1%3D1&outFields=ITL125CD,ITL125NM,LAT,LONG&f=geojson`, {
  timeoutMs: 120_000,
  headers: { accept: 'application/json' },
})
if (!res.ok) throw new Error(`ONS returned HTTP ${res.status}`)
const fc = await res.json()
if (fc.features?.length !== 12) throw new Error(`expected 12 ITL1 regions, got ${fc.features?.length}`)

const regions = fc.features
  .map((f) => {
    const p = f.properties
    const raw = toMultiPolygon({ features: [f] })
    const geometry = simplifyMultiPolygon(raw, SIMPLIFY_METRES).map((poly) =>
      poly.map((ring) => ring.map(([x, y]) => [r5(x), r5(y)])),
    )
    console.log(`  ${p.ITL125CD} ${p.ITL125NM.padEnd(26)} ${countPositions(raw)} -> ${countPositions(geometry)} points`)
    return {
      code: p.ITL125CD,
      name: SHORT[p.ITL125CD] ?? p.ITL125NM,
      fullName: p.ITL125NM,
      // ONS's own label point for the region.
      label: [r5(p.LONG), r5(p.LAT)],
      bbox: bboxOf(geometry),
      geometry,
    }
  })
  .sort((a, b) => a.code.localeCompare(b.code))

const out = {
  generatedAt: new Date().toISOString(),
  source: {
    name: 'ONS - International Territorial Level 1 (January 2025) Boundaries UK BUC',
    url: REGIONS_LAYER.replace('/FeatureServer/0', ''),
    licence: 'Open Government Licence v3.0. Contains OS data (c) Crown copyright and database right.',
  },
  simplifiedToMetres: SIMPLIFY_METRES,
  regions,
}

const json = JSON.stringify(out)
await mkdir(dirname(OUT), { recursive: true })
await writeFile(OUT, json)
console.log(`\n  wrote ${OUT} (${(Buffer.byteLength(json) / 1024).toFixed(0)} kB)`)
