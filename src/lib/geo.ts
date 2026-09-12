import type { MultiPolygonCoords, TrackPoint, Zone } from './types'

export type BBox = [number, number, number, number]

export const bboxContains = (b: BBox, lon: number, lat: number) =>
  lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3]

export const bboxIntersects = (a: BBox, b: BBox) =>
  a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]

/** Standard ray-casting test. `ring` is a closed list of [lon, lat]. */
function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0]
    const yi = ring[i][1]
    const xj = ring[j][0]
    const yj = ring[j][1]
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function pointInMultiPolygon(lon: number, lat: number, polys: MultiPolygonCoords): boolean {
  for (const rings of polys) {
    if (!pointInRing(lon, lat, rings[0])) continue
    // Inside the outer ring: only counts if it is not in a hole.
    let inHole = false
    for (let h = 1; h < rings.length; h++) {
      if (pointInRing(lon, lat, rings[h])) {
        inHole = true
        break
      }
    }
    if (!inHole) return true
  }
  return false
}

/**
 * Wraps a Zone with a precomputed per-polygon bounding box.
 *
 * London's ULEZ is 22 polygons and one of them is the whole of Greater London, so
 * rejecting on the polygon bbox before ray-casting saves a lot of work across the
 * hundreds of thousands of positions a Timeline export can contain.
 */
export class ZoneIndex {
  readonly zone: Zone
  private readonly polyBoxes: BBox[]

  constructor(zone: Zone) {
    this.zone = zone
    this.polyBoxes = zone.geometry.map((rings) => {
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const [x, y] of rings[0]) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
      return [minX, minY, maxX, maxY] as BBox
    })
  }

  get bbox(): BBox {
    return this.zone.bbox
  }

  contains(lon: number, lat: number): boolean {
    if (!bboxContains(this.zone.bbox, lon, lat)) return false
    for (let i = 0; i < this.polyBoxes.length; i++) {
      if (!bboxContains(this.polyBoxes[i], lon, lat)) continue
      if (pointInMultiPolygon(lon, lat, [this.zone.geometry[i]])) return true
    }
    return false
  }
}

const R_EARTH_M = 6_371_000
const toRad = (d: number) => (d * Math.PI) / 180

export function haversineMetres(a: TrackPoint, b: TrackPoint): number {
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R_EARTH_M * Math.asin(Math.sqrt(h))
}

/** Union bbox of many boxes, or null when there are none. */
export function unionBBox(boxes: BBox[]): BBox | null {
  if (!boxes.length) return null
  const out: BBox = [Infinity, Infinity, -Infinity, -Infinity]
  for (const b of boxes) {
    if (b[0] < out[0]) out[0] = b[0]
    if (b[1] < out[1]) out[1] = b[1]
    if (b[2] > out[2]) out[2] = b[2]
    if (b[3] > out[3]) out[3] = b[3]
  }
  return out
}

/** Bounding box of a straight leg between two positions, padded a little. */
export function legBBox(a: TrackPoint, b: TrackPoint, padDeg = 0.002): BBox {
  return [
    Math.min(a.lon, b.lon) - padDeg,
    Math.min(a.lat, b.lat) - padDeg,
    Math.max(a.lon, b.lon) + padDeg,
    Math.max(a.lat, b.lat) + padDeg,
  ]
}

/**
 * Douglas-Peucker in degrees. Used only to keep the map layer light; analysis always
 * runs on the full-resolution positions.
 */
export function simplifyPath(points: TrackPoint[], toleranceDeg: number): TrackPoint[] {
  if (points.length <= 2) return points
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const sqTol = toleranceDeg * toleranceDeg
  const stack: [number, number][] = [[0, points.length - 1]]

  while (stack.length) {
    const [first, last] = stack.pop()!
    let maxSq = 0
    let index = -1
    for (let i = first + 1; i < last; i++) {
      const sq = sqSegDist(points[i], points[first], points[last])
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
  return points.filter((_, i) => keep[i] === 1)
}

function sqSegDist(p: TrackPoint, a: TrackPoint, b: TrackPoint): number {
  let x = a.lon
  let y = a.lat
  let dx = b.lon - x
  let dy = b.lat - y
  if (dx !== 0 || dy !== 0) {
    const t = ((p.lon - x) * dx + (p.lat - y) * dy) / (dx * dx + dy * dy)
    if (t > 1) {
      x = b.lon
      y = b.lat
    } else if (t > 0) {
      x += dx * t
      y += dy * t
    }
  }
  dx = p.lon - x
  dy = p.lat - y
  return dx * dx + dy * dy
}
