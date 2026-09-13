import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { FUEL_LABELS, inferEuro } from '../lib/emissions'
import type { Fuel, Zone } from '../lib/types'

/** One catalogue row, rebuilt from the columnar file written by scripts/build-catalogue.mjs. */
interface Row {
  make: string
  model: string
  /** DVLA's model string, e.g. "FIESTA ZETEC TURBO". Register rows only. */
  variant: string | null
  generation: string | null
  yearFrom: number | null
  yearTo: number | null
  body: string | null
  fuel: string
  engine: string | null
  engineCc: number | null
  gearbox: string | null
  transmission: string | null
  drivetrain: string | null
  trims: string[] | null
  /** Licensed cars in the latest DfT year. Register rows only. */
  onRoad: number | null
  euro: string | null
  provenance: string
  /** Lower-cased search text, built once rather than on every keystroke. */
  hay: string
}

interface DftMeta {
  page: string
  releaseUpdatedAt: string
  onRoadAsOf: string
  minOnRoad: number
  licence: string
}

interface CatalogueFile {
  version: number
  generatedAt: string
  counts: { total: number; seed: number; dft: number; imported: number }
  sources: { dft: DftMeta | null }
  facets: { makes: string[]; bodies: string[]; fuels: string[]; gearboxes: string[]; drivetrains: string[] }
  columns: string[]
  rows: unknown[][]
}

type Source = '' | 'dft' | 'seed' | 'csv'
type Sort = 'common' | 'newest' | 'az'

const ANY = ''
/** Rendering more than this is slow and nobody scrolls it; narrowing the filters is the answer. */
const SHOW = 400

const titleCase = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

const DRIVETRAIN_LABELS: Record<string, string> = {
  fwd: 'Front-wheel drive',
  rwd: 'Rear-wheel drive',
  awd: 'All-wheel drive',
}

const SOURCE_LABELS: Record<Exclude<Source, ''>, string> = {
  dft: 'On UK roads (DfT register)',
  seed: 'Detailed (hand-entered)',
  csv: 'Your CSVs',
}

function toRows(file: CatalogueFile): Row[] {
  const at = Object.fromEntries(file.columns.map((c, i) => [c, i]))
  return file.rows.map((r) => {
    const row = Object.fromEntries(file.columns.map((c) => [c, r[at[c]] ?? null])) as unknown as Row
    row.hay = [row.make, row.model, row.variant, row.generation, row.engine, ...(row.trims ?? [])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return row
  })
}

const sourceOf = (r: Row): Exclude<Source, ''> =>
  r.provenance === 'dft' ? 'dft' : r.provenance === 'seed' ? 'seed' : 'csv'

interface Props {
  /** Used to work out whether a given model year would be zone-compliant. */
  zones: Zone[]
}

export default function Catalogue({ zones }: Props) {
  const [file, setFile] = useState<CatalogueFile | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [q, setQ] = useState('')
  const [make, setMake] = useState(ANY)
  const [body, setBody] = useState(ANY)
  const [fuel, setFuel] = useState(ANY)
  const [gearbox, setGearbox] = useState(ANY)
  const [drivetrain, setDrivetrain] = useState(ANY)
  const [source, setSource] = useState<Source>(ANY)
  const [minYear, setMinYear] = useState('')
  const [ulezOnly, setUlezOnly] = useState(false)
  const [sort, setSort] = useState<Sort>('common')

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/catalogue.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((f: CatalogueFile) => {
        if (f.version !== 2) throw new Error('catalogue.json is an older format; run npm run data:catalogue')
        setFile(f)
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  const all = useMemo(() => (file ? toRows(file) : []), [file])

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

  // Typing into search re-filters ~30k rows; deferring keeps the input itself responsive.
  const needle = useDeferredValue(q.trim().toLowerCase())

  const rows = useMemo(() => {
    const min = Number(minYear) || 0
    const hits = all.filter((r) => {
      if (make && r.make !== make) return false
      if (body && r.body !== body) return false
      if (fuel && r.fuel !== fuel) return false
      if (gearbox && r.gearbox !== gearbox) return false
      if (drivetrain && r.drivetrain !== drivetrain) return false
      if (source && sourceOf(r) !== source) return false
      if (min && (r.yearTo ?? 2100) < min) return false
      if (ulezOnly) {
        const from = compliantFrom[r.fuel]
        // Keep the row if cars of it were still being registered once they were compliant.
        if (from === undefined) return false
        if ((r.yearTo ?? 2100) < from) return false
      }
      if (needle && !needle.split(/\s+/).every((w) => r.hay.includes(w))) return false
      return true
    })

    const cmp: Record<Sort, (a: Row, b: Row) => number> = {
      // Register rows carry a real count; hand-entered rows have none, so they sort after.
      common: (a, b) => (b.onRoad ?? -1) - (a.onRoad ?? -1),
      newest: (a, b) => (b.yearTo ?? 9999) - (a.yearTo ?? 9999) || (b.yearFrom ?? 0) - (a.yearFrom ?? 0),
      az: (a, b) =>
        a.make.localeCompare(b.make) || a.model.localeCompare(b.model) || (a.variant ?? '').localeCompare(b.variant ?? ''),
    }
    return hits.sort(cmp[sort])
  }, [all, needle, make, body, fuel, gearbox, drivetrain, source, minYear, ulezOnly, compliantFrom, sort])

  const reset = () => {
    setQ('')
    setMake(ANY)
    setBody(ANY)
    setFuel(ANY)
    setGearbox(ANY)
    setDrivetrain(ANY)
    setSource(ANY)
    setMinYear('')
    setUlezOnly(false)
    setSort('common')
  }

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
  if (!file) return <div className="catalogue empty">Loading catalogue&hellip;</div>

  const dft = file.sources.dft
  const detailFilterOn = Boolean(body || gearbox || drivetrain)

  return (
    <div className="catalogue">
      <div className="stack" style={{ marginBottom: 14 }}>
        <div className="row wrap" style={{ justifyContent: 'space-between' }}>
          <h2>Cars on UK roads</h2>
          <span className="small muted">
            {rows.length.toLocaleString()} of {all.length.toLocaleString()} variants
          </span>
        </div>
        <p className="small secondary" style={{ margin: 0, maxWidth: 780 }}>
          Every car model with at least {dft?.minOnRoad ?? 50} still licensed in the UK, from the DVLA register,
          plus hand-entered detail for popular generations. Browse by specification rather than by what happens
          to be for sale, then take the shortlist to the listings.
        </p>
        <p className="small muted" style={{ margin: 0, maxWidth: 780 }}>
          <strong>Years</strong> on register rows are when cars of that model were first registered, which is
          what decides a car&rsquo;s likely Euro standard. They are per DVLA model name, not per engine. DVLA
          records engine size in 100&nbsp;cc bands and does not record body shape; gearbox and drive are shown
          only where the model name says so. Verify the individual car.
        </p>
      </div>

      <div className="filters">
        <label className="field wide">
          Search
          <input
            type="search"
            placeholder="Golf TDI, 320d, Model 3&hellip;"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>

        <Select label="Make" value={make} onChange={setMake} options={file.facets.makes} />
        <Select
          label="Fuel"
          value={fuel}
          onChange={setFuel}
          options={file.facets.fuels}
          format={(f) => FUEL_LABELS[f as Fuel] ?? titleCase(f)}
        />
        <Select label="Shape" value={body} onChange={setBody} options={file.facets.bodies} format={titleCase} />
        <Select label="Gearbox" value={gearbox} onChange={setGearbox} options={file.facets.gearboxes} format={titleCase} />
        <Select
          label="Drive"
          value={drivetrain}
          onChange={setDrivetrain}
          options={file.facets.drivetrains}
          format={(d) => DRIVETRAIN_LABELS[d] ?? d.toUpperCase()}
        />
        <Select
          label="Source"
          value={source}
          onChange={(v) => setSource(v as Source)}
          options={(['dft', 'seed', 'csv'] as const).filter((s) => s !== 'csv' || file.counts.imported > 0)}
          format={(s) => SOURCE_LABELS[s as Exclude<Source, ''>]}
        />

        <label className="field" style={{ width: 110 }}>
          Available from
          <input type="number" placeholder="e.g. 2016" value={minYear} onChange={(e) => setMinYear(e.target.value)} />
        </label>

        <label className="field" style={{ width: 140 }}>
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="common">Most common</option>
            <option value="newest">Newest</option>
            <option value="az">Make A&ndash;Z</option>
          </select>
        </label>

        <label className="check" style={{ paddingBottom: 8 }}>
          <input type="checkbox" checked={ulezOnly} onChange={(e) => setUlezOnly(e.target.checked)} />
          <span>Zone-compliant only</span>
        </label>

        <button className="ghost" style={{ marginBottom: 8 }} onClick={reset}>
          Reset
        </button>
      </div>

      {detailFilterOn && (
        <div className="note" style={{ marginBottom: 12, maxWidth: 780 }}>
          Shape, gearbox and drive filters only match cars whose data records them, so most register rows are
          hidden while one is set.
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Make &amp; model</th>
              <th>Years</th>
              <th>Engine</th>
              <th>Fuel</th>
              <th>Gearbox &amp; drive</th>
              <th>Shape</th>
              <th className="num" title={dft ? `Licensed cars, ${dft.onRoadAsOf}` : undefined}>
                On the road
              </th>
              <th>UK trims</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, SHOW).map((r, i) => (
              <tr key={`${r.provenance}|${r.make}|${r.model}|${r.variant ?? r.generation}|${r.engine}|${r.transmission}|${i}`}>
                <td>
                  <strong>
                    {r.make} {r.model}
                  </strong>
                  {r.generation && <span className="muted"> {r.generation}</span>}
                  {r.variant && <div className="variant">{r.variant}</div>}
                </td>
                <td className="num">
                  {r.yearFrom ?? '?'}&ndash;{r.yearTo ?? 'now'}
                </td>
                <td>
                  {r.engine ?? <span className="muted">&mdash;</span>}
                  {r.engineCc ? <span className="muted small"> {r.engineCc}cc</span> : null}
                </td>
                <td>{FUEL_LABELS[r.fuel as Fuel] ?? titleCase(r.fuel)}</td>
                <td>
                  {[r.transmission || (r.gearbox && titleCase(r.gearbox)), r.drivetrain?.toUpperCase()]
                    .filter(Boolean)
                    .join(', ') || <span className="muted">&mdash;</span>}
                </td>
                <td>{r.body ? titleCase(r.body) : <span className="muted">&mdash;</span>}</td>
                <td className="num">{r.onRoad !== null ? r.onRoad.toLocaleString() : <span className="muted">&mdash;</span>}</td>
                <td>
                  {r.trims?.length ? (
                    <div className="trim-list">
                      {r.trims.map((t) => (
                        <span key={t}>{t}</span>
                      ))}
                    </div>
                  ) : (
                    <span className="muted">&mdash;</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {rows.length === 0 && <div className="empty">Nothing matches those filters.</div>}
        {rows.length > SHOW && (
          <div className="empty small">
            Showing the first {SHOW} of {rows.length.toLocaleString()}. Narrow the filters.
          </div>
        )}
      </div>

      {dft && (
        <p className="small muted" style={{ margin: '12px 0 0' }}>
          Register data:{' '}
          <a href={dft.page} target="_blank" rel="noopener noreferrer">
            DfT vehicle licensing statistics
          </a>
          , licensed cars at the {dft.onRoadAsOf}, release published{' '}
          {new Date(dft.releaseUpdatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.
          Contains public sector information licensed under the {dft.licence}.
        </p>
      )}
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
  options: readonly string[]
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
