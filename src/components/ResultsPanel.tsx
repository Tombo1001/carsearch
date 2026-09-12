import type { AnalysisResult, ZoneImpact } from '../lib/types'
import { STATUS_COLOURS, zoneStatusKey } from './MapView'

const money = (n: number) => `£${n.toLocaleString('en-GB', { maximumFractionDigits: 0 })}`

/**
 * Status is never conveyed by colour alone: each row gets a worded badge, and the
 * legend below spells out what each fill means.
 */
function StatusBadge({ impact }: { impact: ZoneImpact }) {
  const key = zoneStatusKey(impact, impact.zone)
  const label = impact.blocked
    ? 'Banned'
    : !impact.zone.affectsCars
      ? 'Not cars'
      : impact.ageIndependent
        ? 'Any car pays'
        : impact.cost > 0
          ? 'You pay'
          : 'Free'
  return (
    <span className={`badge ${key}`}>
      <span className="dot" />
      {label}
    </span>
  )
}

interface Props {
  result: AnalysisResult | null
  progress: { done: number; total: number } | null
  onFocusZone: (id: string) => void
}

export default function ResultsPanel({ result, progress, onFocusZone }: Props) {
  if (progress && progress.done < progress.total) {
    const pct = Math.round((progress.done / Math.max(1, progress.total)) * 100)
    return (
      <section className="card stack">
        <h3>3 &middot; What it would cost</h3>
        <div className="progress">
          <div style={{ width: `${pct}%` }} />
        </div>
        <div className="small muted">
          Checking {progress.done.toLocaleString()} of {progress.total.toLocaleString()} positions&hellip;
        </div>
      </section>
    )
  }

  if (!result) {
    return (
      <section className="card stack">
        <h3>3 &middot; What it would cost</h3>
        <p className="small muted" style={{ margin: 0 }}>
          Load a Timeline export above and this fills in.
        </p>
        <Legend />
      </section>
    )
  }

  const { impacts, spanDays, totalCost, annualisedCost, ageIndependentCost, blockedDays } = result
  const charged = impacts.filter((i) => !i.ageIndependent && (i.cost > 0 || i.blocked))

  return (
    <section className="card stack">
      <h3>3 &middot; What it would cost</h3>

      <div className="tiles">
        <div className={`tile ${totalCost > 0 || blockedDays > 0 ? 'costly' : 'clear'}`}>
          <div className="value">{money(totalCost)}</div>
          <div className="label">Over {spanDays} days</div>
          <div className="sub">Only because of the car's age</div>
        </div>

        <div className={`tile ${annualisedCost > 0 ? 'costly' : 'clear'}`}>
          <div className="value">{money(annualisedCost)}</div>
          <div className="label">Per year</div>
          <div className="sub">If this period is typical</div>
        </div>

        {blockedDays > 0 && (
          <div className="tile span costly">
            <div className="value">{blockedDays}</div>
            <div className="label">Days you could not have driven</div>
            <div className="sub">
              Scottish LEZs do not charge &mdash; a non-compliant car is banned outright, so these journeys
              simply could not happen in this car.
            </div>
          </div>
        )}

        {ageIndependentCost > 0 && (
          <div className="tile span">
            <div className="value">{money(ageIndependentCost)}</div>
            <div className="label">Payable in any car</div>
            <div className="sub">
              Congestion Charge and similar. Age-blind, so it does not count towards the old-versus-new
              decision above.
            </div>
          </div>
        )}
      </div>

      {totalCost === 0 && blockedDays === 0 && (
        <div className="note">
          On this history, an older car would not have cost you anything extra. Worth sanity-checking that
          the export really covers your normal driving before you act on it.
        </div>
      )}

      {charged.length > 0 && (
        <div className="note warn">
          {charged.length === 1 ? 'One zone drives' : `${charged.length} zones drive`} this cost. If those trips
          are occasional, compare the total against what a compliant car costs to buy.
        </div>
      )}

      {impacts.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Zone</th>
              <th></th>
              <th className="num">Days</th>
              <th className="num">Cost</th>
            </tr>
          </thead>
          <tbody>
            {impacts.map((i) => (
              <tr key={i.zone.id} onClick={() => onFocusZone(i.zone.id)} style={{ cursor: 'pointer' }}>
                <td>
                  {i.zone.name}
                  {i.zone.precision === 'approximate' && (
                    <>
                      <br />
                      <span className="small muted">approximate boundary</span>
                    </>
                  )}
                </td>
                <td>
                  <StatusBadge impact={i} />
                </td>
                <td className="num">{i.daysInside}</td>
                <td className="num">{i.blocked ? 'n/a' : i.cost > 0 ? money(i.cost) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {impacts.length === 0 && (
        <p className="small muted" style={{ margin: 0 }}>
          None of your positions fell inside any zone.
        </p>
      )}

      <Legend />
    </section>
  )
}

function Legend() {
  return (
    <div className="legend">
      <div className="item">
        <span className="swatch" style={{ background: `${STATUS_COLOURS.costly}4d`, borderColor: STATUS_COLOURS.costly }} />
        Costs you money, or bans you, because of the car's age
      </div>
      <div className="item">
        <span className="swatch" style={{ background: `${STATUS_COLOURS.flat}4d`, borderColor: STATUS_COLOURS.flat }} />
        Charged whatever you drive (Congestion Charge)
      </div>
      <div className="item">
        <span className="swatch" style={{ background: `${STATUS_COLOURS.clear}4d`, borderColor: STATUS_COLOURS.clear }} />
        Free for this car, or does not apply to cars
      </div>
      <div className="item">
        <span
          className="swatch"
          style={{ background: 'transparent', borderColor: 'var(--text-muted)', borderStyle: 'dashed' }}
        />
        Dashed edge: approximate boundary, no open data published
      </div>
    </div>
  )
}
