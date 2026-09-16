# Where the data comes from, and keeping it current

carsearch ships two datasets, both committed under `public/data/` so the site
needs no backend and CI needs no network beyond npm.

| File | What | Built by |
|---|---|---|
| `zones.json` | Every UK clean-air, low-emission and congestion zone: boundary, charges, hours, rules | `npm run data:zones` |
| `catalogue.json` | Car models on UK roads, for the Catalogue tab | `npm run data:catalogue` |
| `fuel.json` | Median pump prices per UK region, for the map overlay | `npm run data:fuel`, daily in CI |
| `regions.json` | Outlines of the 12 UK statistical regions | `npm run data:regions`, by hand |

`npm run data:check` reports whether either is out of date. It runs weekly in CI.

## Zones

Each zone is an entry in `scripts/zone-sources.mjs`, and has three quite different kinds of data:

| Data | Source | Kept current by |
|---|---|---|
| **Boundary** | The authority's own open data: TfL, the London Datastore, council ArcGIS services | Automatic, where the host's robots.txt permits it. Fetched and simplified on every build. |
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

## How the scripts fetch

Every request the data scripts make goes through `scripts/lib/polite-fetch.mjs`:

- **It identifies itself**: `Mozilla/5.0 (compatible; carsearch-data-check/1.0; +https://github.com/Tombo1001/carsearch)`.
  The `compatible;` form is the convention well-behaved crawlers use; the product
  token and link say exactly what it is.
- **robots.txt is obeyed** (RFC 9309). A disallowed URL is never requested. A
  robots.txt that returns 5xx or cannot be reached is treated as disallowing
  everything, as the RFC requires.
- **Crawl-delay is honoured** between requests to the same host.
- **A refusal is final.** A 403, or a 202 bot challenge, is not retried, and the
  script does not change its user agent or route around it. Only timeouts, 429
  and 5xx get a single retry.

### What that means in practice

Two things the check cannot see, and how they are handled:

**Sheffield's boundary.** The council publishes its Clean Air Zone on
[data.gov.uk](https://www.data.gov.uk/dataset/6ab87962-cc5e-43c6-85a7-53bf8e693d43/sheffield-clean-air-zone)
as an ArcGIS query URL, but the host that serves it has a robots.txt of
`Disallow: /`. So the build does not fetch it. It keeps the official boundary
already in `zones.json` and marks it `boundaryRefresh.automatic: false`. Every
report says so. Sheffield's zone does not charge private cars, so a stale boundary
there cannot change anyone's result.

To refresh it by hand, open the dataset page in a browser, download the GeoJSON,
and compare it with the committed geometry. If it has changed, replace the zone's
`geometry` in `public/data/zones.json` with the simplified version and commit.
A person downloading a published file is not what robots.txt governs.

**Pages that refuse automated requests.** Some sites refuse the check outright,
usually by blocking cloud providers' IP ranges. On GitHub's runners that currently
includes TfL (all three London pages), Portsmouth and Glasgow. These are not
retried. They are listed in every report under **Not watched automatically**, and
are the pages to read yourself when re-verifying charges. They are not raised as
issues, or the same issue would reopen every week.

The national listings on GOV.UK and mygov.scot are readable, so a new or ended
zone in England or Scotland is still caught even when the city's own page is not.

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

## Fuel prices

The map's **Fuel prices** tick box shows the median pump price in each of the
UK's 12 statistical regions, for unleaded (E10) or diesel (B7). It follows the car
selected in the sidebar until you pick a fuel yourself.

### Where the prices come from

[Fuel Finder](https://www.developer.fuel-finder.service.gov.uk/fuel-finder) is the
GOV.UK service set up by the Motor Fuel Price (Open Data) Regulations 2025. Every
UK forecourt has to publish a price change within 30 minutes. `scripts/build-fuel.mjs`
reads its public API once a day:

- `POST /api/v1/oauth/generate_access_token` for a one-hour token.
- `GET /api/v1/pfs` for forecourt locations, 500 per page.
- `GET /api/v1/pfs/fuel-prices` for their prices, 500 per page.

That is about 40 requests a day, one at a time with a second between them. The API
allows 100 a minute.

Each open forecourt is placed in a region by its coordinates, using the ONS ITL1
boundaries (January 2025), or by country for Scotland, Wales and Northern Ireland
when coordinates are missing. The script then takes the median per region and fuel.
It excludes:

- closed forecourts;
- prices outside 80 to 300p a litre, which are typing errors, not prices;
- any region and fuel with fewer than 10 forecourts reporting, which shows as `n/a`.

It publishes a median, not a mean, so a handful of motorway services cannot drag
a region's figure up.

`fuel.json` keeps 60 days of daily medians. The map uses them for each region's
change over the past week.

**Only the aggregates are ever written or committed.** Forecourt names, addresses
and phone numbers stay inside the script. `--dump` saves the raw responses to
`tmp/` for debugging; `tmp/` is gitignored, and a dump must never be committed.

### Getting credentials

The API needs OAuth client credentials, tied to a GOV.UK One Login:

1. Go to the [Fuel Finder developer portal](https://www.developer.fuel-finder.service.gov.uk/fuel-finder/public-api)
   and choose **Access public API**.
2. Sign in with GOV.UK One Login and create an information recipient application.
3. Copy the **client ID** and **client secret**.
4. In the repo, **Settings → Secrets and variables → Actions → Secrets**, add
   `FUEL_FINDER_CLIENT_ID` and `FUEL_FINDER_CLIENT_SECRET`.

These are real secrets, unlike `VITE_TILE_URL`. They are only used by the CI job,
never shipped to the browser.

To run it locally:

```bash
FUEL_FINDER_CLIENT_ID=... FUEL_FINDER_CLIENT_SECRET=... npm run data:fuel
```

Without credentials the script says so and exits cleanly, and the site simply has
no fuel control.

### The daily job

`.github/workflows/fuel-prices.yml` runs at 07:17 UTC. It commits
`public/data/fuel.json` straight to `main` when the prices changed, then starts the
Pages deploy. It has to start the deploy itself, because a push made with the
workflow's own token does not trigger other workflows.

If a run fails, the site keeps the last good prices. The job opens a
*Fuel price update failing* issue and closes it again on the next successful run.
The map control also tells visitors when its prices are three or more days old.

A response with fewer than 1,000 forecourts is treated as an outage, and the job
refuses to publish it.

### How the overlay stays off the zones

- **Region outlines** are drawn beneath the zone layers and have no fill. A tint
  under a zone would change its colour, and the colours mean something.
- **Price labels** are placed on every map move. Each one starts at its region's
  ONS label point. If it would touch a zone's box, a map control, another label or
  the edge of the view, it moves outwards in steps. A label that moved gets a
  leader line back to its region. The line stops at the edge of any zone in the
  way, and the anchor dot is dropped if a zone covers it, which is always the case
  for London.
- A label with nowhere to go is not drawn. The region list in the control still
  has every price.
- Past city zoom the labels hide, because a regional average means nothing there.
- The label layer never takes a click, so every zone stays clickable, and zone
  popups draw above the labels.

## The weekly check

`.github/workflows/data-check.yml`, Mondays 06:23 UTC, or on demand from the
Actions tab. It runs `node scripts/check-data.mjs --apply` and:

| Result | Action |
|---|---|
| **Data files changed** | One pull request from `automation/data-refresh`. The description is the report. Closes any open *Data check needs review* issue, which it supersedes. |
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
- **Fetch anything robots.txt excludes, or retry a refusal.** See *How the scripts fetch*.
- **Raise an issue for a refused page.** It is listed under *Not watched
  automatically* instead. A **404** is escalated: that link is dead and needs a
  new URL.

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
