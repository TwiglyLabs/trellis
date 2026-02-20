# Implementation

## Steps

1. **Strip HTTP server and viewer from graph command** — In `src/features/graph/command.ts`: remove `createServer`, `execFile` imports and `viewerHtml` import. Remove the `--port` CLI option. Remove all server code (createServer, EADDRINUSE handler, listen, execFile browser-open, Ctrl+C hint). Keep the `--json` branch and the `computeGraph` call. Update command description from "Open DAG viewer in browser" to something like "Show plan dependency graph".

2. **Remove `getGraphData()`** — In `src/features/graph/logic.ts`: delete the `getGraphData()` function and its `computeShow` import. `computeGraph()` stays — it's used by the `--json` path.

3. **Add text summary output** — In the graph command's non-JSON branch, print a compact summary using data from `computeGraph()` result and the `GraphData` from context:
   - `{N} plans, {M} edges`
   - `Ready: {list}` (from `graph.ready` set)
   - `Blocked: {id} (by: {unsatisfied deps}), ...` — for each plan in `graph.blocked`, look up its `dependencies` and filter to those not in `done` status
   - Critical path: call `computeCriticalPath()` for each leaf node (plans with no dependents in the active graph), display the longest chain with ` → ` separator and step count
   - "No plans found." if empty (existing behavior)
   - Always exit 0

4. **Delete viewer directory** — Remove the entire `src/features/graph/viewer/` directory: `index.html`, `dagre-shim.ts`, `html.d.ts`.

5. **Remove dagre esbuild plugin** — In `build.mjs`: delete the `dagreInjectionPlugin` (lines 8-34) and remove it from the CLI build's `plugins: []` array. Library builds are untouched.

6. **Remove `@dagrejs/dagre` dependency** — Remove from `package.json` dependencies. Run `npm install` to update lockfile.

7. **Update graph tests** — In `src/features/graph/graph.test.ts`:
   - Remove `vi.mock('./viewer/index.html', ...)` and `vi.mock('child_process', ...)`
   - Remove the server integration test ("serves viewer data with chunks and contracts via /api/data") and associated `fetchJson`/`fetchHtml` helpers
   - Add tests for text summary: verify plan count, edge count, ready list, blocked list with reasons, critical path
   - Verify `--json` output is unchanged (existing tests should pass as-is)

8. **Verify build and bundle size** — `npm run build`, note `dist/trellis.cjs` size reduction from ~1.6MB baseline. Run full test suite.
## Testing

- **Text summary output**: verify plan count, edge count, ready list, blocked list with blocker reasons all appear in stdout
- **Blocked reasons**: fixture with A → B → C where A is not_started — verify B shows `(by: A)` in blocked line
- **Critical path**: fixture with chain — verify longest path printed with ` → ` separator and step count
- **Empty graph**: "No plans found." message, exit 0
- **`--json` unchanged**: graph JSON output matches existing format (`{ nodes, edges }`), existing tests pass unmodified
- **No viewer mock needed**: graph tests work without `vi.mock` for HTML file or child_process
- **Build succeeds**: `npm run build` produces `dist/trellis.cjs` without dagre plugin errors
- **Bundle size**: note reduction from ~1.6MB baseline
- **All existing tests pass**: full `npm test` green
## Done-when

- `src/features/graph/viewer/` directory deleted (index.html, dagre-shim.ts, html.d.ts)
- `getGraphData()` removed from logic.ts
- Dagre esbuild plugin removed from build.mjs
- `@dagrejs/dagre` removed from package.json
- HTTP server, `--port` flag, and browser-open code removed from command.ts
- `trellis graph` prints text summary with plan/edge counts, ready list, blocked list with reasons, critical path
- `trellis graph --json` outputs `{ nodes, edges }` unchanged
- Graph tests pass without HTML/child_process mocks
- Bundle builds successfully and is smaller
- All tests pass
