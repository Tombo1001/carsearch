# Deploying carsearch

The app is a static bundle with no backend, so deploying it is copying `dist/`
somewhere. `.github/workflows/pages.yml` does that on every push to `main`.

## GitHub Pages

One-time setup, in the repo's **Settings → Pages**: set **Source** to
**GitHub Actions**. That is all — the workflow has the `pages: write` and
`id-token: write` permissions it needs, and no secrets are involved.

The site then serves from `https://tombo1001.github.io/carsearch/`.

### The base path

A GitHub Pages *project* site lives under `/<repo>/`, not at the root, so every
asset URL needs that prefix. It is set in two places that must agree:

| Where | Value |
|---|---|
| `vite.config.ts` | `BASE_PATH` env var, defaulting to `/carsearch/` |
| `.github/workflows/pages.yml` | `BASE_PATH: /carsearch/` |

Renaming the repo means changing both. Moving to a custom domain, or to a
`tombo1001.github.io` user site, means setting both to `/`.

The Dockerfile sets `BASE_PATH=/` for the same reason in reverse: nginx serves from
the root.

## Basemap tiles — read this before you publish

By default the map uses **OpenStreetMap's own tile servers**, and
[their tile usage policy](https://operations.osmfoundation.org/policies/tiles/)
does not permit that for a public site. They are a volunteer-funded resource, and
they enforce the policy: over their threshold, they serve a grey tile reading
"Access blocked" instead of map data. A private instance on your own LAN is fine.
A link you have shared is not.

Two things follow from this:

1. **Set a real tile provider before you advertise the site.** MapTiler, Stadia
   Maps, Thunderforest, Carto and others all sell raster tiles and most have a free
   tier for low-traffic or non-commercial use; check their current limits and terms
   yourself, since those change. Whatever you pick, it must be raster XYZ tiles at
   256 px to drop straight in.
2. **Self-hosting is the other option.** A [Protomaps](https://protomaps.com)
   `.pmtiles` extract can be served as a static file from the same origin, which
   removes the third party entirely. Note GitHub Pages' 100 MB per-file limit and
   1 GB soft repo limit — a UK extract at limited zoom levels can fit, a
   full-planet one cannot. This would need a MapLibre style change as well as a
   URL change, so it is a bigger job than swapping a provider.

### Switching provider

Set two repository variables (**Settings → Secrets and variables → Actions →
Variables**):

| Variable | Example |
|---|---|
| `VITE_TILE_URL` | `https://api.maptiler.com/maps/basic-v2/{z}/{x}/{y}.png?key=YOUR_KEY` |
| `VITE_TILE_ATTRIBUTION` | `&copy; MapTiler &copy; OpenStreetMap contributors` |

The workflow passes both to the build. The Content-Security-Policy in `index.html`
is *generated* from `VITE_TILE_URL` at build time, so the new host is allowed
automatically and cannot drift out of sync — this matters, because MapLibre fetches
raster tiles with `fetch()` rather than `<img>`, so a host missing from
`connect-src` produces a completely blank map.

Note that a tile API key in a static site is public by construction. Every provider
expects this; restrict the key to your domain in their dashboard rather than trying
to hide it.

Locally, the same variables work from the shell or a `.env` file:

```bash
VITE_TILE_URL='https://…/{z}/{x}/{y}.png?key=…' npm run build
```

## What the deployment does not need

No database, no server runtime, no environment secrets, no analytics endpoint. The
zone and catalogue JSON are committed, so CI reaches no network beyond npm. If a
future change adds a backend, the privacy claim on the front page stops being true
and needs rewriting.

## Keeping the data fresh

Charges and boundaries go stale — councils change rates, and `chargesAsOf` in
`public/data/zones.json` is what the UI shows users. Re-run `npm run data:zones`,
check the diff, and commit; the push redeploys. See [running.md](running.md).
