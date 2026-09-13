# Running carsearch locally

carsearch is a static site with no backend. Your location history is parsed in the
browser and never leaves it, so there is nothing to secure beyond serving files and
nothing to configure beyond the port.

For the public deployment, see [deploying.md](deploying.md).

## With Node

```bash
npm install
npm run dev      # http://localhost:5173
```

`npm run build` produces `dist/`, and `npm run preview` serves it.

The dev and preview servers use the same base path as the public site (`/carsearch/`),
so the dev URL is `http://localhost:5173/carsearch/`. To serve from the root instead:

```bash
BASE_PATH=/ npm run dev
```

## In Docker

```bash
docker compose up -d --build
```

Then open `http://localhost:8080/`. The image is a multi-stage build: Node compiles
the bundle, nginx serves it. `BASE_PATH=/` is set in the Dockerfile because nginx
serves from the root, unlike GitHub Pages.

`docker compose logs -f carsearch` for logs, `docker compose down` to stop. To change
the host port, edit the left-hand side of the `ports:` mapping in
`docker-compose.yml`; the container always listens on 80 internally.

### Healthcheck gotcha

The container probe hits `http://127.0.0.1/`, not `http://localhost/`. This nginx
config listens on IPv4 only, and inside the container `localhost` resolves to `::1`
first, so a `localhost` probe reports the container unhealthy while the site serves
fine from outside.

## Rebuilding the data

`public/data/*.json` is committed, which keeps both the Docker build and CI hermetic —
neither needs any network beyond npm. Regenerate it when you want fresher data:

```bash
npm run data:zones        # re-fetches every boundary from its official source
npm run data:catalogue    # DfT register + seed + data/manual/*.csv (first run downloads ~136 MB)
npm run data:check        # reports what is out of date, changes nothing
```

Where each dataset comes from, and the weekly check that keeps them current, is in
[data.md](data.md).

`npm run data:zones` is the one to re-run periodically: it pulls live from TfL, the
London Datastore and the council ArcGIS services. It prints one line per zone and
fails loudly rather than substituting a guessed boundary — if a council moves a URL,
the zone is omitted and the app shows a warning, instead of quietly showing you a
made-up shape. Commit the regenerated JSON and the next push redeploys.

`data/manual/` is where your own CSVs go. It is gitignored and excluded from the
Docker image, and it should stay that way.
