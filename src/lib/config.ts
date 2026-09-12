/**
 * Public-deployment constants.
 *
 * Everything here is baked into the bundle at build time. None of it is a secret,
 * and none of it is sent anywhere on page load - the support and bug-report links
 * are ordinary anchors the user has to click.
 */

/** owner/repo on GitHub. Drives the bug-report link and the source link. */
export const REPO = 'Tombo1001/carsearch'
export const REPO_URL = `https://github.com/${REPO}`
export const NEW_ISSUE_URL = `${REPO_URL}/issues/new`

/** Where "support this tool" points. Shown as a link, never as an embedded widget. */
export const SUPPORT_URL = 'https://buymeacoffee.com/exit'
export const SUPPORT_HANDLE = 'ExitCode_0'

/**
 * Basemap tiles.
 *
 * Defaults to OpenStreetMap's own servers, which keeps a fresh clone runnable with
 * no signup. Their tile policy forbids using them for a public, trafficked site,
 * and they enforce it - so a real deployment should set VITE_TILE_URL to its own
 * provider. See docs/deploying.md. The CSP in index.html is generated from this
 * value at build time, so changing it does not silently break image loading.
 */
export const TILE_URL =
  import.meta.env.VITE_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
export const TILE_ATTRIBUTION =
  import.meta.env.VITE_TILE_ATTRIBUTION || '&copy; OpenStreetMap contributors'
