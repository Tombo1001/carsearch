/**
 * Registry of UK low-emission / clean-air / congestion zones.
 *
 * Every entry carries BOTH the policy metadata (what it costs, who it hits, which
 * Euro standard gets you in free) and where the boundary geometry comes from.
 *
 * `geometry.kind`:
 *   'arcgis'   - ArcGIS REST layer, queried as GeoJSON (already WGS84).
 *   'geojson'  - plain GeoJSON file over HTTP, optionally reprojected via `epsg`.
 *   'disc'     - APPROXIMATE circle. Used only where no council publishes an open
 *                boundary. Always paired with precision: 'approximate'.
 *
 * Charges are as at CHARGES_AS_OF and are a modelling input, not legal advice.
 * Re-check before spending money on a car. See docs/data-sources.md.
 */

export const CHARGES_AS_OF = '2026-08-23'

/** Euro standards that let a car in free almost everywhere in the UK. */
const CAR_STANDARD = { petrol: 'Euro 4', diesel: 'Euro 6' }

export const ZONE_SOURCES = [
  // ---------------------------------------------------------------- London --
  {
    id: 'london-ulez',
    name: 'London ULEZ',
    authority: 'Transport for London',
    country: 'England',
    kind: 'ULEZ',
    status: 'active',
    liveFrom: '2023-08-29',
    affectsCars: true,
    emissionsBased: true,
    enforcement: 'charge',
    carDailyCharge: 12.5,
    penalty: { amount: 180, reducedAmount: 90, note: 'Reduced to 90 pounds if paid within 14 days.' },
    hours: '24/7, every day of the year',
    standards: CAR_STANDARD,
    notes:
      'Covers every London borough. Petrol cars generally need to be registered from 2006 to be Euro 4, and diesel cars from September 2015 to be Euro 6.',
    geometry: {
      kind: 'geojson',
      url: 'https://data.london.gov.uk/download/vd455/0cab9a8b-ca8a-47b0-aaf8-0e77a9041a19/LondonWideUltraLowEmissionZone.geojson',
      epsg: 27700,
    },
    precision: 'official',
    source: {
      name: 'London Datastore - London Wide Ultra Low Emission Zone 2023',
      url: 'https://data.london.gov.uk/dataset/london-wide-ultra-low-emission-zone-2023-vd455',
      licence: 'Open Government Licence v2',
    },
  },
  {
    id: 'london-ccz',
    name: 'London Congestion Charge Zone',
    authority: 'Transport for London',
    country: 'England',
    kind: 'CCZ',
    status: 'active',
    liveFrom: '2003-02-17',
    affectsCars: true,
    // Not an emissions scheme: a brand-new diesel pays exactly the same as a 2004 one,
    // so it is excluded from the "would an older car cost me more?" comparison.
    emissionsBased: false,
    enforcement: 'charge',
    carDailyCharge: 18,
    penalty: { amount: 180, reducedAmount: 90 },
    hours: "Mon-Fri 07:00-18:00, Sat-Sun and bank holidays 12:00-18:00 (not Christmas Day to the New Year's Day bank holiday)",
    standards: null,
    notes:
      '21 pounds if paid by midnight on the third day after travel instead of on the day. ' +
      'Shown for context only; it is age-blind, so it does not change the old-versus-new decision.',
    geometry: {
      kind: 'arcgis',
      url: 'https://services1.arcgis.com/YswvgzOodUvqkoCN/arcgis/rest/services/Congestion_Charge_Zone/FeatureServer/8',
    },
    precision: 'official',
    source: {
      name: 'TfL Surface Playbook - Congestion Charge Zone (CLoCCS)',
      url: 'https://services1.arcgis.com/YswvgzOodUvqkoCN/arcgis/rest/services/Congestion_Charge_Zone/FeatureServer',
      licence: 'Open Government Licence (TfL open data)',
    },
  },
  {
    id: 'london-lez',
    name: 'London LEZ',
    authority: 'Transport for London',
    country: 'England',
    kind: 'LEZ',
    status: 'active',
    liveFrom: '2008-02-04',
    // Heavy vehicles only - lorries, buses, coaches, larger vans and minibuses.
    affectsCars: false,
    emissionsBased: true,
    enforcement: 'charge',
    carDailyCharge: 0,
    penalty: { amount: 500, reducedAmount: 250 },
    hours: '24/7, every day of the year',
    standards: { hgv: 'Euro VI' },
    notes:
      'Does not apply to cars. Included so the map is complete and so van buyers can see it. ' +
      'Since the 2023 ULEZ expansion the LEZ and ULEZ cover the same ground, so they share a boundary here.',
    geometry: { kind: 'sameAs', zoneId: 'london-ulez' },
    precision: 'official',
    source: {
      name: 'London Datastore - Low Emission Zone (the ULEZ dataset is the same boundary and is published as GeoJSON)',
      url: 'https://data.london.gov.uk/dataset/low-emission-zone-2kodd',
      licence: 'Open Government Licence v2',
    },
  },

  // -------------------------------------------------- English Clean Air Zones --
  {
    id: 'birmingham-caz',
    name: 'Birmingham Clean Air Zone',
    authority: 'Birmingham City Council',
    country: 'England',
    kind: 'CAZ',
    cazClass: 'D',
    status: 'active',
    liveFrom: '2021-06-01',
    affectsCars: true,
    emissionsBased: true,
    enforcement: 'charge',
    carDailyCharge: 8,
    penalty: { amount: 120, reducedAmount: 60 },
    hours: '24/7, all year round',
    standards: CAR_STANDARD,
    notes:
      'Class D - one of only two English CAZs outside London that charge private cars (the other is Bristol). ' +
      'Everything inside the A4540 Middleway ring road.',
    geometry: {
      kind: 'arcgis',
      url: 'https://maps.birmingham.gov.uk/server/rest/services/CleanAirZone/MapServer/0',
    },
    precision: 'official',
    source: {
      name: 'Birmingham City Council - Clean Air Zone',
      url: 'https://www.data.gov.uk/dataset/07ff3dcd-d770-4414-8c13-4d38cb3e91ed/birmingham-clean-air-zone',
      licence: 'Open Government Licence v3',
    },
  },
  {
    id: 'bristol-caz',
    name: 'Bristol Clean Air Zone',
    authority: 'Bristol City Council',
    country: 'England',
    kind: 'CAZ',
    cazClass: 'D',
    status: 'active',
    liveFrom: '2022-11-28',
    affectsCars: true,
    emissionsBased: true,
    enforcement: 'charge',
    carDailyCharge: 9,
    penalty: { amount: 120, reducedAmount: 60 },
    hours: '24/7, all year round',
    standards: CAR_STANDARD,
    notes: 'Class D - charges private cars.',
    geometry: {
      kind: 'arcgis',
      url: 'https://services2.arcgis.com/a4vR8lmmksFixzmB/arcgis/rest/services/Clean_air_zone_hosted/FeatureServer/0',
    },
    precision: 'official',
    source: {
      name: 'Bristol City Council - Clean Air Zone (ArcGIS)',
      url: 'https://services2.arcgis.com/a4vR8lmmksFixzmB/arcgis/rest/services/Clean_air_zone_hosted/FeatureServer',
      licence: 'Open Government Licence v3',
    },
  },
  {
    id: 'bradford-caz',
    name: 'Bradford Clean Air Zone',
    authority: 'City of Bradford MDC',
    country: 'England',
    kind: 'CAZ',
    cazClass: 'C',
    status: 'active',
    liveFrom: '2022-09-26',
    affectsCars: false,
    emissionsBased: true,
    enforcement: 'charge',
    carDailyCharge: 0,
    penalty: { amount: 120, reducedAmount: 60 },
    hours: '24/7, all year round',
    standards: CAR_STANDARD,
    notes: 'Class C - private cars are not charged. Taxis, LGVs, HGVs, buses and coaches are.',
    geometry: {
      kind: 'arcgis',
      url: 'https://gis.bradford.gov.uk/server/rest/services/Open_Data/Clean_Air_Zone_Boundary/MapServer/0',
    },
    precision: 'official',
    source: {
      name: 'City of Bradford MDC - Clean Air Zone Boundary',
      url: 'https://www.data.gov.uk/dataset/43bf7a5b-51a1-4c85-b5a9-7071da4b240c/clean-air-zone-boundary5',
      licence: 'Open Government Licence v3',
    },
  },
  {
    id: 'sheffield-caz',
    name: 'Sheffield Clean Air Zone',
    authority: 'Sheffield City Council',
    country: 'England',
    kind: 'CAZ',
    cazClass: 'C',
    status: 'active',
    liveFrom: '2023-02-27',
    affectsCars: false,
    emissionsBased: true,
    enforcement: 'charge',
    carDailyCharge: 0,
    penalty: { amount: 120, reducedAmount: 60 },
    hours: '24/7, all year round',
    standards: CAR_STANDARD,
    notes: 'Class C - private cars are not charged.',
    geometry: {
      kind: 'arcgis',
      url: 'https://sheffieldcitycouncil.cloud.esriuk.com/server/rest/services/AGOL/OpenData/MapServer/28',
    },
    precision: 'official',
    source: {
      name: 'Sheffield City Council Open Data - Clean Air Zone Boundary',
      url: 'https://www.data.gov.uk/dataset/6ab87962-cc5e-43c6-85a7-53bf8e693d43/sheffield-clean-air-zone',
      licence: 'Open Government Licence v3',
    },
  },
  {
    id: 'bath-caz',
    name: 'Bath Clean Air Zone',
    authority: 'Bath & North East Somerset Council',
    country: 'England',
    kind: 'CAZ',
    cazClass: 'C',
    status: 'active',
    liveFrom: '2021-03-15',
    affectsCars: false,
    emissionsBased: true,
    enforcement: 'charge',
    carDailyCharge: 0,
    penalty: { amount: 120, reducedAmount: 60 },
    hours: '24/7, all year round',
    standards: CAR_STANDARD,
    notes: 'Class C - private cars are not charged.',
    geometry: { kind: 'disc', centre: [-2.359, 51.381], radiusKm: 0.9 },
    precision: 'approximate',
    source: {
      name: 'Bath & North East Somerset Council (no open boundary found, disc approximation)',
      url: 'https://www.bathnes.gov.uk/baths-clean-air-zone',
      licence: 'n/a - approximation',
    },
  },
  {
    id: 'portsmouth-caz',
    name: 'Portsmouth Clean Air Zone',
    authority: 'Portsmouth City Council',
    country: 'England',
    kind: 'CAZ',
    cazClass: 'B',
    status: 'active',
    liveFrom: '2021-11-29',
    affectsCars: false,
    emissionsBased: true,
    enforcement: 'charge',
    carDailyCharge: 0,
    penalty: { amount: 120, reducedAmount: 60 },
    hours: '24/7, all year round',
    standards: CAR_STANDARD,
    notes: 'Class B - private cars and vans are not charged.',
    geometry: { kind: 'disc', centre: [-1.091, 50.799], radiusKm: 1.1 },
    precision: 'approximate',
    source: {
      name: 'Portsmouth City Council (no open boundary found, disc approximation)',
      url: 'https://cleanerairportsmouth.co.uk/',
      licence: 'n/a - approximation',
    },
  },
  {
    id: 'tyneside-caz',
    name: 'Tyneside Clean Air Zone',
    authority: 'Newcastle & Gateshead Councils',
    country: 'England',
    kind: 'CAZ',
    cazClass: 'C',
    status: 'active',
    liveFrom: '2023-01-30',
    affectsCars: false,
    emissionsBased: true,
    enforcement: 'charge',
    carDailyCharge: 0,
    penalty: { amount: 120, reducedAmount: 60 },
    hours: '24/7, all year round',
    standards: CAR_STANDARD,
    notes: 'Class C - private cars are not charged.',
    geometry: { kind: 'disc', centre: [-1.613, 54.97], radiusKm: 1.7 },
    precision: 'approximate',
    source: {
      name: 'Breathe Clean Air Tyneside (no open boundary found, disc approximation)',
      url: 'https://www.breathe-cleanair.com/',
      licence: 'n/a - approximation',
    },
  },
  {
    id: 'greater-manchester-caz',
    name: 'Greater Manchester CAZ (abandoned)',
    authority: 'Greater Manchester Combined Authority',
    country: 'England',
    kind: 'CAZ',
    status: 'withdrawn',
    liveFrom: null,
    affectsCars: false,
    emissionsBased: true,
    enforcement: 'none',
    carDailyCharge: 0,
    penalty: null,
    hours: 'n/a',
    standards: CAR_STANDARD,
    notes:
      'The charging CAZ was dropped in favour of a non-charging plan. Hidden by default, kept so ' +
      'you can see what was once on the table for the area.',
    geometry: { kind: 'disc', centre: [-2.2426, 53.4808], radiusKm: 18 },
    precision: 'approximate',
    source: { name: 'GMCA Clean Air Plan', url: 'https://cleanairgm.com/', licence: 'n/a - approximation' },
  },

  // ------------------------------------------- Scottish Low Emission Zones --
  // Scotland does not charge for entry. Non-compliant vehicles are banned outright
  // and penalised, so for a driver the practical cost is "you cannot go there".
  ...[
    {
      id: 'glasgow-lez',
      name: 'Glasgow LEZ',
      authority: 'Glasgow City Council',
      liveFrom: '2023-06-01',
      geometry: {
        kind: 'arcgis',
        url: 'https://www.mapping.glasgow.gov.uk/arcgis_web/rest/services/OPEN_DATA/Low_Emission_Zone/MapServer/0',
      },
      precision: 'official',
      source: {
        name: 'Glasgow City Council Open Data - Low Emission Zone',
        url: 'https://www.arcgis.com/home/item.html?id=c15a560be53f45beb0c01f1169b5d8eb',
        licence: 'Open Government Licence v3 / OSMA',
      },
    },
    {
      id: 'edinburgh-lez',
      name: 'Edinburgh LEZ',
      authority: 'City of Edinburgh Council',
      liveFrom: '2024-06-01',
      geometry: {
        kind: 'arcgis',
        url: 'https://services-eu1.arcgis.com/FgpikkYuSUOuITxp/arcgis/rest/services/Low_Emission_Zone/FeatureServer/59',
      },
      precision: 'official',
      source: {
        name: 'City of Edinburgh Council Open Spatial Data - Low Emission Zone',
        url: 'https://city-of-edinburgh-council-open-spatial-data-cityofedinburgh.hub.arcgis.com/',
        licence: 'Open Government Licence v3 / OSMA',
      },
    },
    {
      id: 'dundee-lez',
      name: 'Dundee LEZ',
      authority: 'Dundee City Council',
      liveFrom: '2024-05-30',
      geometry: {
        kind: 'arcgis',
        url: 'https://services.arcgis.com/GlZ1P6ksdiXNYhvC/arcgis/rest/services/LEZ_Boundary/FeatureServer/425',
      },
      precision: 'official',
      source: {
        name: 'Dundee City Council - LEZ Boundary',
        url: 'https://www.arcgis.com/home/item.html?id=2b85845123fe4a46ae42a71bb706f553',
        licence: 'Open Government Licence v3 / OSMA',
      },
    },
    {
      id: 'aberdeen-lez',
      name: 'Aberdeen LEZ',
      authority: 'Aberdeen City Council',
      liveFrom: '2024-06-01',
      geometry: { kind: 'disc', centre: [-2.1, 57.146], radiusKm: 0.8 },
      precision: 'approximate',
      source: {
        name: 'Aberdeen City Council (no open boundary found, disc approximation)',
        url: 'https://www.aberdeencity.gov.uk/Council-Services/roads-parking-and-travel/low-emission-zone-lez',
        licence: 'n/a - approximation',
      },
    },
  ].map((z) => ({
    country: 'Scotland',
    kind: 'LEZ',
    status: 'active',
    affectsCars: true,
    emissionsBased: true,
    enforcement: 'penalty',
    carDailyCharge: 0,
    penalty: {
      amount: 60,
      reducedAmount: 30,
      note: 'Halved if paid within 14 days; doubles for each repeat contravention up to 480 pounds.',
    },
    hours: '24/7, every day of the year',
    standards: CAR_STANDARD,
    notes:
      'Scotland has no daily charge - a non-compliant vehicle is banned outright and penalised. ' +
      'Treat any trip through here in a non-compliant car as "cannot do", not "costs a few pounds".',
    ...z,
  })),
]

/**
 * Proposed / consulted-on zones. Empty by default: as at CHARGES_AS_OF there is no
 * confirmed new UK scheme that would charge private cars. Add entries here in the
 * same shape with status: 'proposed' - the build script and the UI already handle them.
 */
export const PROPOSED_ZONE_SOURCES = []

/**
 * The authority's own public page for each zone: where a driver should go to read
 * the current charges, and what `npm run data:check` watches for changes.
 *
 * Kept apart from `source`, which records where the *boundary data* came from.
 * They were one link before, which meant a map popup could send a driver to a raw
 * ArcGIS endpoint to find out what a zone costs. Every URL here was confirmed to
 * resolve on 2026-09-13; the check re-confirms them weekly.
 */
export const ZONE_INFO = {
  'london-ulez': { name: 'TfL - Ultra Low Emission Zone', url: 'https://tfl.gov.uk/modes/driving/ultra-low-emission-zone' },
  'london-ccz': { name: 'TfL - Congestion Charge', url: 'https://tfl.gov.uk/modes/driving/congestion-charge' },
  'london-lez': { name: 'TfL - Low Emission Zone', url: 'https://tfl.gov.uk/modes/driving/low-emission-zone' },
  'birmingham-caz': { name: 'Brum Breathes - charges and operation', url: 'https://www.brumbreathes.co.uk/info/32/charges-operation' },
  'bristol-caz': { name: "Bristol City Council - Bristol's Clean Air Zone", url: 'https://www.bristol.gov.uk/residents/streets-travel/bristols-caz' },
  'bradford-caz': { name: 'Bradford Council - Clean Air Zone', url: 'https://www.bradford.gov.uk/clean-air-zone/clean-air-zone/' },
  'sheffield-caz': { name: 'Sheffield City Council - Clean Air Zone', url: 'https://www.sheffield.gov.uk/clean-air-zone-sheffield' },
  'bath-caz': { name: "Bath & North East Somerset Council - Bath's Clean Air Zone", url: 'https://www.bathnes.gov.uk/baths-clean-air-zone' },
  'portsmouth-caz': { name: 'Cleaner Air Portsmouth - charges', url: 'https://cleanerairportsmouth.co.uk/charges/' },
  'tyneside-caz': { name: 'Breathe Clean Air - Newcastle and Gateshead', url: 'https://www.breathe-cleanair.com/' },
  'greater-manchester-caz': { name: 'Clean Air Greater Manchester', url: 'https://cleanairgm.com/' },
  'glasgow-lez': { name: 'Glasgow City Council - Low Emission Zone', url: 'https://www.glasgow.gov.uk/LEZ' },
  'edinburgh-lez': { name: 'City of Edinburgh Council - Low emission zone', url: 'https://www.edinburgh.gov.uk/lez' },
  'dundee-lez': {
    name: 'Dundee City Council - Low Emission Zone scheme',
    url: 'https://www.dundeecity.gov.uk/service-area/city-development/sustainable-transport-and-roads/dundee-low-emission-zone-scheme-lez',
  },
  'aberdeen-lez': {
    name: 'Aberdeen City Council - Low Emission Zone',
    url: 'https://www.aberdeencity.gov.uk/Council-Services/roads-parking-and-travel/low-emission-zone-lez',
  },
}

/**
 * National listings, watched for zones this registry does not know about yet.
 * `names` are the places each page lists today; a place appearing that is not in
 * this list is reported as a possible new zone.
 */
export const NATIONAL_LISTINGS = [
  {
    id: 'england-caz',
    name: 'GOV.UK - Driving in a clean air zone',
    govukPath: 'guidance/driving-in-a-clean-air-zone',
    url: 'https://www.gov.uk/guidance/driving-in-a-clean-air-zone',
    names: ['Bath', 'Birmingham', 'Bradford', 'Bristol', 'Portsmouth', 'Sheffield', 'Tyneside'],
  },
  {
    id: 'scotland-lez',
    name: 'mygov.scot - Low emission zones',
    url: 'https://www.mygov.scot/low-emission-zones',
    names: ['Aberdeen', 'Dundee', 'Edinburgh', 'Glasgow'],
  },
]
