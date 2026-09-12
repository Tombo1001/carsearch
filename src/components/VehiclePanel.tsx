import type { Fuel, VehicleSpec, Zone } from '../lib/types'
import type { AnalysisOptions } from '../lib/analysis'
import { ADBLUE_NOTE, EURO_ORDER, FUEL_LABELS, earliestCompliantRegistration, inferEuro } from '../lib/emissions'

interface Props {
  vehicle: VehicleSpec
  onVehicle: (v: VehicleSpec) => void
  options: AnalysisOptions
  onOptions: (o: AnalysisOptions) => void
  zones: Zone[]
  hasModeInfo: boolean
}

export default function VehiclePanel({ vehicle, onVehicle, options, onOptions, zones, hasModeInfo }: Props) {
  const inferred = inferEuro(vehicle.fuel, vehicle.registered)
  const isDiesel = vehicle.fuel === 'diesel' || vehicle.fuel === 'hybrid-diesel'
  const earliest = earliestCompliantRegistration(vehicle.fuel, zones)

  return (
    <section className="card stack">
      <h3>2 &middot; The car you are considering</h3>

      <div className="row">
        <label className="field">
          Fuel
          <select value={vehicle.fuel} onChange={(e) => onVehicle({ ...vehicle, fuel: e.target.value as Fuel })}>
            {(Object.keys(FUEL_LABELS) as Fuel[]).map((f) => (
              <option key={f} value={f}>
                {FUEL_LABELS[f]}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          First registered
          <input
            type="date"
            value={vehicle.registered}
            max="2030-12-31"
            onChange={(e) => onVehicle({ ...vehicle, registered: e.target.value })}
          />
        </label>
      </div>

      <label className="field">
        Euro standard
        <select
          value={vehicle.euroOverride ?? ''}
          onChange={(e) => onVehicle({ ...vehicle, euroOverride: e.target.value || null })}
        >
          <option value="">Work it out from the date ({inferred})</option>
          {EURO_ORDER.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
      </label>

      {earliest && (
        <div className="note">
          To clear every active car-charging zone on a {FUEL_LABELS[vehicle.fuel].toLowerCase()}, you want one
          first registered on or after <strong>{new Date(earliest).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</strong>.
        </div>
      )}

      {isDiesel && <p className="small muted" style={{ margin: 0 }}>{ADBLUE_NOTE}</p>}

      <hr style={{ border: 0, borderTop: '1px solid var(--hairline)', margin: '2px 0' }} />

      <h3>Analysis options</h3>

      <label className="check">
        <input
          type="checkbox"
          checked={options.drivingOnly}
          disabled={!hasModeInfo}
          onChange={(e) => onOptions({ ...options, drivingOnly: e.target.checked })}
        />
        <span>
          Only count driving
          <br />
          <span className="small muted">
            {hasModeInfo
              ? 'Ignores walking, cycling and public transport, so a train through central London does not read as a charge.'
              : 'Unavailable: this export carries no activity types.'}
          </span>
        </span>
      </label>

      <label className="check">
        <input
          type="checkbox"
          checked={options.interpolate}
          onChange={(e) => onOptions({ ...options, interpolate: e.target.checked })}
        />
        <span>
          Fill gaps between fixes
          <br />
          <span className="small muted">
            Samples along a straight line between consecutive positions. Without this, driving through a
            small zone between two fixes is missed entirely.
          </span>
        </span>
      </label>

      <label className="check">
        <input
          type="checkbox"
          checked={options.statuses.includes('proposed')}
          onChange={(e) =>
            onOptions({
              ...options,
              statuses: e.target.checked ? ['active', 'proposed'] : options.statuses.filter((s) => s !== 'proposed'),
            })
          }
        />
        <span>
          Include proposed zones
          <br />
          <span className="small muted">
            Nothing is listed as proposed right now &mdash; add them in scripts/zone-sources.mjs as they are
            announced.
          </span>
        </span>
      </label>
    </section>
  )
}
