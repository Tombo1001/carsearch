/**
 * Builds public/data/zones.json from the registry in zone-sources.mjs.
 *
 *   npm run data:zones
 *
 * Fetches each boundary from its official source, reprojects to WGS84, simplifies
 * it enough to be cheap in the browser, and writes one flat file the app loads.
 *
 * Failures are loud and are recorded in the output rather than papered over: a
 * missing zone is far better than a made-up one, because the whole point of this
 * app is deciding where you can and cannot drive.
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import proj4 from 'proj4'
import { ZONE_SOURCES, PROPOSED_ZONE_SOURCES, CHARGES_AS_OF } from './zone-sources.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'public/data/zones.json')

/** Simplification tolerance. ~15 m is below consumer GPS noise, so it costs no real accuracy. */
const SIMPLIFY_METRES = 15
const TIMEOUT_MS = 90_000

proj4.defs(
  'EPSG:27700',
  '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 ' +
    '+ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs',
)

// ---------------------------------------------------------------- fetching --

async function getJson(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`response was not JSON (starts with: ${text.slice(0, 80).replace(/\s+/g, ' ')})`)
  }
}

async function fetchArcgis(url) {
  const q = `${url}/query?where=1%3D1&outFields=*&f=geojson`
  const fc = await getJson(q)
  if (fc.error) throw new Error(`ArcGIS error: ${JSON.stringify(fc.error).slice(0, 160)}`)
  if (!fc.features?.length) throw new Error('ArcGIS returned zero features')
  return fc
}

async function fetchGeojson(url, epsg) {
  const fc = await getJson(url)
  if (!fc.features?.length) throw new Error('GeoJSON had zero features')
  return epsg && epsg !== 4326 ? reproject(fc, `EPSG:${epsg}`) : fc
}

function reproject(fc, from) {
  const to4326 = (pt) => {
    const [x, y] = proj4(from, 'EPSG:4326', [pt[0], pt[1]])
    return [round(x, 6), round(y, 6)]
  }
  return {
    ...fc,
    features: fc.features.map((f) => ({ ...f, geometry: mapCoords(f.geometry, to4326) })),
  }
}

/** Builds an approximate circle. Only ever used for zones flagged precision:'approximate'. */
function disc([lon, lat], radiusKm, steps = 128) {
  const ring = []
  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * 2 * Math.PI
    const dLat = (radiusKm / 111.32) * Math.cos(theta)
    const dLon = ((radiusKm / 111.32) * Math.sin(theta)) / Math.cos((lat * Math.PI) / 180)
    ring.push([round(lon + dLon, 6), round(lat + dLat, 6)])
  }
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }] }
}

// ------------------------------------------------------------- geometry ops --

const round = (n, dp) => Number(n.toFixed(dp))

function mapCoords(geometry, fn) {
  const walk = (c, depth) => (depth === 0 ? fn(c) : c.map((x) => walk(x, depth - 1)))
  const depth = { Point: 0, LineString: 1, MultiLineString: 2, Polygon: 2, MultiPolygon: 3 }[geometry.type]
  if (depth === undefined) throw new Error(`unsupported geometry type ${geometry.type}`)
  return { ...geometry, coordinates: walk(geometry.coordinates, depth) }
}

/** Collapses a FeatureCollection of (Multi)Polygons into one MultiPolygon coordinate array. */
function toMultiPolygon(fc) {
  const polys = []
  for (const f of fc.features) {
    const g = f.geometry
    if (!g) continue
    if (g.type === 'Polygon') polys.push(g.coordinates)
    else if (g.type === 'MultiPolygon') polys.push(...g.coordinates)
    // Anything else (points, lines) is not a zone area and is dropped.
  }
  if (!polys.length) throw new Error('no polygon geometry in source')
  return polys
}

/** Douglas-Peucker on a ring, with tolerance given in degrees. */
function simplifyRing(ring, tol) {
  if (ring.length <= 4) return ring
  const sqTol = tol * tol
  const keep = new Uint8Array(ring.length)
  keep[0] = keep[ring.length - 1] = 1
  const stack = [[0, ring.length - 1]]

  while (stack.length) {
    const [first, last] = stack.pop()
    let maxSq = 0
    let index = -1
    for (let i = first + 1; i < last; i++) {
      const sq = sqSegDist(ring[i], ring[first], ring[last])
      if (sq > maxSq) {
        maxSq = sq
        index = i
      }
    }
    if (maxSq > sqTol && index > 0) {
      keep[index] = 1
      stack.push([first, index], [index, last])
    }
  }

  const out = ring.filter((_, i) => keep[i])
  // A ring needs at least 4 positions (first === last). If we over-simplified, keep the original.
  return out.length >= 4 ? out : ring
}

function sqSegDist(p, a, b) {
  let [x, y] = a
  let dx = b[0] - x
  let dy = b[1] - y
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy)
    if (t > 1) [x, y] = b
    else if (t > 0) {
      x += dx * t
      y += dy * t
    }
  }
  dx = p[0] - x
  dy = p[1] - y
  return dx * dx + dy * dy
}

function simplifyMultiPolygon(polys, metres) {
  // At UK latitudes a degree of longitude is ~65 km and of latitude ~111 km. Using the
  // smaller figure keeps the tolerance conservative in both axes.
  const tol = metres / 111_320
  return polys.map((rings) => rings.map((ring) => simplifyRing(ring, tol)))
}

function bboxOf(polys) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const rings of polys)
    for (const ring of rings)
      for (const [x, y] of ring) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
  return [minX, minY, maxX, maxY]
}

const countPositions = (polys) => polys.reduce((n, rings) => n + rings.reduce((m, r) => m + r.length, 0), 0)

// ------------------------------------------------------------------- main --

async function resolveGeometry(src, built) {
  const g = src.geometry
  switch (g.kind) {
    case 'arcgis':
      return fetchArcgis(g.url)
    case 'geojson':
      return fetchGeojson(g.url, g.epsg)
    case 'disc':
      return disc(g.centre, g.radiusKm)
    case 'sameAs': {
      const other = built.get(g.zoneId)
      if (!other) throw new Error(`sameAs target '${g.zoneId}' has not been built (it must appear earlier, and must have succeeded)`)
      return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: other.geometry } }] }
    }
    default:
      throw new Error(`unknown geometry kind '${g.kind}'`)
  }
}

async function build() {
  const sources = [...ZONE_SOURCES, ...PROPOSED_ZONE_SOURCES]
  const built = new Map()
  const failures = []

  for (const src of sources) {
    const label = `${src.id.padEnd(24)}`
    try {
      const fc = await resolveGeometry(src, built)
      const raw = toMultiPolygon(fc)
      const before = countPositions(raw)
      const polys = simplifyMultiPolygon(raw, SIMPLIFY_METRES)
      const after = countPositions(polys)

      const { geometry, ...meta } = src
      built.set(src.id, {
        ...meta,
        bbox: bboxOf(polys),
        geometry: polys,
      })
      console.log(
        `  ok   ${label} ${String(polys.length).padStart(3)} polygon(s), ` +
          `${before} -> ${after} points (${src.precision})`,
      )
    } catch (err) {
      failures.push({ id: src.id, name: src.name, error: String(err.message || err) })
      console.error(`  FAIL ${label} ${err.message || err}`)
    }
  }

  const out = {
    generatedAt: new Date().toISOString(),
    chargesAsOf: CHARGES_AS_OF,
    simplifiedToMetres: SIMPLIFY_METRES,
    zones: [...built.values()],
    failures,
  }

  await mkdir(dirname(OUT), { recursive: true })
  await writeFile(OUT, JSON.stringify(out))

  const bytes = Buffer.byteLength(JSON.stringify(out))
  console.log(`\n  wrote ${OUT}`)
  console.log(`  ${out.zones.length} zones, ${failures.length} failed, ${(bytes / 1024).toFixed(0)} kB`)

  if (failures.length) {
    console.error(
      `\n  ${failures.length} source(s) could not be fetched. The app will show a warning for these\n` +
        `  rather than guessing at a boundary. Re-run to retry; if a URL has moved, fix it in\n` +
        `  scripts/zone-sources.mjs.`,
    )
  }
}

await build()
