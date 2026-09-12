import { useEffect, useMemo, useState } from 'react'
import { FUEL_LABELS, inferEuro } from '../lib/emissions'
import type { Fuel, Zone } from '../lib/types'

/** One row of the flattened catalogue, as written by scripts/build-catalogue.mjs. */
interface Row {
  id: string
  make: string
  model: string
  generation: string | null
  yearFrom: number | null
  yearTo: number | null
  body: string
  fuel: string
  engine: string
  engineCc: number | null
  gearbox: string
  gears: number | null
  transmission: string
  drivetrain: string
  trims: string[]
  provenance: string
  euro?: string | null
  power?: string | null
}

interface CatalogueData {
  generatedAt: string
  counts: { total: number; seed: number; imported: number }
  facets: { makes: string[]; bodies: string[]; fuels: string[]; gearboxes: string[]; drivetrains: string[] }
  rows: Row[]
}

const ANY = ''
const titleCase = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

const DRIVETRAIN_LABELS: Record<string, string> = {
  fwd: 'Front-wheel drive',
  rwd: 'Rear-wheel drive',
  awd: 'All-wheel drive',
}

interface Props {
  /** Used to work out whether a given model year would be zone-compliant. */
  zones: Zone[]
}

export default function Catalogue({ zones }: Props) {
  const [data, setData] = useState<CatalogueData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [q, setQ] = useState('')
  const [make, setMake] = useState(ANY)
  const [body, setBody] = useState(ANY)
  const [fuel, setFuel] = useState(ANY)
  const [gearbox, setGearbox] = useState(ANY)
  const [drivetrain, setDrivetrain] = useState(ANY)
  const [minYear, setMinYear] = useState('')
  const [ulezOnly, setUlezOnly] = useState(false)

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/catalogue.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((e: Error) => setError(e.message))
  }, [])

  /**
   * The earliest registration year that clears every active car-charging zone, per
   * fuel. Diesel is the one that bites: Euro 6 only became mandatory in Sept 2015.
   */
  const compliantFrom = useMemo(() => {
    const out: Record<string, number> = {}
    for (const f of Object.keys(FUEL_LABELS) as Fuel[]) {
      // Walk years forward until a car of that year clears everything.
      for (let y = 1995; y <= 2026; y++) {
        const euro = inferEuro(f, `${y}-06-01`)
        const ok = zones.every((z) => {
          if (!z.affectsCars || !z.emissionsBased || z.status !== 'active') return true
          const need = f === 'diesel' || f === 'hybrid-diesel' ? z.standards?.diesel : z.standards?.petrol
          if (!need) return true
          return EURO_RANK(euro) >= EURO_RANK(need)
        })
        if (ok) {
          out[f] = y
          break
        }
      }
    }
    return out
  }, [zones])

  const rows = useMemo(() => {
    if (!data) return []
    const needle = q.trim().toLowerCase()
    const min = Number(minYear) || 0

    return data.rows.filter((r) => {
      if (make && r.make !== make) return false
      if (body && r.body !== body) return false
      if (fuel && r.fuel !== fuel) return false
      if (gearbox && r.gearbox !== gearbox) return false
      if (drivetrain && r.drivetrain !== drivetrain) return false
      if (min && (r.yearTo ?? 2100) < min) return false
      if (ulezOnly) {
        const from = compliantFrom[r.fuel]
        // Keep the row if the generation was still on sale once it was compliant.
        if (from === undefined) return false
        if ((r.yearTo ?? 2100) < from) return false
      }
      if (needle) {
        const hay = `${r.make} ${r.model} ${r.generation ?? ''} ${r.engine} ${r.trims.join(' ')}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
  }, [data, q, make, body, fuel, gearbox, drivetrain, minYear, ulezOnly, compliantFrom])

  if (error) {
    return (
      <div className="catalogue">
        <div className="note warn">
          Could not load the catalogue ({error}). Run <code>npm run data:catalogue</code> to generate{' '}
          <code>public/data/catalogue.json</code>.
        </div>
      </div>
    )
  }
  if (!data) return <div className="catalogue empty">Loading catalogue&hellip;</div>

  return (
    <div className="catalogue">
      <div className="stack" style={{ marginBottom: 14 }}>
        <div className="row wrap" style={{ justifyContent: 'space-between' }}>
          <h2>UK models, engines and trims</h2>
          <span className="small muted">
            {rows.length.toLocaleString()} of {data.rows.length.toLocaleString()} variants
          </span>
        </div>
        <p className="small secondary" style={{ margin: 0, maxWidth: 720 }}>
          Browse by specification rather than by what happens to be for sale, then take the shortlist to the
          listings. Rows marked <em>seed</em> are hand-entered at generation level and are a starting point,
          not a spec sheet &mdash; verify the individual car. Drop your own CSVs into <code>data/manual/</code>{' '}
          and re-run <code>npm run data:catalogue</code> to extend it.
        </p>
      </div>

      <div className="filters">
        <label className="field wide">
          Search
          <input
            type="search"
            placeholder="Golf, TDI, ST-Line&hellip;"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>

        <Select label="Make" value={make} onChange={setMake} options={data.facets.makes} />
        <Select label="Shape" value={body} onChange={setBody} options={data.facets.bodies} format={titleCase} />
        <Select
          label="Fuel"
          value={fuel}
          onChange={setFuel}
          options={data.facets.fuels}
          format={(f) => FUEL_LABELS[f as Fuel] ?? titleCase(f)}
        />
        <Select label="Gearbox" value={gearbox} onChange={setGearbox} options={data.facets.gearboxes} format={titleCase} />
        <Select
          label="Drive"
          value={drivetrain}
          onChange={setDrivetrain}
          options={data.facets.drivetrains}
          format={(d) => DRIVETRAIN_LABELS[d] ?? d.toUpperCase()}
        />

        <label className="field" style={{ width: 110 }}>
          On sale from
          <input type="number" placeholder="e.g. 2016" value={minYear} onChange={(e) => setMinYear(e.target.value)} />
        </label>

        <label className="check" style={{ paddingBottom: 8 }}>
          <input type="checkbox" checked={ulezOnly} onChange={(e) => setUlezOnly(e.target.checked)} />
          <span>Zone-compliant only</span>
        </label>

        <button
          className="ghost"
          style={{ marginBottom: 8 }}
          onClick={() => {
            setQ('')
            setMake(ANY)
            setBody(ANY)
            setFuel(ANY)
            setGearbox(ANY)
            setDrivetrain(ANY)
            setMinYear('')
            setUlezOnly(false)
          }}
        >
          Reset
        </button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Make &amp; model</th>
              <th>Years</th>
              <th>Engine</th>
              <th>Fuel</th>
              <th>Gearbox</th>
              <th>Drive</th>
              <th>Shape</th>
              <th>UK trims</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 400).map((r) => (
              <tr key={r.id}>
                <td>
                  <strong>
                    {r.make} {r.model}
                  </strong>
                  {r.generation && <span className="muted"> {r.generation}</span>}
                </td>
                <td className="num">
                  {r.yearFrom ?? '?'}&ndash;{r.yearTo ?? 'now'}
                </td>
                <td>
                  {r.engine}
                  {r.engineCc ? <span className="muted small"> {r.engineCc}cc</span> : null}
                </td>
                <td>{FUEL_LABELS[r.fuel as Fuel] ?? titleCase(r.fuel)}</td>
                <td>{r.transmission}</td>
                <td>{r.drivetrain ? r.drivetrain.toUpperCase() : '—'}</td>
                <td>{titleCase(r.body)}</td>
                <td>
                  <div className="trim-list">
                    {r.trims.length ? r.trims.map((t) => <span key={t}>{t}</span>) : <span className="muted">—</span>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {rows.length === 0 && <div className="empty">Nothing matches those filters.</div>}
        {rows.length > 400 && (
          <div className="empty small">Showing the first 400 of {rows.length.toLocaleString()}. Narrow the filters.</div>
        )}
      </div>
    </div>
  )
}

function Select({
  label,
  value,
  onChange,
  options,
  format = (s: string) => s,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: string[]
  format?: (s: string) => string
}) {
  return (
    <label className="field">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value={ANY}>Any</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {format(o)}
          </option>
        ))}
      </select>
    </label>
  )
}

const EURO_LIST = ['Euro 1', 'Euro 2', 'Euro 3', 'Euro 4', 'Euro 5', 'Euro 6', 'Euro 6d-TEMP', 'Euro 6d']
const EURO_RANK = (e: string) => EURO_LIST.indexOf(e)
