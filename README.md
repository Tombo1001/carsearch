# carsearch

**Would an older diesel actually cost you money?** Load your own Google Timeline
export, pick a car, and see which UK clean-air, low-emission and congestion zones
you really drive through — and what they would charge you.

Most advice about this is generic: *"a Euro 5 diesel pays £12.50 a day in London."*
That is only useful if you know how often you are in London. This answers the
version of the question that matters, which is what it would have cost **you**, over
your actual driving, for a specific car.

👉 **[tombo1001.github.io/carsearch](https://tombo1001.github.io/carsearch/)**

## Your location data never leaves your browser

This is the important bit, so it is worth being precise rather than reassuring.

- **There is no backend.** The site is static files. There is no server to receive
  an upload, no database, no account, no API key belonging to you.
- **Nothing is stored.** No `localStorage`, no `sessionStorage`, no IndexedDB, no
  cookies, no service worker. Close the tab and the data is gone; reload and you
  start again from scratch.
- **Nothing is sent.** The only network requests the app makes are for its own code,
  its own zone data, and map tiles. A
  [Content-Security-Policy](https://developer.mozilla.org/docs/Web/HTTP/CSP) with
  `connect-src 'self' <tile host>` is what enforces that — it is not merely a
  property of the code as currently written.
- **No analytics, no trackers, no third-party scripts.** The bug-report and support
  links are plain anchors; nothing contacts GitHub or Buy Me a Coffee until you
  click one.
- **The bug-report button never includes your locations.** It prefills a GitHub
  issue with the shape of your data (export format, number of points, span in days)
  and your browser version. You see the whole thing on GitHub and choose whether to
  submit it. See `src/lib/report.ts`.

Your file is read with `FileReader` and `JSON.parse`. It is never evaluated as code.

**Please do not attach a Timeline export to a public issue.** It is a detailed record
of everywhere you have been.

## Coverage

The whole UK. England and Scotland are the only nations that operate one of these
schemes; Wales and Northern Ireland have none in force, so a route through Cardiff or
Belfast correctly shows no charge rather than missing data.

| Nation | Zones |
|---|---|
| England | London ULEZ, London LEZ, London Congestion Charge, and the Birmingham, Bristol, Bradford, Sheffield, Bath, Portsmouth, Tyneside and (abandoned) Greater Manchester clean-air zones |
| Scotland | Glasgow, Edinburgh, Dundee and Aberdeen low-emission zones |
| Wales | None in force |
| Northern Ireland | None in force |

Scotland's LEZs are bans, not charges: a non-compliant car cannot legally enter, so
the app reports blocked days rather than a bill.

Boundaries come from TfL, the London Datastore and council ArcGIS services wherever
one is published, and are simplified to a tolerance finer than consumer GPS noise. A
few zones publish no open boundary and are drawn as approximate discs, dashed on the
map and labelled as such.

**This is a planning tool, not legal advice.** Charges change. The date the charges
were checked is shown in the app; verify with the authority before spending money on
a car.

## Which export files work

| Format | Where it comes from |
|---|---|
| `Records.json` | Older Google Takeout archives |
| Semantic Location History (`2021_JANUARY.json`) | Older Takeout archives, monthly files |
| Timeline export | The current on-device export from the Google Maps app |

Since late 2024, Timeline lives on your phone and Takeout no longer offers it:
**Google Maps → profile picture → Your Timeline → ⋯ → Location & privacy settings →
Export Timeline data**.

Unzip Takeout archives first — the app reads JSON, not ZIPs, and will say so.

## Running it yourself

```bash
npm install
npm run dev
```

See [docs/running.md](docs/running.md) for Docker and for regenerating the zone data,
and [docs/deploying.md](docs/deploying.md) for GitHub Pages.

**If you fork this and put it online, change the tile provider first.** The default
uses OpenStreetMap's volunteer tile servers, which their usage policy does not permit
for a public site. `docs/deploying.md` explains the one variable to set.

## Contributing

Bug reports and corrections are welcome, especially **"this charge or boundary is
wrong"** — that data goes stale and a link to the authority's own page is enough to
fix it.

## Licence

[MIT](LICENSE) for the code.

The zone boundaries are derived from public sector data published under the
[Open Government Licence v3](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/)
(v2 for some London Datastore sets) and remain subject to it. Map data is
© OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright).
