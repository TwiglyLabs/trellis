# Implementation

## Steps

1. **Strip HTTP server from graph command** — remove `startServer()`, `openBrowser()`, EADDRINUSE handling, and Ctrl+C hint from graph feature logic. The graph feature function returns `GraphResult` (nodes + edges); the CLI command handles output formatting.

2. **Add text summary output** — `trellis graph` without `--json` prints a compact summary: plan count, edge count, ready/blocked lists, critical path. Reuses data from `buildGraph()`. No new computation needed.

3. **Remove dagre esbuild plugin** — delete the plugin from `esbuild.config.ts` that bundles dagre as IIFE, injects into HTML template, and exports the HTML as a JS string.

4. **Delete viewer files** — remove `src/viewer/index.html` and any associated viewer utilities or imports.

5. **Remove dagre dependency** — remove `dagre` and `@types/dagre` (if present) from `package.json`.

6. **Update graph tests** — remove `vi.mock('../../src/viewer/index.html', ...)` from graph command tests. Add tests for the new text summary output format. Verify `--json` output is unchanged.

7. **Verify bundle size** — build and note `dist/trellis.cjs` size reduction.

## Testing

- **Text summary output**: verify plan count, edge count, ready/blocked lists appear in stdout
- **`--json` unchanged**: graph JSON output matches existing format (nodes + edges)
- **No viewer mock needed**: graph tests work without `vi.mock` for HTML file
- **Build succeeds**: `npm run build` produces `dist/trellis.cjs` without dagre plugin
- **Bundle size**: note reduction from baseline

## Done-when

- `src/viewer/index.html` and dagre esbuild plugin are deleted
- `dagre` removed from `package.json`
- `trellis graph` prints text summary; `trellis graph --json` outputs nodes + edges
- Graph tests pass without HTML file mocking
- Bundle builds successfully and is smaller
- All existing tests pass
