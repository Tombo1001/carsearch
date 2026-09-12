/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Basemap tile template. See src/lib/config.ts. */
  readonly VITE_TILE_URL?: string
  /** Attribution string for the above. */
  readonly VITE_TILE_ATTRIBUTION?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Injected by vite.config.ts from package.json. */
declare const __APP_VERSION__: string
/** Injected by vite.config.ts: build date and, in CI, the commit it was built from. */
declare const __BUILD_INFO__: string
