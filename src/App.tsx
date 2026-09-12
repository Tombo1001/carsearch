import { useCallback, useEffect, useRef, useState } from 'react'
import MapView from './components/MapView'
import UploadPanel from './components/UploadPanel'
import VehiclePanel from './components/VehiclePanel'
import ResultsPanel from './components/ResultsPanel'
import Catalogue from './components/Catalogue'
import SiteLinks from './components/SiteLinks'
import {
  DEFAULT_OPTIONS,
  computeZoneVisits,
  priceVisits,
  type AnalysisOptions,
  type Progress,
  type ZoneVisits,
} from './lib/analysis'
import type { AnalysisResult, ParsedTimeline, VehicleSpec, ZoneData } from './lib/types'

type Tab = 'zones' | 'catalogue'

const DEFAULT_VEHICLE: VehicleSpec = {
  fuel: 'diesel',
  // A 2012 diesel is the case worth testing: cheap, plentiful, and Euro 5, so it
  // pays the ULEZ charge every single day it goes near London.
  registered: '2012-06-01',
  euroOverride: null,
}

export default function App() {
  const [tab, setTab] = useState<Tab>('zones')
  const [zoneData, setZoneData] = useState<ZoneData | null>(null)
  const [zoneError, setZoneError] = useState<string | null>(null)

  const [timeline, setTimeline] = useState<ParsedTimeline | null>(null)
  const [vehicle, setVehicle] = useState<VehicleSpec>(DEFAULT_VEHICLE)
  const [options, setOptions] = useState<AnalysisOptions>(DEFAULT_OPTIONS)

  const [visits, setVisits] = useState<ZoneVisits | null>(null)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [focusZoneId, setFocusZoneId] = useState<string | null>(null)

  /** Guards against an older, slower run overwriting a newer one. */
  const runToken = useRef(0)

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/zones.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setZoneData)
      .catch((e: Error) => setZoneError(e.message))
  }, [])

  // The expensive geometric pass: only when the history or the options change.
  useEffect(() => {
    if (!timeline || !zoneData) {
      setVisits(null)
      setProgress(null)
      return
    }
    const token = ++runToken.current
    setProgress({ done: 0, total: timeline.pointCount })

    void computeZoneVisits(timeline, zoneData.zones, options, (p) => {
      if (runToken.current === token) setProgress(p)
    }).then((v) => {
      if (runToken.current !== token) return
      setVisits(v)
      setProgress(null)
    })
  }, [timeline, zoneData, options])

  // Pricing is cheap, so changing the car re-costs instantly.
  useEffect(() => {
    if (!visits || !zoneData) {
      setResult(null)
      return
    }
    setResult(priceVisits(visits, zoneData.zones, vehicle))
  }, [visits, zoneData, vehicle])

  const handleTimeline = useCallback((t: ParsedTimeline | null) => {
    setTimeline(t)
    if (t && !t.hasModeInfo) setOptions((o) => ({ ...o, drivingOnly: false }))
  }, [])

  const zones = zoneData?.zones ?? []

  /** "11 in England, 4 in Scotland" - read off the data so it cannot go stale. */
  const countryCounts = Object.entries(
    zones.reduce<Record<string, number>>((acc, z) => {
      acc[z.country] = (acc[z.country] ?? 0) + 1
      return acc
    }, {}),
  )
    .sort((a, b) => b[1] - a[1])
    .map(([country, n]) => `${n} in ${country}`)
    .join(', ')

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>carsearch</h1>
          <small>what would an older car actually cost you?</small>
        </div>
        <nav className="tabs" role="tablist">
          <button className="tab" role="tab" aria-selected={tab === 'zones'} onClick={() => setTab('zones')}>
            Zone impact
          </button>
          <button className="tab" role="tab" aria-selected={tab === 'catalogue'} onClick={() => setTab('catalogue')}>
            Catalogue
          </button>
        </nav>
        <SiteLinks context={{ timeline, zoneData, vehicle }} />
      </header>

      {tab === 'zones' ? (
        <div className="layout">
          <aside className="sidebar">
            {zoneError && (
              <div className="note warn">
                Could not load zone data ({zoneError}). Run <code>npm run data:zones</code> to generate{' '}
                <code>public/data/zones.json</code>.
              </div>
            )}

            <UploadPanel timeline={timeline} onLoaded={handleTimeline} />

            <VehiclePanel
              vehicle={vehicle}
              onVehicle={setVehicle}
              options={options}
              onOptions={setOptions}
              zones={zones}
              hasModeInfo={timeline?.hasModeInfo ?? false}
            />

            <ResultsPanel result={result} progress={progress} onFocusZone={setFocusZoneId} />

            {zoneData && (
              <section className="card stack">
                <h3>About the zone data</h3>
                <p className="small secondary" style={{ margin: 0 }}>
                  {zoneData.zones.length} zones, built {new Date(zoneData.generatedAt).toLocaleDateString('en-GB')} from
                  official council and TfL sources where they publish one. Charges are as at{' '}
                  {zoneData.chargesAsOf}. Boundaries are simplified to {zoneData.simplifiedToMetres} m, which is
                  finer than consumer GPS noise.
                </p>
                <p className="small secondary" style={{ margin: 0 }}>
                  <strong>Coverage is the whole UK.</strong> England and Scotland are the only nations that
                  operate one of these schemes &mdash; {countryCounts}.
                  Wales and Northern Ireland have none in force as at {zoneData.chargesAsOf}, so a route
                  through Cardiff or Belfast showing no charge is the right answer, not missing data.
                </p>
                <p className="small muted" style={{ margin: 0 }}>
                  {zoneData.zones.filter((z) => z.precision === 'approximate').length} zones have no published open
                  boundary and are drawn as approximate discs (dashed on the map). This is a planning tool, not
                  legal advice &mdash; check the authority before you buy.
                </p>
                {zoneData.failures.length > 0 && (
                  <div className="note warn">
                    {zoneData.failures.length} source(s) failed to fetch at build time and are missing from the
                    map: {zoneData.failures.map((f) => f.name).join(', ')}.
                  </div>
                )}
              </section>
            )}
          </aside>

          <div className="map-pane">
            <MapView zones={zones} impacts={result?.impacts ?? []} timeline={timeline} focusZoneId={focusZoneId} />
            {!timeline && (
              <div className="map-overlay small secondary">
                Every low-emission, clean-air and congestion zone in the UK is shown. Load your Timeline
                export to see which ones you actually drive through.
              </div>
            )}
          </div>
        </div>
      ) : (
        <Catalogue zones={zones} />
      )}
    </div>
  )
}
