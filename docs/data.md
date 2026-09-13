# Where the data comes from, and keeping it current

carsearch ships two datasets, both committed under `public/data/` so the site
needs no backend and CI needs no network beyond npm.

| File | What | Built by |
|---|---|---|
| `zones.json` | Every UK clean-air, low-emission and congestion zone: boundary, charges, hours, rules | `npm run data:zones` |
| `catalogue.json` | Car models on UK roads, for the Catalogue tab | `npm run data:catalogue` |

`npm run data:check` reports whether either is out of date. It runs weekly in CI.

## Zones

Each zone is an entry in `scripts/zone-sources.mjs`, and has three quite different kinds of data:

| Data | Source | Kept current by |
|---|---|---|
| **Boundary** | The authority's own open data: TfL, the London Datastore, council ArcGIS services | Automatic. Fetched and simplified on every build. |
| **Charges, hours, who pays** | Hand-entered from the authority's website | **A person.** The check watches each authority's page and shows what changed. |
| **Official page** (`ZONE_INFO`) | The page a driver should read; shown in map popups | The check confirms each still resolves. |

Five zones publish no open boundary and are drawn as approximate discs. They are
marked `precision: 'approximate'`, dashed on the map, and labelled in the popup.

### Why charges are not scraped

There is no machine-readable feed of UK zone charges. They exist as prose on
council and TfL pages, in whatever layout each council chose. A scraper that got a
figure wrong would put a wrong number in front of someone deciding which car to
buy, and nothing would flag it. So the check does the part a machine is good at -
noticing that a page changed and showing exactly which lines - and leaves the
reading to a person.

## Vehicles

Merged from three inputs:

| Input | Rows | Gives |
|---|---|---|
| **DfT vehicle licensing statistics** (`scripts/dft-vehicles.mjs`) | ~29,000 variants | Breadth. Every car model with at least 50 still licensed in the UK - about 99% of all licensed cars. |
| **Hand-entered seed** (`scripts/catalogue-seed.mjs`) | ~390 | Depth for popular generations: body shape, gearboxes, drivetrain, trims. |
| **Your CSVs** (`data/manual/*.csv`) | any | Whatever you add. Gitignored. |

The DfT data joins two published files on make and model:
[VEH0220](https://www.gov.uk/government/statistical-data-sets/vehicle-licensing-statistics-data-files)
(fuel type and engine size) and VEH0124 (year of first registration). It is
Open Government Licence v3.0.

What the register does **not** record, so the catalogue does not claim it:

- **Body shape and trim list.** Register rows show a dash.
- **Exact engine size.** DfT publishes 100 cc bands.
- **Gearbox and drive**, except where DVLA's model string says so outright
  (`AUTO`, `DSG`, a trailing ` A`, `XDRIVE`, `QUATTRO`). An unmarked string is
  shown as unknown, never assumed manual.
- **Registration years per engine.** VEH0124 has no fuel or engine column, so the
  year range belongs to the DVLA model name. A name spanning two engine
  generations reports the wider span.

The first run downloads ~136 MB into `tmp/dft/` (gitignored) and reuses it until
DfT publishes a new release. To rebuild without downloading - after editing the
seed, say - use `npm run data:catalogue -- --offline`, which keeps the DfT rows
already in `catalogue.json`.

DfT publishes these files roughly annually. Note that the source files are
Windows-1252, not UTF-8.

## The weekly check

`.github/workflows/data-check.yml`, Mondays 06:23 UTC, or on demand from the
Actions tab. It runs `node scripts/check-data.mjs --apply` and:

| Result | Action |
|---|---|
| **Data files changed** | One pull request from `automation/data-refresh`. The description is the report. |
| **Nothing changed, but something needs a person** | One issue, titled *Data check needs review*. |
| **All clear** | Closes that issue if it is open. |

It never pushes to `main`.

What it applies by itself:

- **Changed boundaries.** Also flagged for a look before merging.
- **A new DfT release.** The catalogue is rebuilt.
- **Page baselines** in `data/watch/pages.json`, so next week's diff starts from what you reviewed.

What it will not do:

- **Change a charge.** It shows you the page diff; you edit `zone-sources.mjs`.
- **Remove a zone because a fetch failed.** A failed boundary fetch keeps the last official boundary.
- **Raise an issue for a bot wall.** Some council sites intermittently return 403 to
  CI runners. That is noted in the report and retried next week, not escalated,
  or it would reopen the same issue every Monday. A **404** is escalated: that
  link is dead and needs a new URL.

### One-time setup

**Settings → Actions → General → Workflow permissions** → tick
**Allow GitHub Actions to create and approve pull requests**. Without it, the
branch is still pushed and the issue links to it instead.

### Reviewing a data refresh pull request

1. Read the checklist at the top of the description.
2. For each **authority page that changed**, read its diff. Most changes are
   harmless: news items, reworded paragraphs.
3. If a **charge, hours or exemption** moved, confirm it on the page itself, edit
   the zone in `scripts/zone-sources.mjs`, and push that to the same branch.
4. When you have checked every zone's charges, bump `CHARGES_AS_OF`. The check
   starts asking for this once it is more than 120 days old.
5. Merge. That deploys the site and records the new baselines.

### Adding a zone

1. Add an entry to `ZONE_SOURCES` (or `PROPOSED_ZONE_SOURCES`) in
   `scripts/zone-sources.mjs`, with an ArcGIS or GeoJSON boundary if the authority
   publishes one, or a `disc` marked `precision: 'approximate'` if not.
2. Add its official page to `ZONE_INFO`. The build refuses to run without one.
3. If it is a new town on a national listing, add the name to that listing's
   `names` in `NATIONAL_LISTINGS`, or the check keeps reporting it as new.
4. `npm run data:zones`, check the map, commit.
