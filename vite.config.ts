import { readFileSync } from 'node:fs'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export const DEFAULT_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

/** Origin of a tile template, so the CSP can name it without hardcoding a host. */
function tileOrigin(template: string): string {
  try {
    return new URL(template.replace(/\{[a-z]\}/g, '1')).origin
  } catch {
    return ''
  }
}

/**
 * Content-Security-Policy, as a meta tag.
 *
 * GitHub Pages serves static files and lets you set no response headers at all, so
 * a meta tag is the only way to get a CSP onto the deployed site. It is honoured by
 * every current browser for everything here; the one directive it cannot carry is
 * frame-ancestors, which nginx.conf still sets for the Docker deployment.
 *
 * The policy is deliberately tight, because the whole privacy claim of this app is
 * "your location data never leaves the browser" and a CSP is what makes that
 * enforceable rather than merely true of the code as written today:
 *
 *   connect-src         - our own origin plus the tile host, and nothing else. This
 *                         is the directive that would actually stop an attempt to
 *                         exfiltrate a parsed timeline, and it is the one the tile
 *                         host has to be named in: MapLibre requests raster tiles
 *                         with `fetch`, not with an <img> tag, so a policy that
 *                         lists the host only under img-src blocks every tile and
 *                         leaves a blank map. Verified in a headless browser, not
 *                         assumed.
 *   img-src             - our own assets, plus the tile host for good measure,
 *                         plus the blob: and data: URLs MapLibre generates as it
 *                         hands decoded tiles to the canvas.
 *   worker-src blob:    - MapLibre runs its tile work in a blob worker.
 *   style-src 'unsafe-inline' - React `style={{...}}` renders inline style
 *                         attributes and MapLibre's controls do the same. This is
 *                         the one loosened directive; it permits styling, not
 *                         script.
 *   script-src 'self'   - no inline script, so a string that reached an HTML sink
 *                         could not execute.
 */
function csp(tileUrl: string): string {
  const origin = tileOrigin(tileUrl)
  return [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${origin ? ` ${origin}` : ''}`,
    "font-src 'self'",
    `connect-src 'self'${origin ? ` ${origin}` : ''}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join('; ')
}

/** Injects the generated CSP into index.html so it cannot drift from the config. */
function cspPlugin(tileUrl: string): Plugin {
  return {
    name: 'carsearch-csp',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) =>
        html.replace(
          '<!-- CSP -->',
          `<meta http-equiv="Content-Security-Policy" content="${csp(tileUrl)}" />`,
        ),
    },
  }
}

export default defineConfig(({ mode }) => {
  // loadEnv, not process.env: this has to see VITE_TILE_URL whether it came from
  // the shell, from CI, or from a .env file, because the CSP is generated from it
  // and a policy that disagrees with the app's tile URL means a blank map.
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env }

  // `||`, not `??`: GitHub Actions sets an unconfigured `vars.*` to the empty
  // string rather than leaving it undefined, and `??` would happily accept ''.
  const tileUrl = env.VITE_TILE_URL || DEFAULT_TILE_URL

  /**
   * Repo name, which is also the path GitHub Pages serves a project site from
   * (tombo1001.github.io/carsearch/). Overridable so a fork, a custom domain or
   * a plain `docker compose up` can serve from the root instead: BASE_PATH=/ .
   */
  const base = process.env.BASE_PATH || '/carsearch/'

  return {
    base,
    plugins: [react(), cspPlugin(tileUrl)],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __BUILD_INFO__: JSON.stringify(
        `${new Date().toISOString().slice(0, 10)}${
          process.env.GITHUB_SHA ? ` (${process.env.GITHUB_SHA.slice(0, 7)})` : ''
        }`,
      ),
    },
    server: { port: 5173, host: true },
    build: {
      rollupOptions: {
        // MapLibre is the bulk of the bundle and changes far less often than the
        // app, so it gets its own long-lived chunk.
        output: { manualChunks: { maplibre: ['maplibre-gl'] } },
      },
    },
  }
})
