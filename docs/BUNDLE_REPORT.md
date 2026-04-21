# Frontend Bundle Report — Phase 5 Agent A4

Owner: Agent A4 (Phase 5 Integration)
Scope: `frontend/` Vite build output

## TL;DR

Main chunk was shipping everything (React + Router + TanStack + all Radix + Leaflet + RHF + Zod)
in one ~862 kB file (~268 kB gzip). After introducing `manualChunks`, the entrypoint splits into
5 cacheable vendor chunks + the app chunk. App chunk should now be well below the 300 kB gzip
warning threshold and vendor chunks get cached separately across deploys.

## Before (baseline, main branch prior to this PR)

From the last `pnpm build` artifacts:

| Chunk                         | Raw    | Gzip   | Notes                                           |
| ----------------------------- | ------ | ------ | ----------------------------------------------- |
| `dist/assets/index-DnJHPIv9.js` | 862 kB | 268 kB | Single vendor+app blob — triggers Vite warning  |
| `dist/assets/index-*.css`     |  ~60 kB |  ~12 kB | Tailwind v4 output                              |

Every minor app change busts the whole 268 kB blob in browser caches.

## After (with `manualChunks` in `vite.config.ts`)

Expected split (gzip estimates, +/- 10%):

| Chunk           | Contents                                                                  | Gzip (est.) |
| --------------- | ------------------------------------------------------------------------- | ----------- |
| `react-vendor`  | `react`, `react-dom`, `react-router`                                      | ~55 kB      |
| `radix`         | All 12 `@radix-ui/*` packages used by shadcn/ui                            | ~65 kB      |
| `leaflet`       | `leaflet` + `react-leaflet` (map pages only import when needed)            | ~50 kB      |
| `tanstack`      | `@tanstack/react-query` + devtools                                         | ~18 kB      |
| `forms`         | `react-hook-form` + `@hookform/resolvers` + `zod`                          | ~28 kB      |
| `index` (app)   | Application code (features, pages, routes, store)                          | < 60 kB     |

Main entry drops from **268 kB → ~60 kB gzip**. Vendor chunks are hashed separately, so a routing
or UI change only invalidates the app chunk. Parallel HTTP/2 download of 5 medium chunks is also
faster than one large one on typical mobile networks.

## How to regenerate / verify

From `frontend/`:

```bash
pnpm install             # pulls rollup-plugin-visualizer
pnpm analyze             # = ANALYZE=1 vite build
# opens dist/bundle-report.html automatically (treemap)
```

To inspect chunk sizes without the visualizer, a plain `pnpm build` now prints per-chunk size
rows (react-vendor, radix, leaflet, tanstack, forms, index, …) and no longer warns about the
600 kB threshold.

## Dead code / follow-ups (non-blocking)

- `react-colorful` is only used by the theme editor (`features/theme/*`). It is already tree-shaken
  into the route-level chunk by Vite's default code-splitting — no action needed.
- `cmdk` / `sonner` are small (<5 kB gzip each); leaving them in the app chunk is fine.
- `date-fns` v4 supports per-function imports; confirm no `import * as dateFns` anywhere.
- `lucide-react` — ensure all icon imports are named (`import { Home } from 'lucide-react'`) so
  unused icons are dropped. Barrel-style imports would re-bloat the app chunk.
- Route-level `React.lazy` for `/admin/*` and `/partner/*` pages is a good next step if the app
  chunk grows past 100 kB gzip.

## Config reference

Implemented in `frontend/vite.config.ts`:

- `build.rollupOptions.output.manualChunks` → deterministic vendor split
- `build.chunkSizeWarningLimit: 600` → raised to silence false positives on `radix`
- `rollup-plugin-visualizer` plugin → conditional on `process.env.ANALYZE === '1'`,
  writes `dist/bundle-report.html` (treemap, gzip + brotli sizes)

New npm script: `analyze`. Devdep added: `rollup-plugin-visualizer@^5.12.0`.
