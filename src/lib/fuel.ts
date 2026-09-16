/**
 * Regional fuel prices: the shape of public/data/fuel.json and regions.json, and
 * the screen-space label layout used to draw them without covering a zone.
 */

import type { Fuel } from './types'

export interface FuelSummary {
  /** Pence per litre, or null when too few forecourts reported to publish one. */
  median: number | null
  n: number
}

export interface FuelRegion {
  code: string
  name: string
  fullName: string
  label: [number, number]
  prices: Record<string, FuelSummary>
}

export interface FuelData {
  version: 1
  generatedAt: string
  newestPrice: string | null
  source: { name: string; url: string; note: string }
  fuels: Record<string, string>
  minSample: number
  stations: number
  uk: Record<string, FuelSummary>
  regions: FuelRegion[]
  history: { date: string; uk: Record<string, number | null>; regions: Record<string, Record<string, number | null>> }[]
}

export interface RegionShapes {
  source: { name: string; url: string; licence: string }
  regions: { code: string; name: string; geometry: number[][][][] }[]
}

/** The two grades shown on the map. The rest stay in the data for later. */
export const MAP_FUELS = [
  { key: 'E10', label: 'Unleaded' },
  { key: 'B7S', label: 'Diesel' },
] as const
export type MapFuel = (typeof MAP_FUELS)[number]['key']

/** Which pump a car of this fuel uses. Electric defaults to unleaded, as the most common comparison. */
export function pumpFor(fuel: Fuel): MapFuel {
  return fuel === 'diesel' || fuel === 'hybrid-diesel' ? 'B7S' : 'E10'
}

/** Price change for a region over roughly a week, if the history reaches back that far. */
export function weekChange(data: FuelData, code: string, fuel: string): number | null {
  const now = data.regions.find((r) => r.code === code)?.prices[fuel]?.median
  if (now == null || data.history.length < 2) return null
  const latest = Date.parse(data.history[data.history.length - 1].date)
  const past = [...data.history]
    .reverse()
    .find((h) => latest - Date.parse(h.date) >= 6 * 86_400_000 && h.regions[code]?.[fuel] != null)
  const then = past?.regions[code]?.[fuel]
  return then == null ? null : Math.round((now - then) * 10) / 10
}

// ----------------------------------------------------------------- layout --

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface LabelRequest {
  id: string
  /** The region's anchor point on screen. */
  ax: number
  ay: number
  w: number
  h: number
}

export interface Placement {
  id: string
  /** Top-left of the label. */
  x: number
  y: number
  /** True when the label had to move off its anchor; draw a leader line. */
  moved: boolean
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** Offsets tried in order: on the anchor, then rings of increasing distance. */
const DIRECTIONS: [number, number][] = [
  [1, 0], [-1, 0], [0, -1], [0, 1], [1, -1], [-1, -1], [1, 1], [-1, 1],
]
const DISTANCES = [34, 56, 84, 120, 165]

/**
 * Places each label as close to its anchor as it can without touching an obstacle
 * (a zone), another label, or the edge of the view. A label with nowhere to go is
 * left out rather than drawn over a zone: covering the thing the page is about
 * would be worse than a missing price, which the list in the control still shows.
 */
export function layoutLabels(requests: LabelRequest[], obstacles: Rect[], view: Rect, margin = 4): (Placement | null)[] {
  const placed: Rect[] = []
  const inside = (r: Rect) =>
    r.x >= view.x + margin && r.y >= view.y + margin && r.x + r.w <= view.x + view.w - margin && r.y + r.h <= view.y + view.h - margin

  return requests.map((req) => {
    const candidates: [number, number][] = [[0, 0]]
    for (const d of DISTANCES) for (const [ux, uy] of DIRECTIONS) candidates.push([ux * d, uy * d * 0.75])

    for (const [dx, dy] of candidates) {
      const r = { x: req.ax + dx - req.w / 2, y: req.ay + dy - req.h / 2, w: req.w, h: req.h }
      const padded = { x: r.x - margin, y: r.y - margin, w: r.w + 2 * margin, h: r.h + 2 * margin }
      if (!inside(r)) continue
      if (obstacles.some((o) => overlaps(padded, o))) continue
      if (placed.some((p) => overlaps(padded, p))) continue
      placed.push(r)
      return { id: req.id, x: r.x, y: r.y, moved: dx !== 0 || dy !== 0 }
    }
    return null
  })
}

/** Where a leader line from the anchor should meet the label: the nearest point on its edge. */
export function leaderEnd(p: Placement, w: number, h: number, ax: number, ay: number): [number, number] {
  return [Math.min(Math.max(ax, p.x), p.x + w), Math.min(Math.max(ay, p.y), p.y + h)]
}

/**
 * Shortens a leader line so it stops where it would enter an obstacle.
 *
 * London's anchor is inside the ULEZ, so a line drawn all the way to it (with a
 * dot on the end) would cross the very zone the label moved to avoid. Returns the
 * new end point, and whether the anchor itself is covered and its dot should go.
 */
export function clipLeader(
  from: [number, number],
  to: [number, number],
  obstacles: Rect[],
): { end: [number, number]; anchorCovered: boolean } {
  const [x0, y0] = from
  const [dx, dy] = [to[0] - x0, to[1] - y0]
  let tEnter = 1
  let covered = false
  for (const o of obstacles) {
    const inside = to[0] >= o.x && to[0] <= o.x + o.w && to[1] >= o.y && to[1] <= o.y + o.h
    if (!inside) continue
    covered = true
    // Slab method: the parameter at which the segment first enters this box.
    let t0 = 0
    let t1 = 1
    for (const [p, q] of [
      [-dx, x0 - o.x],
      [dx, o.x + o.w - x0],
      [-dy, y0 - o.y],
      [dy, o.y + o.h - y0],
    ] as const) {
      if (p === 0) continue
      const t = q / p
      if (p < 0) t0 = Math.max(t0, t)
      else t1 = Math.min(t1, t)
    }
    if (t0 <= t1) tEnter = Math.min(tEnter, t0)
  }
  return { end: [x0 + dx * tEnter, y0 + dy * tEnter], anchorCovered: covered }
}
