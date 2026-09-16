import { MAP_FUELS, weekChange, type FuelData, type MapFuel } from '../lib/fuel'

interface Props {
  data: FuelData
  enabled: boolean
  onEnabled: (on: boolean) => void
  fuel: MapFuel
  onFuel: (fuel: MapFuel) => void
  /** Labels are hidden past city zoom; say so rather than leave the user guessing. */
  zoomedIn: boolean
}

const pence = (n: number | null | undefined) => (n == null ? 'n/a' : `${n.toFixed(1)}p`)

/**
 * The on/off switch and key for the regional fuel price overlay. The region list
 * is the accessible version of the map labels, and the fallback whenever a label
 * cannot be placed without covering a zone.
 */
export default function FuelControl({ data, enabled, onEnabled, fuel, onFuel, zoomedIn }: Props) {
  const updated = new Date(data.newestPrice ?? data.generatedAt)
  const staleDays = Math.floor((Date.now() - Date.parse(data.generatedAt)) / 86_400_000)
  const uk = data.uk[fuel]?.median
  const rows = [...data.regions].sort((a, b) => (a.prices[fuel]?.median ?? 999) - (b.prices[fuel]?.median ?? 999))

  return (
    <div className="fuel-control small">
      <label className="check" style={{ alignItems: 'center' }}>
        <input type="checkbox" checked={enabled} onChange={(e) => onEnabled(e.target.checked)} />
        <span>
          <strong>Fuel prices</strong>
        </span>
      </label>

      {enabled && (
        <div className="stack" style={{ gap: 6, marginTop: 6 }}>
          <div className="segmented" role="radiogroup" aria-label="Fuel">
            {MAP_FUELS.map((f) => (
              <button key={f.key} role="radio" aria-checked={fuel === f.key} onClick={() => onFuel(f.key)}>
                {f.label}
              </button>
            ))}
          </div>

          <div className="secondary">
            Median pump price by region. UK {pence(uk)}.
            <br />
            <span className="muted">
              Prices to{' '}
              {updated.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>

          {staleDays >= 3 && (
            <div className="note warn" style={{ margin: 0 }}>
              These prices are {staleDays} days old. The daily update has not run since.
            </div>
          )}

          {zoomedIn && <div className="muted">Zoom out to see regional prices on the map.</div>}

          <details>
            <summary style={{ cursor: 'pointer' }}>All regions, cheapest first</summary>
            <table className="fuel-table">
              <tbody>
                {rows.map((r) => {
                  const s = r.prices[fuel]
                  const week = weekChange(data, r.code, fuel)
                  return (
                    <tr key={r.code} title={s ? `${r.fullName}: ${s.n.toLocaleString()} forecourts` : r.fullName}>
                      <td>{r.name}</td>
                      <td className="num">{pence(s?.median)}</td>
                      <td className="num muted">{week === null ? '' : `${week > 0 ? '+' : ''}${week.toFixed(1)} wk`}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </details>

          <div className="muted">
            Source:{' '}
            <a href={data.source.url} target="_blank" rel="noopener noreferrer">
              {data.source.name}
            </a>
            , {data.stations.toLocaleString()} open forecourts. Regions: ONS.
          </div>
        </div>
      )}
    </div>
  )
}
