import { useEffect, useMemo, useRef } from 'react'
import maplibregl, { type LngLatBoundsLike, type StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { ParsedTimeline, Zone, ZoneImpact } from '../lib/types'
import { simplifyPath } from '../lib/geo'
import { TILE_ATTRIBUTION, TILE_URL } from '../lib/config'

/**
 * Zone status hues. Validated as a set by the data-viz palette validator (all
 * pairs, both modes). Colour is a shortcut here, not the message: every zone also
 * carries a text badge in the results table, and the legend is always visible.
 */
export const STATUS_COLOURS = {
  clear: '#1baf7a',
  flat: '#2a78d6',
  costly: '#d03b3b',
} as const

export type ZoneStatusKey = keyof typeof STATUS_COLOURS

export function zoneStatusKey(impact: ZoneImpact | undefined, zone: Zone): ZoneStatusKey {
  if (!zone.affectsCars) return 'clear'
  if (!zone.emissionsBased) return 'flat'
  if (impact && (impact.cost > 0 || impact.blocked)) return 'costly'
  return 'clear'
}

/**
 * Raster basemap. Defaults to OpenStreetMap's own tile servers, which need no API
 * key and keep a fresh clone runnable, but their usage policy does not cover a
 * public site with real traffic and they enforce it by serving a "blocked" tile.
 * A deployment sets VITE_TILE_URL to its own provider - see src/lib/config.ts.
 */
const BASE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: [TILE_URL],
      tileSize: 256,
      maxzoom: 19,
      attribution: TILE_ATTRIBUTION,
    },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#1a1a19' } },
    // Desaturated so the zone fills and your route are what stand out.
    { id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-saturation': -0.7, 'raster-opacity': 0.75 } },
  ],
}

const UK_BOUNDS: LngLatBoundsLike = [
  [-8.7, 49.8],
  [1.9, 59.5],
]

/** Cap on rendered route positions - beyond this the line is drawn, not read. */
const MAX_ROUTE_POINTS = 60_000

interface Props {
  zones: Zone[]
  impacts: ZoneImpact[]
  timeline: ParsedTimeline | null
  /** Zone id to fly to, bumped by the results list. */
  focusZoneId?: string | null
}

export default function MapView({ zones, impacts, timeline, focusZoneId }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const ready = useRef(false)

  const impactById = useMemo(() => new Map(impacts.map((i) => [i.zone.id, i])), [impacts])

  /**
   * The latest zones and impacts, for the map's event handlers.
   *
   * The map is created once, so a handler registered in that effect sees the props
   * of the very first render - when zones.json has not loaded yet and `zones` is
   * empty. Reading props directly there meant every click looked up a zone in an
   * empty list and no popup ever opened. Handlers read these refs instead.
   */
  const latest = useRef({ zones, impactById })
  latest.current = { zones, impactById }

  const zoneFeatures = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: zones.map((z) => ({
        type: 'Feature' as const,
        id: z.id,
        properties: {
          id: z.id,
          name: z.name,
          status: zoneStatusKey(impactById.get(z.id), z),
          approximate: z.precision === 'approximate',
          visited: impactById.has(z.id),
        },
        geometry: { type: 'MultiPolygon' as const, coordinates: z.geometry },
      })),
    }),
    [zones, impactById],
  )

  const routeFeatures = useMemo(() => {
    if (!timeline) return { type: 'FeatureCollection' as const, features: [] }

    // Simplify hard: at UK scale a 30 m tolerance is invisible but can drop an
    // order of magnitude of positions.
    const lines: number[][][] = []
    let budget = MAX_ROUTE_POINTS
    for (const seg of timeline.segments) {
      if (budget <= 0) break
      if (seg.points.length < 2) continue
      const simplified = simplifyPath(seg.points, 0.0003)
      const coords = simplified.slice(0, budget).map((p) => [p.lon, p.lat])
      if (coords.length >= 2) {
        lines.push(coords)
        budget -= coords.length
      }
    }
    return {
      type: 'FeatureCollection' as const,
      features: lines.length
        ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'MultiLineString' as const, coordinates: lines } }]
        : [],
    }
  }, [timeline])

  // ------------------------------------------------------------- init map --

  useEffect(() => {
    if (!container.current || map.current) return

    const m = new maplibregl.Map({
      container: container.current,
      style: BASE_STYLE,
      bounds: UK_BOUNDS,
      fitBoundsOptions: { padding: 30 },
      attributionControl: { compact: true },
    })
    map.current = m
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    m.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-right')

    m.on('load', () => {
      m.addSource('zones', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })

      const colour: maplibregl.DataDrivenPropertyValueSpecification<string> = [
        'match',
        ['get', 'status'],
        'costly',
        STATUS_COLOURS.costly,
        'flat',
        STATUS_COLOURS.flat,
        STATUS_COLOURS.clear,
      ]

      m.addLayer({
        id: 'zone-fill',
        type: 'fill',
        source: 'zones',
        paint: {
          'fill-color': colour,
          // Zones you actually enter are emphasised; the rest stay as context.
          'fill-opacity': ['case', ['get', 'visited'], 0.3, 0.12],
        },
      })

      m.addLayer({
        id: 'zone-line',
        type: 'line',
        source: 'zones',
        paint: {
          'line-color': colour,
          'line-width': ['case', ['get', 'visited'], 2, 1],
          // A dashed edge means the boundary is our approximation, not the council's.
          'line-dasharray': ['case', ['get', 'approximate'], ['literal', [2, 2]], ['literal', [1, 0]]],
        },
      })

      // A 2px surface-coloured casing keeps the route legible where it crosses a fill.
      m.addLayer({
        id: 'route-casing',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#0d0d0d', 'line-width': 4, 'line-opacity': 0.5 },
      })
      m.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#eda100', 'line-width': 1.6, 'line-opacity': 0.85 },
      })

      ready.current = true
      m.fire('carsearch:ready')
    })

    m.on('click', 'zone-fill', (e) => {
      const { zones, impactById } = latest.current
      const hits = (e.features ?? [])
        .map((f) => zones.find((z) => z.id === f.properties?.id))
        .filter((z): z is Zone => Boolean(z))
      // Zones stack - central London is inside the LEZ, ULEZ and Congestion Charge at
      // once. Whichever happens to draw on top is arbitrary, and here it is the LEZ,
      // which does not apply to cars. Prefer zones that do, then the smallest, which
      // is the most specific thing under the cursor.
      const area = (z: Zone) => (z.bbox[2] - z.bbox[0]) * (z.bbox[3] - z.bbox[1])
      const zone = hits.sort((a, b) => Number(b.affectsCars) - Number(a.affectsCars) || area(a) - area(b))[0]
      if (zone) {
        new maplibregl.Popup({ closeButton: true, maxWidth: '320px' })
          .setLngLat(e.lngLat)
          .setHTML(popupHtml(zone, impactById.get(zone.id)))
          .addTo(m)
      }
    })
    m.on('mouseenter', 'zone-fill', () => (m.getCanvas().style.cursor = 'pointer'))
    m.on('mouseleave', 'zone-fill', () => (m.getCanvas().style.cursor = ''))

    return () => {
      m.remove()
      map.current = null
      ready.current = false
    }
    // Intentionally mounts once: later data changes are pushed via setData below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------------------------------------------------------- push updates --

  useEffect(() => {
    const m = map.current
    if (!m) return
    const apply = () => (m.getSource('zones') as maplibregl.GeoJSONSource | undefined)?.setData(zoneFeatures)
    if (ready.current) apply()
    else m.once('carsearch:ready', apply)
  }, [zoneFeatures])

  useEffect(() => {
    const m = map.current
    if (!m) return
    const apply = () => {
      ;(m.getSource('route') as maplibregl.GeoJSONSource | undefined)?.setData(routeFeatures)
      const first = routeFeatures.features[0]
      if (!first) return
      const bounds = new maplibregl.LngLatBounds()
      for (const line of first.geometry.coordinates) for (const c of line) bounds.extend(c as [number, number])
      if (!bounds.isEmpty()) m.fitBounds(bounds, { padding: 40, maxZoom: 11, duration: 600 })
    }
    if (ready.current) apply()
    else m.once('carsearch:ready', apply)
  }, [routeFeatures])

  useEffect(() => {
    const m = map.current
    if (!m || !focusZoneId) return
    const zone = zones.find((z) => z.id === focusZoneId)
    if (!zone) return
    m.fitBounds(zone.bbox as [number, number, number, number], { padding: 60, duration: 700 })
  }, [focusZoneId, zones])

  return <div className="map-root" ref={container} />
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/**
 * Href for the popup's source link, or '#' if it is not a plain web URL.
 *
 * `esc` makes a string safe to sit inside an attribute, but it does not make it
 * safe to *navigate to*: `javascript:alert(1)` survives escaping intact. These URLs
 * come from zones.json, which is generated from council and TfL feeds by
 * `npm run data:zones`, so this is a check on our own build pipeline rather than on
 * anything the user supplies - which is exactly why it is cheap to keep honest.
 */
function safeHref(url: string): string {
  try {
    const parsed = new URL(url, window.location.href)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : '#'
  } catch {
    return '#'
  }
}
const money = (n: number) => `£${n.toFixed(2).replace(/\.00$/, '')}`

function popupHtml(zone: Zone, impact: ZoneImpact | undefined): string {
  const rows: [string, string][] = [
    ['Authority', zone.authority],
    ['Type', zone.cazClass ? `${zone.kind} (Class ${zone.cazClass})` : zone.kind],
    ['Hours', zone.hours],
  ]

  if (!zone.affectsCars) rows.push(['Cars', 'Not affected'])
  else if (zone.enforcement === 'penalty')
    rows.push(['Cars', `No charge - non-compliant vehicles are banned (${money(zone.penalty?.amount ?? 0)} penalty)`])
  else if (zone.carDailyCharge) rows.push(['Cars', `${money(zone.carDailyCharge)} per day`])

  if (zone.standards?.petrol) rows.push(['Free entry', `${zone.standards.petrol} petrol / ${zone.standards.diesel} diesel`])
  if (zone.liveFrom) rows.push(['Live since', zone.liveFrom])

  if (impact) {
    rows.push(['Your visits', `${impact.daysInside} day${impact.daysInside === 1 ? '' : 's'} in this export`])
    if (impact.blocked) rows.push(['Impact', 'You could not make these trips in this car'])
    else if (impact.cost > 0) rows.push(['Impact', `${money(impact.cost)} over the period`])
    else rows.push(['Impact', 'No charge for this car'])
  }

  const approx =
    zone.precision === 'approximate'
      ? `<p class="small" style="margin:8px 0 0;color:var(--zone-costly)">Approximate boundary (dashed). No open dataset was found for this zone.</p>`
      : ''

  return `
    <h4>${esc(zone.name)}</h4>
    <dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    ${zone.notes ? `<p class="small secondary" style="margin:8px 0 0">${esc(zone.notes)}</p>` : ''}
    ${approx}
    ${
      zone.info
        ? `<p class="small" style="margin:8px 0 0">Charges and exemptions: <a href="${esc(safeHref(zone.info.url))}" target="_blank" rel="noopener noreferrer">${esc(zone.info.name)}</a></p>`
        : ''
    }
    <p class="small muted" style="margin:4px 0 0">Boundary data: <a href="${esc(safeHref(zone.source.url))}" target="_blank" rel="noopener noreferrer">${esc(zone.source.name)}</a></p>
  `
}
