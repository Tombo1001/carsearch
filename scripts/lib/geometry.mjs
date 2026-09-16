/**
 * Plain-coordinate geometry for the build scripts: [lon, lat] arrays, WGS84.
 *
 * Shared by the zone and region builds. No dependencies, because the only
 * operations needed - simplify, bound, and point-in-polygon - are short, and a
 * geometry library would be the largest thing in the build.
 */

/** Collapses a FeatureCollection of (Multi)Polygons into one MultiPolygon coordinate array. */
export function toMultiPolygon(fc) {
  const polys = []
  for (const f of fc.features) {
    const g = f.geometry
    if (!g) continue
    if (g.type === 'Polygon') polys.push(g.coordinates)
    else if (g.type === 'MultiPolygon') polys.push(...g.coordinates)
    // Anything else (points, lines) is not an area and is dropped.
  }
  if (!polys.length) throw new Error('no polygon geometry in source')
  return polys
}

/** Douglas-Peucker on a ring, with tolerance given in degrees. */
export function simplifyRing(ring, tol) {
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

export function sqSegDist(p, a, b) {
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

export function simplifyMultiPolygon(polys, metres) {
  // At UK latitudes a degree of longitude is ~65 km and of latitude ~111 km. Using the
  // smaller figure keeps the tolerance conservative in both axes.
  const tol = metres / 111_320
  return polys.map((rings) => rings.map((ring) => simplifyRing(ring, tol)))
}

export function bboxOf(polys) {
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

export const countPositions = (polys) => polys.reduce((n, rings) => n + rings.reduce((m, r) => m + r.length, 0), 0)

/** Ray casting on one ring. Points exactly on an edge may fall either way, which is fine for this. */
function inRing([x, y], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Inside the outer ring of any polygon and outside all of that polygon's holes. */
export function pointInMultiPolygon(point, polys) {
  for (const [outer, ...holes] of polys) {
    if (inRing(point, outer) && !holes.some((h) => inRing(point, h))) return true
  }
  return false
}

export const inBBox = ([x, y], [minX, minY, maxX, maxY]) => x >= minX && x <= maxX && y >= minY && y <= maxY

