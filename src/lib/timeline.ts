/**
 * Parses Google location exports into plain positions.
 *
 * Google has shipped three shapes over the years and which one you have depends on
 * when and how you exported, so all three are supported:
 *
 *  1. `records`                    Records.json from Takeout. Raw GPS pings, no activity type.
 *  2. `semantic-location-history`  Takeout monthly files (2021_JANUARY.json). Has activity types.
 *  3. `phone-timeline`             The current on-device export. Has activity types.
 *
 * Since late 2024 Timeline lives on the phone and Takeout no longer offers it, so
 * most people exporting today land on format 3. Older archives are still format 1 or 2.
 *
 * Everything here is pure and runs in the browser. Your location data is never uploaded.
 */

import type { ParsedTimeline, Segment, TimelineFormat, TrackPoint, TravelMode } from './types'

const E7 = 1e7

/** Activity labels that mean "you were the one driving a car or bike". */
const DRIVING = new Set([
  'in passenger vehicle',
  'in vehicle',
  'driving',
  'motorcycling',
  'in taxi',
])

function classify(rawMode: string | undefined): { mode: TravelMode; rawMode?: string } {
  if (!rawMode) return { mode: 'unknown' }
  const norm = rawMode.toLowerCase().replace(/_/g, ' ').trim()
  return { mode: DRIVING.has(norm) ? 'driving' : 'other', rawMode }
}

// ------------------------------------------------------------- primitives --

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : null
}

function parseTime(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    // Pure digits means epoch milliseconds (timestampMs), otherwise ISO 8601.
    if (/^\d+$/.test(v)) return Number(v)
    const t = Date.parse(v)
    return Number.isNaN(t) ? null : t
  }
  return null
}

/**
 * Reads the phone export's position strings, which look like
 * `"51.5074°, -0.1278°"` or occasionally `"geo:51.5074,-0.1278"`.
 */
function parseLatLngString(s: unknown): TrackPoint | null {
  if (typeof s !== 'string') return null
  const m = s.match(/(-?\d+(?:\.\d+)?)\s*[^\d\-,]*\s*,\s*(-?\d+(?:\.\d+)?)/)
  if (!m) return null
  const lat = Number(m[1])
  const lon = Number(m[2])
  return validPoint(lat, lon) ? { lat, lon, t: 0 } : null
}

/**
 * How far to follow nested `location` / `latLng` / `placeLocation` wrappers.
 *
 * Google nests these two or three deep at most. The cap exists because the input is
 * a file a stranger on the internet may have handed the user: a JSON document that
 * nests `location` a million times would otherwise blow the stack and take the tab
 * with it. Six is generous for real exports and harmless for hostile ones.
 */
const MAX_LOCATION_DEPTH = 6

/**
 * Accepts any of the E7 spellings Google has used, plus plain degrees, plus a bare
 * `"51.5074°, -0.1278°"` string.
 *
 * That last case is not an edge case: in the current on-device export a
 * `timelinePath` node is `{ "point": "51.5074°, -0.1278°", "time": ... }`, so the
 * position arrives here as a string rather than an object. Rejecting strings
 * silently drops every movement trace in the format the app tells people to export.
 */
function parseLocationObject(o: any, depth = 0): TrackPoint | null {
  if (typeof o === 'string') return parseLatLngString(o)
  if (!o || typeof o !== 'object' || depth > MAX_LOCATION_DEPTH) return null
  if (typeof o.latLng === 'string') return parseLatLngString(o.latLng)
  if (o.latLng && typeof o.latLng === 'object') return parseLocationObject(o.latLng, depth + 1)
  if (o.placeLocation) return parseLocationObject(o.placeLocation, depth + 1)
  if (o.location) return parseLocationObject(o.location, depth + 1)

  const latE7 = num(o.latitudeE7 ?? o.latE7)
  const lonE7 = num(o.longitudeE7 ?? o.lngE7 ?? o.longE7)
  if (latE7 !== null && lonE7 !== null) {
    const lat = latE7 / E7
    const lon = lonE7 / E7
    return validPoint(lat, lon) ? { lat, lon, t: 0 } : null
  }

  const lat = num(o.latitude ?? o.lat)
  const lon = num(o.longitude ?? o.lng ?? o.lon)
  if (lat !== null && lon !== null && validPoint(lat, lon)) return { lat, lon, t: 0 }
  return null
}

const validPoint = (lat: number, lon: number) =>
  Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0)

// ---------------------------------------------------------------- formats --

function detect(root: any): TimelineFormat {
  if (!root || typeof root !== 'object') return 'unknown'
  if (Array.isArray(root.locations)) return 'records'
  if (Array.isArray(root.timelineObjects)) return 'semantic-location-history'
  if (Array.isArray(root.semanticSegments)) return 'phone-timeline'
  if (Array.isArray(root)) {
    const first = root[0]
    if (first?.timelinePath || first?.visit || first?.activity) return 'phone-timeline'
    if (first?.activitySegment || first?.placeVisit) return 'semantic-location-history'
    if (first?.latitudeE7 !== undefined) return 'records'
  }
  return 'unknown'
}

/**
 * Format 1. One long stream of pings with no activity information, so it becomes a
 * single segment of mode 'unknown' and the caller has to test everything.
 */
function parseRecords(root: any, warnings: string[]): Segment[] {
  const raw: any[] = Array.isArray(root) ? root : root.locations
  const points: TrackPoint[] = []
  let dropped = 0

  for (const r of raw) {
    const p = parseLocationObject(r)
    const t = parseTime(r?.timestampMs ?? r?.timestamp ?? r?.timestampS)
    if (!p || t === null) {
      dropped++
      continue
    }
    points.push({ ...p, t })
  }

  if (dropped) warnings.push(`Skipped ${dropped.toLocaleString()} record(s) with no usable position or time.`)
  points.sort((a, b) => a.t - b.t)
  return points.length ? [{ points, mode: 'unknown' }] : []
}

/** Format 2. Activity segments carry a real travel mode, which is what we want. */
function parseSemanticLocationHistory(root: any, warnings: string[]): Segment[] {
  const objects: any[] = Array.isArray(root) ? root : root.timelineObjects
  const segments: Segment[] = []
  let visits = 0

  for (const o of objects) {
    const seg = o?.activitySegment
    if (seg) {
      const { mode, rawMode } = classify(seg.activityType)
      const startT = parseTime(seg.duration?.startTimestamp ?? seg.duration?.startTimestampMs)
      const endT = parseTime(seg.duration?.endTimestamp ?? seg.duration?.endTimestampMs)
      const points: TrackPoint[] = []

      // simplifiedRawPath is the best available trace; waypointPath is the snapped
      // route; start/end are the fallback when neither is present.
      const rawPath: any[] = seg.simplifiedRawPath?.points ?? []
      for (const pt of rawPath) {
        const p = parseLocationObject(pt)
        if (p) points.push({ ...p, t: parseTime(pt.timestamp ?? pt.timestampMs) ?? startT ?? 0 })
      }
      if (!points.length) {
        const waypoints: any[] = seg.waypointPath?.waypoints ?? []
        for (const pt of waypoints) {
          const p = parseLocationObject(pt)
          if (p) points.push({ ...p, t: startT ?? 0 })
        }
      }
      if (!points.length) {
        const a = parseLocationObject(seg.startLocation)
        const b = parseLocationObject(seg.endLocation)
        if (a) points.push({ ...a, t: startT ?? 0 })
        if (b) points.push({ ...b, t: endT ?? startT ?? 0 })
      }

      // Waypoints often carry no time of their own; spread them across the segment
      // so that per-day attribution still works.
      if (points.length > 1 && startT !== null && endT !== null && endT > startT) {
        const anyMissing = points.some((p) => !p.t)
        if (anyMissing) {
          for (let i = 0; i < points.length; i++) {
            if (!points[i].t) points[i].t = startT + ((endT - startT) * i) / (points.length - 1)
          }
        }
      }

      const usable = points.filter((p) => p.t > 0)
      if (usable.length) segments.push({ points: usable, mode, rawMode })
      continue
    }

    const visit = o?.placeVisit
    if (visit) {
      const p = parseLocationObject(visit.location)
      const t = parseTime(visit.duration?.startTimestamp ?? visit.duration?.startTimestampMs)
      if (p && t !== null) {
        // A visit is somewhere you stopped. Charged zones bill you for being there at
        // all, so it still counts, but it is not driving.
        segments.push({ points: [{ ...p, t }], mode: 'other', rawMode: 'place visit' })
        visits++
      }
    }
  }

  if (visits) warnings.push(`${visits.toLocaleString()} place visit(s) parsed as stationary points.`)
  return segments
}

/** Format 3, the current on-device export. */
function parsePhoneTimeline(root: any, warnings: string[]): Segment[] {
  const segs: any[] = Array.isArray(root) ? root : root.semanticSegments
  const segments: Segment[] = []
  let noTime = 0

  for (const s of segs) {
    const startT = parseTime(s?.startTime)
    const endT = parseTime(s?.endTime)

    if (Array.isArray(s?.timelinePath) && s.timelinePath.length) {
      const points: TrackPoint[] = []
      for (const node of s.timelinePath) {
        const p = parseLocationObject(node.point ?? node)
        if (!p) continue
        const t = parseTime(node.time ?? node.timestamp) ?? startT
        if (t === null) {
          noTime++
          continue
        }
        points.push({ ...p, t })
      }
      // A timelinePath has no activity type of its own; it is the movement trace.
      if (points.length) segments.push({ points, mode: 'unknown', rawMode: 'timeline path' })
    }

    const activity = s?.activity
    if (activity) {
      const { mode, rawMode } = classify(activity.topCandidate?.type ?? activity.type)
      const a = parseLocationObject(activity.start)
      const b = parseLocationObject(activity.end)
      const points: TrackPoint[] = []
      if (a && startT !== null) points.push({ ...a, t: startT })
      if (b && (endT ?? startT) !== null) points.push({ ...b, t: (endT ?? startT)! })
      if (points.length) segments.push({ points, mode, rawMode })
    }

    const visit = s?.visit
    if (visit) {
      const p = parseLocationObject(visit.topCandidate ?? visit)
      if (p && startT !== null) segments.push({ points: [{ ...p, t: startT }], mode: 'other', rawMode: 'visit' })
    }
  }

  if (noTime) warnings.push(`Skipped ${noTime.toLocaleString()} path point(s) with no timestamp.`)
  return segments
}

// --------------------------------------------------------------- guards --

/**
 * Input limits.
 *
 * Nothing here is a security boundary - the file never leaves the browser, so the
 * only thing at risk is the user's own tab. These exist so that a wrong file, a
 * still-zipped Takeout archive or a decade of Records.json produces a sentence the
 * user can act on instead of a spinner that never ends or an out-of-memory crash.
 *
 * The ceiling is set by `JSON.parse`, which materialises the whole document: a
 * 150 MB file costs roughly a gigabyte of heap once parsed into objects, which is
 * about as far as a browser tab will stretch.
 */
const MAX_FILE_BYTES = 150 * 1024 * 1024
const MAX_TOTAL_BYTES = 400 * 1024 * 1024
const MAX_FILES = 200

const mib = (n: number) => `${Math.round(n / (1024 * 1024))} MB`

/**
 * Why this file cannot be read, as a sentence, or null if it looks fine.
 *
 * Extension is a hint, not a verification - the content check is `JSON.parse`
 * further down, which is the only thing that actually decides. The point of
 * naming the extension is that "that is a ZIP, unzip it first" is a far more
 * useful message than "unexpected token PK".
 */
function rejectFile(file: File): string | null {
  const name = file.name.toLowerCase()

  if (/\.(zip|tgz|gz|tar|7z|rar)$/.test(name)) {
    return `${file.name}: that is still an archive. Unzip it and pick the JSON files inside.`
  }
  if (/\.(kml|kmz|gpx|csv|xml)$/.test(name)) {
    return `${file.name}: that format is not supported yet - this reads Google's Timeline JSON.`
  }
  if (!file.size) {
    return `${file.name}: the file is empty.`
  }
  if (file.size > MAX_FILE_BYTES) {
    return (
      `${file.name} is ${mib(file.size)}, over the ${mib(MAX_FILE_BYTES)} limit for a single file. ` +
      `A whole-history Records.json often is - use the monthly Semantic Location History files instead, ` +
      `or a shorter export.`
    )
  }
  return null
}

// ------------------------------------------------------------------- api --

export function parseTimelineJson(root: unknown, warnings: string[] = []): { format: TimelineFormat; segments: Segment[] } {
  const format = detect(root)
  switch (format) {
    case 'records':
      return { format, segments: parseRecords(root, warnings) }
    case 'semantic-location-history':
      return { format, segments: parseSemanticLocationHistory(root, warnings) }
    case 'phone-timeline':
      return { format, segments: parsePhoneTimeline(root, warnings) }
    default:
      return { format, segments: [] }
  }
}

/** Parses one or more uploaded files and merges them into a single timeline. */
export async function parseTimelineFiles(files: File[]): Promise<ParsedTimeline> {
  const warnings: string[] = []
  const segments: Segment[] = []
  const formats = new Set<TimelineFormat>()

  if (files.length > MAX_FILES) {
    warnings.push(`${files.length} files selected; only the first ${MAX_FILES} were read.`)
    files = files.slice(0, MAX_FILES)
  }

  let totalBytes = 0

  for (const file of files) {
    const rejection = rejectFile(file)
    if (rejection) {
      warnings.push(rejection)
      continue
    }

    totalBytes += file.size
    if (totalBytes > MAX_TOTAL_BYTES) {
      warnings.push(
        `Stopped at ${mib(MAX_TOTAL_BYTES)} total. ${file.name} and anything after it were not read - ` +
          `run a smaller selection and compare the results.`,
      )
      break
    }

    let root: unknown
    try {
      root = JSON.parse(await file.text())
    } catch (err) {
      warnings.push(`${file.name}: not valid JSON (${(err as Error).message}).`)
      continue
    }
    const fileWarnings: string[] = []
    const { format, segments: parsed } = parseTimelineJson(root, fileWarnings)

    if (format === 'unknown') {
      warnings.push(
        `${file.name}: unrecognised shape. Expected a Records.json, a Semantic Location History ` +
          `month file, or a Timeline export from the Google Maps app.`,
      )
      continue
    }
    if (!parsed.length) warnings.push(`${file.name}: recognised as ${format} but contained no usable positions.`)

    formats.add(format)
    segments.push(...parsed)
    warnings.push(...fileWarnings.map((w) => `${file.name}: ${w}`))
  }

  segments.sort((a, b) => a.points[0].t - b.points[0].t)

  let pointCount = 0
  let from: number | null = null
  let to: number | null = null
  for (const s of segments) {
    pointCount += s.points.length
    for (const p of s.points) {
      if (from === null || p.t < from) from = p.t
      if (to === null || p.t > to) to = p.t
    }
  }

  if (formats.size > 1) warnings.push(`Mixed export formats (${[...formats].join(', ')}). They have been merged.`)

  return {
    format: formats.size === 1 ? [...formats][0] : formats.size ? 'unknown' : 'unknown',
    segments,
    pointCount,
    hasModeInfo: segments.some((s) => s.mode !== 'unknown'),
    from,
    to,
    warnings,
  }
}
