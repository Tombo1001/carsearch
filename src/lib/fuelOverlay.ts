import type maplibregl from 'maplibre-gl'
import { clipLeader, layoutLabels, leaderEnd, weekChange, type FuelData, type MapFuel, type Rect, type RegionShapes } from './fuel'

/**
 * Regional fuel prices drawn over the map without covering a zone.
 *
 * Two parts:
 *   - a faint outline of each region, added *beneath* the zone layers so zones
 *     always draw on top. There is deliberately no fill: a tint under the zones
 *     would change their colours, and those colours carry the page's meaning.
 *   - an HTML label per region, laid out on every move so that no label overlaps
 *     a zone, the map's controls, or another label. A label that has to leave its
 *     region's anchor gets a thin leader line back to it.
 *
 * Labels are hidden when zoomed in past city scale, where a regional average says
 * nothing and the zones need the space.
 */

const OUTLINE_SOURCE = 'fuel-regions'
const OUTLINE_LAYER = 'fuel-region-outline'
/** Beyond this zoom the view is a city, not a region. */
export const FUEL_MAX_ZOOM = 9
/**
 * Below this zoom the whole UK is on screen and a three-line label is wider than
 * most regions, so labels drop to name and price. Fewer of them then need moving.
 */
const COMPACT_BELOW_ZOOM = 6
const SVG = 'http://www.w3.org/2000/svg'

const pence = (n: number) => `${n.toFixed(1)}p`
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toFixed(1)}p`

export class FuelOverlay {
  private root: HTMLDivElement
  private svg: SVGSVGElement
  private chips = new Map<string, HTMLDivElement>()
  private data: FuelData | null = null
  private fuel: MapFuel = 'E10'
  private visible = false
  private frame = 0
  private readonly onMove = () => this.schedule()

  constructor(
    private map: maplibregl.Map,
    /** Screen rectangles labels must avoid, relative to the map container. */
    private obstacles: () => Rect[],
  ) {
    this.root = document.createElement('div')
    this.root.className = 'fuel-labels'
    this.root.setAttribute('aria-hidden', 'true')
    this.svg = document.createElementNS(SVG, 'svg')
    this.svg.setAttribute('class', 'fuel-leaders')
    this.root.append(this.svg)

    // Directly after the canvas, so popups (added to the same container later)
    // stack above the labels.
    const host = map.getCanvasContainer()
    host.insertBefore(this.root, map.getCanvas().nextSibling)

    map.on('move', this.onMove)
    map.on('resize', this.onMove)
  }

  setData(data: FuelData, shapes: RegionShapes) {
    this.data = data
    if (!this.map.getSource(OUTLINE_SOURCE)) {
      this.map.addSource(OUTLINE_SOURCE, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: shapes.regions.map((r) => ({
            type: 'Feature',
            properties: { code: r.code },
            geometry: { type: 'MultiPolygon', coordinates: r.geometry },
          })),
        },
      })
      this.map.addLayer(
        {
          id: OUTLINE_LAYER,
          type: 'line',
          source: OUTLINE_SOURCE,
          layout: { visibility: this.visible ? 'visible' : 'none' },
          paint: { 'line-color': '#9a9890', 'line-width': 1, 'line-opacity': 0.55, 'line-dasharray': [3, 2] },
        },
        // Beneath every zone layer.
        this.map.getLayer('zone-fill') ? 'zone-fill' : undefined,
      )
    }
    this.renderChips()
    this.schedule()
  }

  setFuel(fuel: MapFuel) {
    if (fuel === this.fuel) return
    this.fuel = fuel
    this.renderChips()
    this.schedule()
  }

  setVisible(visible: boolean) {
    this.visible = visible
    this.root.hidden = !visible
    if (this.map.getLayer(OUTLINE_LAYER)) {
      this.map.setLayoutProperty(OUTLINE_LAYER, 'visibility', visible ? 'visible' : 'none')
    }
    this.schedule()
  }

  destroy() {
    cancelAnimationFrame(this.frame)
    this.map.off('move', this.onMove)
    this.map.off('resize', this.onMove)
    this.root.remove()
  }

  private renderChips() {
    const data = this.data
    if (!data) return
    const uk = data.uk[this.fuel]?.median ?? null

    for (const r of data.regions) {
      let chip = this.chips.get(r.code)
      if (!chip) {
        chip = document.createElement('div')
        chip.className = 'fuel-chip'
        chip.append(document.createElement('span'), document.createElement('strong'), document.createElement('span'))
        chip.children[0].className = 'fuel-chip-name'
        chip.children[2].className = 'fuel-chip-delta'
        this.root.append(chip)
        this.chips.set(r.code, chip)
      }
      const price = r.prices[this.fuel]?.median ?? null
      const [name, value, delta] = chip.children as unknown as HTMLElement[]
      name.textContent = r.name
      value.textContent = price === null ? 'n/a' : pence(price)
      const week = weekChange(data, r.code, this.fuel)
      delta.textContent =
        price === null || uk === null
          ? ''
          : `${signed(Math.round((price - uk) * 10) / 10)} vs UK${week !== null ? ` · ${signed(week)} wk` : ''}`
      chip.dataset.size = ''
    }
  }

  private schedule() {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.layout()
    })
  }

  private layout() {
    const data = this.data
    if (!data || !this.visible) return
    const container = this.map.getContainer()
    const zoom = this.map.getZoom()
    const zoomedIn = zoom > FUEL_MAX_ZOOM
    this.root.classList.toggle('zoomed-in', zoomedIn)
    if (zoomedIn) return
    // Set before measuring, so label sizes below are the compact ones.
    this.root.classList.toggle('compact', zoom < COMPACT_BELOW_ZOOM)

    const view = { x: 0, y: 0, w: container.clientWidth, h: container.clientHeight }
    const requests = data.regions.map((r) => {
      const chip = this.chips.get(r.code)!
      const p = this.map.project(r.label)
      return { id: r.code, ax: p.x, ay: p.y, w: chip.offsetWidth, h: chip.offsetHeight }
    })
    const obstacles = this.obstacles()
    const placements = layoutLabels(requests, obstacles, view)

    this.svg.replaceChildren()
    placements.forEach((p, i) => {
      const req = requests[i]
      const chip = this.chips.get(req.id)!
      if (!p) {
        chip.style.visibility = 'hidden'
        return
      }
      chip.style.visibility = 'visible'
      chip.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`
      if (p.moved) {
        // Drawn from the label towards its anchor, stopping at any zone in the way.
        const start = leaderEnd(p, req.w, req.h, req.ax, req.ay)
        const { end, anchorCovered } = clipLeader(start, [req.ax, req.ay], obstacles)
        if (Math.hypot(end[0] - start[0], end[1] - start[1]) < 2) return
        const line = document.createElementNS(SVG, 'line')
        line.setAttribute('x1', String(start[0]))
        line.setAttribute('y1', String(start[1]))
        line.setAttribute('x2', String(end[0]))
        line.setAttribute('y2', String(end[1]))
        this.svg.append(line)
        if (!anchorCovered) {
          const dot = document.createElementNS(SVG, 'circle')
          dot.setAttribute('cx', String(req.ax))
          dot.setAttribute('cy', String(req.ay))
          dot.setAttribute('r', '3')
          this.svg.append(dot)
        }
      }
    })
  }
}
