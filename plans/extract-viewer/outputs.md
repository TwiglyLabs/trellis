
## Exports

### `trellis graph` text summary output

Default `trellis graph` prints a compact text summary (plan count, edges, ready/blocked lists, critical path) instead of launching an HTML viewer. `--json` output unchanged.

### Removed dependencies

- `@dagrejs/dagre` removed from `package.json`
- `src/features/graph/viewer/` directory deleted (index.html, dagre-shim.ts, html.d.ts)
- `dagreInjectionPlugin` removed from `build.mjs`
- HTTP server code removed from graph command

### Simplified build

CLI build no longer uses the dagre esbuild injection plugin. Reduced bundle size.
