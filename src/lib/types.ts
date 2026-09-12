/** Shared types. Zone shapes mirror what scripts/build-zones.mjs writes. */

export type ZoneKind = 'ULEZ' | 'LEZ' | 'CAZ' | 'CCZ'
export type ZoneStatus = 'active' | 'proposed' | 'withdrawn'
export type Enforcement = 'charge' | 'penalty' | 'none'
export type Precision = 'official' | 'approximate'

/** A GeoJSON MultiPolygon coordinate array: polygon -> ring -> position. */
export type MultiPolygonCoords = number[][][][]

export interface Zone {
  id: string
  name: string
  authority: string
  country: string
  kind: ZoneKind
  cazClass?: string
  status: ZoneStatus
  liveFrom: string | null
  affectsCars: boolean
  /** False for the Congestion Charge: it costs the same whatever you drive. */
  emissionsBased: boolean
  enforcement: Enforcement
  carDailyCharge: number
  penalty: { amount: number; reducedAmount?: number; note?: string } | null
  hours: string
  standards: { petrol?: string; diesel?: string; hgv?: string } | null
  notes?: string
  precision: Precision
  source: { name: string; url: string; licence: string }
  bbox: [number, number, number, number]
  geometry: MultiPolygonCoords
}

export interface ZoneData {
  generatedAt: string
  chargesAsOf: string
  simplifiedToMetres: number
  zones: Zone[]
  failures: { id: string; name: string; error: string }[]
}

// ------------------------------------------------------------------ travel --

export interface TrackPoint {
  lat: number
  lon: number
  /** Epoch milliseconds. */
  t: number
}

export type TravelMode = 'driving' | 'other' | 'unknown'

/** A contiguous run of positions. For raw exports this is one big synthetic segment. */
export interface Segment {
  points: TrackPoint[]
  mode: TravelMode
  /** Verbatim activity label from the export, when there is one. */
  rawMode?: string
}

export type TimelineFormat =
  | 'records'
  | 'semantic-location-history'
  | 'phone-timeline'
  | 'unknown'

export interface ParsedTimeline {
  format: TimelineFormat
  segments: Segment[]
  pointCount: number
  /** True when at least one segment carries a real activity type. */
  hasModeInfo: boolean
  /** Epoch ms bounds across everything parsed. */
  from: number | null
  to: number | null
  warnings: string[]
}

// ---------------------------------------------------------------- vehicles --

export type Fuel = 'petrol' | 'diesel' | 'hybrid-petrol' | 'hybrid-diesel' | 'phev' | 'bev' | 'lpg'

export interface VehicleSpec {
  fuel: Fuel
  /** ISO date of first registration, used to infer the Euro standard. */
  registered: string
  /** Set when you know it, overriding the date-based guess. */
  euroOverride?: string | null
}

export interface Compliance {
  compliant: boolean
  euro: string
  requiredEuro: string | null
  /** Why we think so, for display. */
  reason: string
  inferred: boolean
}

// ---------------------------------------------------------------- analysis --

export interface ZoneImpact {
  zone: Zone
  /** Distinct local dates on which you were inside the zone. */
  daysInside: number
  /** Sorted ISO local dates. */
  dates: string[]
  /** Cost over the analysed window. */
  cost: number
  /** True where entry is banned rather than charged (Scotland). */
  blocked: boolean
  /** True for the Congestion Charge: you pay this whatever car you buy. */
  ageIndependent: boolean
  compliance: Compliance
}

export interface AnalysisResult {
  impacts: ZoneImpact[]
  /** Days covered by the export, used to scale to a year. */
  spanDays: number
  /** Cost you would only pay because the car is older. */
  totalCost: number
  annualisedCost: number
  /** Cost you would pay in any car, e.g. the Congestion Charge. */
  ageIndependentCost: number
  blockedDays: number
  /** Positions actually tested, after mode filtering. */
  testedPoints: number
}
