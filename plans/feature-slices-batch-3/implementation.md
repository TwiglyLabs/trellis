## Steps

### Phase 5: Extract graph, init, fetch, setup-hooks, watch

**graph:**
- `src/features/graph/logic.ts` — graph serving/opening logic (not DAG algorithms — those stay in `src/core/graph.ts`)
- `src/features/graph/viewer/` — move entire `src/viewer/` directory here
- Update the esbuild dagre injection plugin to reference `src/features/graph/viewer/index.html` and `src/features/graph/viewer/dagre-shim.ts` instead of `src/viewer/`. Verify `trellis graph` serves the viewer correctly at runtime (build success alone doesn't catch path errors).
- `src/features/graph/command.ts` — from `src/commands/graph.ts`
- `src/features/graph/graph.test.ts` — tests for serve/open behavior only (HTTP server, browser launch, port handling). DAG algorithm tests (`buildGraph`, `detectCycles`, `topologicalSort`, `transitiveDependents`, `computeCriticalPath`, `pickNext`, `computeChunks`, chunking helpers) stay in `tests/graph.test.ts` until Phase 6 moves them to `src/core/graph.test.ts`.
- Delete `src/commands/graph.ts`

**init:**
- Standard pattern: `logic.ts`, `command.ts`, `init.test.ts`
- Move `tests/commands/init.test.ts`
- Delete `src/commands/init.ts`

**fetch:**
- Standard pattern
- Move `tests/commands/fetch.test.ts` AND `tests/api-fetch.test.ts` to `src/features/fetch/`
- Delete `src/commands/fetch.ts`

**setup-hooks:**
- Standard pattern
- Move `tests/commands/setup-hooks.test.ts` AND `tests/hooks.test.ts` to `src/features/setup-hooks/`
- Delete `src/commands/setup-hooks.ts`

**watch:**
- `src/features/watch/logic.ts` — extract the ~30-line `watch()`/`unwatch()`/`isWatching` block from `Trellis` class as standalone `watchPlans(dir, opts)` function
- `src/features/watch/watch.test.ts` — move `tests/api-watch.test.ts`

Confirm all tests pass.

### Phase 6: Move core test files to src/core/

Move remaining tests that belong with core modules:
- `tests/scanner.test.ts` → `src/core/scanner.test.ts`
- `tests/frontmatter.test.ts` → `src/core/frontmatter.test.ts`
- `tests/schema.test.ts` → `src/core/schema.test.ts`
- `tests/utils.test.ts` → `src/core/utils.test.ts`
- `tests/contracts.test.ts` → `src/core/contracts.test.ts`
- `tests/manifest.test.ts` → `src/core/manifest.test.ts`
- `tests/graph.test.ts` (DAG algorithm portions) → `src/core/graph.test.ts`
- Update all imports

Move remaining `tests/api.test.ts` (only `'Trellis class'` and `'Trellis: empty project'` describe blocks remain after feature extraction) to `src/__tests__/api.test.ts`. These test the Trellis class shim and will be deleted in kill-trellis-class.

Move remaining cross-cutting tests to `src/__tests__/`:
- `tests/build.test.ts` → `src/__tests__/build.test.ts`
- `tests/index.test.ts` → `src/__tests__/index.test.ts`
- `tests/integration.test.ts` → `src/__tests__/integration.test.ts`
- `tests/dist-integration.test.ts` → `src/__tests__/dist-integration.test.ts`
- `tests/library-integration.test.ts` → `src/__tests__/library-integration.test.ts`
- `tests/mcp.test.ts` → `src/__tests__/mcp.test.ts`

Confirm all tests pass.

### Phase 7: Delete old directories and update cli.ts

1. Verify `src/commands/` is now empty (all files moved to feature dirs). Delete `src/commands/`.
2. Refactor `src/cli.ts` command registration pattern — cli.ts already imports from `./features/<name>/command` (updated incrementally in batches 1-2). Now change from direct function imports to a register pattern: each feature's `command.ts` exports a `register(program: Command)` function that adds its command to the program. `cli.ts` imports and calls each register function. This consolidates all command registration logic (flags, help text, action handlers) into the feature directories.
3. Verify `tests/` directory is empty. Delete `tests/`.
4. Confirm esbuild config in `build.js` (or equivalent) excludes `**/*.test.ts` and `**/__tests__/**` from the bundle.
5. Run `npm run build` — verify bundle size is comparable to before (no test files leaked in).

Confirm all tests pass.

## Testing

- After each phase, run `npm test` and confirm test count stays at 606+ (no tests dropped).
- After Phase 7, run `npm run build` and verify:
  - Bundle builds without error
  - Bundle does NOT contain test file contents (grep for `describe(` or `it(` in dist/)
- Spot-check `trellis graph`, `trellis init --yes`, `trellis fetch` against a real plans directory.
- Verify `src/viewer/` is gone and graph viewer works from its new location.

## Done-when

- All 17 features have a directory under `src/features/<name>/` with `logic.ts`, `command.ts`, and `<name>.test.ts` (18 counting watch which has no CLI command, just logic + test)
- `src/commands/` directory is deleted; all CLI handlers live in feature dirs
- `src/viewer/` is deleted; graph viewer lives at `src/features/graph/viewer/`
- `tests/` directory is deleted; all tests live co-located in `src/`
- Core tests live in `src/core/`; cross-cutting tests in `src/__tests__/`
- `src/cli.ts` imports command handlers from feature dirs via explicit register functions
- esbuild excludes test files from the bundle
- `Trellis` class in `api.ts` delegates every method to the corresponding `logic.ts` function (shim only)
- All tests pass (`npm test`)
- Bundle builds without error (`npm run build`)
- Binary smoke-tests pass against a real plans directory
