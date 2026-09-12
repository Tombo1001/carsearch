import type { Compliance, Fuel, VehicleSpec, Zone } from './types'

/** Euro standards in order, so they can be compared with an index. */
export const EURO_ORDER = ['Euro 1', 'Euro 2', 'Euro 3', 'Euro 4', 'Euro 5', 'Euro 6', 'Euro 6d-TEMP', 'Euro 6d']

export const FUEL_LABELS: Record<Fuel, string> = {
  petrol: 'Petrol',
  diesel: 'Diesel',
  'hybrid-petrol': 'Hybrid (petrol)',
  'hybrid-diesel': 'Hybrid (diesel)',
  phev: 'Plug-in hybrid',
  bev: 'Electric',
  lpg: 'LPG / bi-fuel',
}

/**
 * When each standard became mandatory for newly registered cars in the UK.
 * Diesel and petrol diverge: the Euro 6 diesel cut-off is the one that decides
 * whether a used diesel is ULEZ-free, and it is late (September 2015).
 */
const PETROL_STEPS: [string, string][] = [
  ['2021-01-01', 'Euro 6d'],
  ['2019-09-01', 'Euro 6d-TEMP'],
  ['2015-09-01', 'Euro 6'],
  ['2011-01-01', 'Euro 5'],
  ['2006-01-01', 'Euro 4'],
  ['2001-01-01', 'Euro 3'],
  ['1997-01-01', 'Euro 2'],
]
const DIESEL_STEPS = PETROL_STEPS

/** Which fuel's rules a vehicle is judged under. */
export function effectiveFuel(fuel: Fuel): 'petrol' | 'diesel' | 'electric' {
  switch (fuel) {
    case 'diesel':
    case 'hybrid-diesel':
      return 'diesel'
    case 'bev':
      return 'electric'
    default:
      return 'petrol'
  }
}

/** Best guess at the Euro standard from the first-registration date. */
export function inferEuro(fuel: Fuel, registered: string): string {
  const eff = effectiveFuel(fuel)
  if (eff === 'electric') return 'Euro 6d'
  const steps = eff === 'diesel' ? DIESEL_STEPS : PETROL_STEPS
  for (const [from, euro] of steps) if (registered >= from) return euro
  return 'Euro 1'
}

const rank = (euro: string) => {
  const i = EURO_ORDER.indexOf(euro)
  // Unknown labels sort last so they never accidentally read as compliant.
  return i === -1 ? -1 : i
}

export function meetsStandard(euro: string, required: string): boolean {
  return rank(euro) >= rank(required)
}

/**
 * Works out whether a vehicle gets into a zone free.
 *
 * The date-based Euro guess is a guess. Real cars straddle the cut-offs in both
 * directions - some 2014 diesels are already Euro 6, and a car registered days
 * after a deadline can have been built before it. Check the V5C or TfL's
 * registration checker before committing.
 */
export function checkCompliance(zone: Zone, vehicle: VehicleSpec): Compliance {
  const inferred = !vehicle.euroOverride
  const euro = vehicle.euroOverride || inferEuro(vehicle.fuel, vehicle.registered)
  const eff = effectiveFuel(vehicle.fuel)

  if (!zone.affectsCars) {
    return { compliant: true, euro, requiredEuro: null, inferred, reason: 'This zone does not apply to cars.' }
  }
  if (!zone.emissionsBased) {
    return {
      compliant: true,
      euro,
      requiredEuro: null,
      inferred,
      reason: 'Not an emissions scheme - the charge is the same whatever you drive.',
    }
  }
  if (eff === 'electric') {
    return { compliant: true, euro, requiredEuro: null, inferred, reason: 'Electric vehicles are exempt.' }
  }

  const required = eff === 'diesel' ? zone.standards?.diesel : zone.standards?.petrol
  if (!required) {
    return { compliant: true, euro, requiredEuro: null, inferred, reason: 'No standard published for this fuel.' }
  }

  const compliant = meetsStandard(euro, required)
  return {
    compliant,
    euro,
    requiredEuro: required,
    inferred,
    reason: compliant
      ? `${euro} meets the ${required} requirement for ${eff}.`
      : `${euro} falls short of the ${required} requirement for ${eff}.`,
  }
}

/**
 * The earliest registration date that would clear every car-affecting emissions zone
 * for a given fuel. This is the "what is the oldest I can safely buy?" answer.
 */
export function earliestCompliantRegistration(fuel: Fuel, zones: Zone[]): string | null {
  const eff = effectiveFuel(fuel)
  if (eff === 'electric') return null

  let toughest = -1
  for (const z of zones) {
    if (!z.affectsCars || !z.emissionsBased || z.status !== 'active') continue
    const required = eff === 'diesel' ? z.standards?.diesel : z.standards?.petrol
    if (required) toughest = Math.max(toughest, rank(required))
  }
  if (toughest < 0) return null

  const steps = eff === 'diesel' ? DIESEL_STEPS : PETROL_STEPS
  // Steps are newest-first; the last one that still clears the bar is the earliest date.
  let answer: string | null = null
  for (const [from, euro] of steps) if (rank(euro) >= toughest) answer = from
  return answer
}

/**
 * AdBlue is a strong hint but not a rule. Most Euro 6 diesels use SCR and so need
 * AdBlue, but some meet Euro 6 with a lean NOx trap instead and have no tank at all.
 */
export const ADBLUE_NOTE =
  'AdBlue is a good rule of thumb for a Euro 6 diesel, not a guarantee. Some Euro 6 diesels ' +
  'use a lean NOx trap and have no AdBlue tank, and a few late Euro 5 vans had SCR. Always ' +
  'check the actual registration date and, ideally, the V5C or TfL vehicle checker.'
