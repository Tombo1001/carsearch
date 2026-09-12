/**
 * Decides, from your own driving history, which zones you actually enter and what
 * an older car would cost you.
 *
 * The charging model is per-day, not per-entry: ULEZ and the CAZs bill you once for
 * a calendar day however many times you cross the boundary. So the unit of analysis
 * is "distinct local dates on which at least one position fell inside the zone".
 */

import { ZoneIndex, bboxIntersects, haversineMetres, legBBox, unionBBox } from './geo'
import { checkCompliance } from './emissions'
import type { AnalysisResult, ParsedTimeline, TrackPoint, VehicleSpec, Zone, ZoneImpact } from './types'

export interface AnalysisOptions {
  /**
   * Only test positions the export labels as driving. Off by default because raw
   * Records.json exports carry no activity type at all.
   */
  drivingOnly: boolean
  /**
   * Fill in the gaps between consecutive pings. Without this a drive straight
   * through a small zone can be missed entirely when sampling is sparse.
   */
  interpolate: boolean
  /** Do not interpolate across gaps longer than this - they are not one journey. */
  maxGapMinutes: number
  /** Include zones with these statuses. */
  statuses: Zone['status'][]
}

export const DEFAULT_OPTIONS: AnalysisOptions = {
  drivingOnly: false,
  interpolate: true,
  maxGapMinutes: 30,
  statuses: ['active'],
}

/** Interpolation step. Comfortably finer than the smallest zone here (Aberdeen, ~1.6 km across). */
const SAMPLE_METRES = 120
const MAX_SAMPLES_PER_LEG = 600
/** Above this the leg is a flight or a GPS glitch, not a drive. */
const MAX_PLAUSIBLE_KMH = 250

// ------------------------------------------------------------ date keying --

const londonDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/London',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/**
 * Local (Europe/London) date for an epoch timestamp, as YYYY-MM-DD.
 *
 * Charging days run local midnight to midnight, so British Summer Time matters.
 * Intl is slow to call hundreds of thousands of times, so results are memoised per
 * hour bucket - a date can only change on an hour boundary.
 */
const dateCache = new Map<number, string>()
export function londonDateKey(t: number): string {
  const bucket = Math.floor(t / 3_600_000)
  const hit = dateCache.get(bucket)
  if (hit !== undefined) return hit
  const key = londonDate.format(new Date(t))
  dateCache.set(bucket, key)
  return key
}

// ---------------------------------------------------------------- analysis --

export interface Progress {
  done: number
  total: number
}

/**
 * Which zones you entered, and on which dates.
 *
 * Deliberately separate from pricing: this is the expensive geometric pass and it
 * does not depend on the car at all, so swapping between a 2012 diesel and a 2018
 * one re-prices instantly instead of re-scanning every position.
 */
export interface ZoneVisits {
  /** zoneId -> sorted local dates on which you were inside. */
  byZone: Record<string, string[]>
  spanDays: number
  testedPoints: number
}

export async function computeZoneVisits(
  timeline: ParsedTimeline,
  zones: Zone[],
  options: AnalysisOptions = DEFAULT_OPTIONS,
  onProgress?: (p: Progress) => void,
): Promise<ZoneVisits> {
  const active = zones.filter((z) => options.statuses.includes(z.status))
  const indexes = active.map((z) => new ZoneIndex(z))
  const worldBox = unionBBox(indexes.map((i) => i.bbox))

  /** zoneId -> set of local dates on which you were inside it. */
  const hits = new Map<string, Set<string>>()
  for (const z of active) hits.set(z.id, new Set())

  const segments = timeline.segments.filter((s) => {
    if (!options.drivingOnly) return true
    // 'unknown' is kept: a timelinePath has no activity type but is still movement.
    return s.mode === 'driving' || s.mode === 'unknown'
  })

  const total = segments.reduce((n, s) => n + s.points.length, 0)
  let done = 0
  let tested = 0
  let sinceYield = 0

  for (const segment of segments) {
    const pts = segment.points
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      tested++
      testPoint(a, a.t, indexes, hits, worldBox)

      const b = pts[i + 1]
      if (b && options.interpolate) interpolateLeg(a, b, indexes, hits, worldBox, options.maxGapMinutes)

      done++
      if (++sinceYield >= 20_000) {
        sinceYield = 0
        onProgress?.({ done, total })
        // Hand the main thread back so the page stays responsive on big exports.
        await new Promise((r) => setTimeout(r, 0))
      }
    }
  }
  onProgress?.({ done: total, total })

  const spanDays =
    timeline.from !== null && timeline.to !== null
      ? Math.max(1, Math.round((timeline.to - timeline.from) / 86_400_000))
      : 0

  const byZone: Record<string, string[]> = {}
  for (const [id, dates] of hits) if (dates.size) byZone[id] = [...dates].sort()

  return { byZone, spanDays, testedPoints: tested }
}

/** Turns zone visits into money, for one specific vehicle. Cheap; safe to call on every keystroke. */
export function priceVisits(visits: ZoneVisits, zones: Zone[], vehicle: VehicleSpec): AnalysisResult {
  const impacts: ZoneImpact[] = zones
    .filter((z) => visits.byZone[z.id]?.length)
    .map((zone) => {
      const dates = visits.byZone[zone.id]
      const compliance = checkCompliance(zone, vehicle)
      const ageIndependent = zone.affectsCars && !zone.emissionsBased
      const blocked = zone.enforcement === 'penalty' && zone.affectsCars && !compliance.compliant

      let cost = 0
      if (zone.affectsCars && zone.enforcement === 'charge') {
        // Age-independent zones (the Congestion Charge) are charged whatever you drive.
        if (ageIndependent || !compliance.compliant) cost = dates.length * zone.carDailyCharge
      }

      return { zone, daysInside: dates.length, dates, cost, blocked, ageIndependent, compliance }
    })
    .sort((a, b) => b.cost - a.cost || b.daysInside - a.daysInside)

  const totalCost = impacts.filter((i) => !i.ageIndependent).reduce((n, i) => n + i.cost, 0)
  const ageIndependentCost = impacts.filter((i) => i.ageIndependent).reduce((n, i) => n + i.cost, 0)
  const blockedDays = impacts.filter((i) => i.blocked).reduce((n, i) => n + i.daysInside, 0)

  return {
    impacts,
    spanDays: visits.spanDays,
    totalCost,
    annualisedCost: visits.spanDays > 0 ? (totalCost * 365) / visits.spanDays : 0,
    ageIndependentCost,
    blockedDays,
    testedPoints: visits.testedPoints,
  }
}

// ----------------------------------------------------------------- inner --

function testPoint(
  p: { lat: number; lon: number },
  t: number,
  indexes: ZoneIndex[],
  hits: Map<string, Set<string>>,
  worldBox: ReturnType<typeof unionBBox>,
): void {
  // Almost every position in a UK export is nowhere near a zone, so reject cheaply first.
  if (!worldBox) return
  if (p.lon < worldBox[0] || p.lon > worldBox[2] || p.lat < worldBox[1] || p.lat > worldBox[3]) return

  let date: string | null = null
  for (const idx of indexes) {
    const seen = hits.get(idx.zone.id)!
    // Once a zone is billed for a date, further positions that day change nothing.
    if (date !== null && seen.has(date)) continue
    if (!idx.contains(p.lon, p.lat)) continue
    if (date === null) {
      date = londonDateKey(t)
      if (seen.has(date)) continue
    }
    seen.add(date)
  }
}

/**
 * Walks a straight line between two pings, testing sampled positions along it.
 *
 * Google's raw pings can be minutes apart. A straight line is not the road you took,
 * but for the question "did I pass through this zone" it is a far better estimate
 * than pretending the gap did not exist.
 */
function interpolateLeg(
  a: TrackPoint,
  b: TrackPoint,
  indexes: ZoneIndex[],
  hits: Map<string, Set<string>>,
  worldBox: ReturnType<typeof unionBBox>,
  maxGapMinutes: number,
): void {
  if (!worldBox) return

  const gapMs = b.t - a.t
  if (gapMs <= 0 || gapMs > maxGapMinutes * 60_000) return

  const dist = haversineMetres(a, b)
  if (dist <= SAMPLE_METRES) return

  const kmh = dist / 1000 / (gapMs / 3_600_000)
  if (kmh > MAX_PLAUSIBLE_KMH) return

  // If the whole leg misses every zone's box, there is nothing to sample for.
  const box = legBBox(a, b)
  if (!bboxIntersects(box, worldBox)) return
  const relevant = indexes.filter((idx) => bboxIntersects(box, idx.bbox))
  if (!relevant.length) return

  const steps = Math.min(MAX_SAMPLES_PER_LEG, Math.ceil(dist / SAMPLE_METRES))
  for (let s = 1; s < steps; s++) {
    const f = s / steps
    testPoint(
      { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f },
      a.t + gapMs * f,
      relevant,
      hits,
      worldBox,
    )
  }
}
