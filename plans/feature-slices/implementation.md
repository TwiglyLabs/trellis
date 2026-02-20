## Steps

### Phase 0: Scaffolding and infrastructure (do this first)

1. Create `src/features/` directory with a placeholder `.gitkeep` to establish the structure
2. Create `src/__tests__/` directory for cross-cutting tests
3. Move `tests/helpers.ts` to `src/__tests__/helpers.ts` and update all imports across test files
4. Move cross-cutting test files into `src/__tests__/`:
   - `tests/api-integration.test.ts`
   - `tests/json-contracts.test.ts`
   - `tests/api-cli-consistency.test.ts`
5. Update vitest config to pick up tests from `src/` in addition to `tests/`
6. Confirm all existing tests still pass before extracting any features

### Phase 1: Extract batch 1 — status, ready, show (3 features)

For each feature, follow this pattern:

**status:**
- Create `src/features/status/logic.ts` with standalone `computeStatus(plansDir, config)` function + return types extracted from `Trellis.status()`
- Create `src/features/status/command.ts` with the Commander handler (currently in `src/commands/status.ts`)
- Create `src/features/status/status.test.ts` — move describe blocks from `tests/api.test.ts` (status section) and `tests/commands/status.test.ts`
- Update `Trellis.status()` in `api.ts` to delegate to `computeStatus()`
- Delete `src/commands/status.ts`

**ready** and **show:** same pattern as above, drawing from `tests/api.test.ts` (ready, show sections) and `tests/commands/ready.test.ts`, `tests/commands/show.test.ts`.

Confirm all tests pass before proceeding.

### Phase 2: Extract batch 2 — update, lint, create (3 features)

**update:**
- Extract to `src/features/update/logic.ts`; this includes gate validation logic (currently calls into `validateStatusGate`)
- Move `tests/commands/update.test.ts` and update describe blocks from `tests/api.test.ts`

**lint:**
- Extract to `src/features/lint/logic.ts`
- Move `tests/commands/lint.test.ts` and lint describe blocks from `tests/api.test.ts`

**create:**
- Extract to `src/features/create/logic.ts`
- Move `tests/write-api.test.ts` create describe block to `src/features/create/create.test.ts`

Confirm all tests pass.

### Phase 3: Extract batch 3 — set, rename, archive, sections (4 features)

**set**, **rename**, **archive:**
- Each gets `logic.ts` + `command.ts` + `<name>.test.ts`
- Source: corresponding describe blocks in `tests/write-api.test.ts`

**sections:**
- `src/features/sections/logic.ts` re-exports `readSection` + `writeSection` from `src/schema.ts` (or moves them here)
- `src/features/sections/sections.test.ts` from `tests/write-api.test.ts` writeSection/readSection blocks

Confirm all tests pass.

### Phase 4: Extract batch 4 — epic, chunks, metrics (3 features)

**epic**, **chunks**, **metrics:**
- Standard pattern: `logic.ts`, `command.ts`, `<name>.test.ts`
- Move `tests/commands/epic.test.ts`, `tests/commands/chunks.test.ts`, `tests/commands/metrics.test.ts`
- Move epic/chunks describe blocks from `tests/api.test.ts`

Confirm all tests pass.

### Phase 5: Extract batch 5 — graph, init, fetch, setup-hooks (4 features)

**graph:**
- `src/features/graph/logic.ts` — graph serving/opening logic (not the DAG algorithms — those stay in `src/core/graph.ts`)
- `src/features/graph/viewer/` — move entire `src/viewer/` directory here
- `src/features/graph/command.ts` — from `src/commands/graph.ts`
- `src/features/graph/graph.test.ts` — subset of `tests/graph.test.ts` that tests the serve/open behavior (DAG algorithm tests stay in `src/core/`)

**init:**
- `src/features/init/logic.ts` + `src/features/init/command.ts` — from `src/commands/init.ts`
- `src/features/init/init.test.ts` — from `tests/commands/init.test.ts`

**fetch:**
- `src/features/fetch/logic.ts` + `src/features/fetch/command.ts`
- `src/features/fetch/fetch.test.ts` from `tests/commands/fetch.test.ts`

**setup-hooks:**
- `src/features/setup-hooks/logic.ts` + `src/features/setup-hooks/command.ts` — from `src/commands/setup-hooks.ts`
- `src/features/setup-hooks/setup-hooks.test.ts` from `tests/commands/setup-hooks.test.ts`

Confirm all tests pass.

### Phase 6: Move core test files to src/core/

Move the remaining tests that belong with core modules:
- `tests/scanner.test.ts` → `src/core/scanner.test.ts`
- `tests/frontmatter.test.ts` → `src/core/frontmatter.test.ts`
- `tests/schema.test.ts` → `src/core/schema.test.ts`
- `tests/sections.test.ts` → `src/core/sections.test.ts`
- `tests/graph.test.ts` (DAG algorithm portions) → `src/core/graph.test.ts`
- Update all imports

Confirm all tests pass.

### Phase 7: Delete the old commands/ directory and empty tests/ directory

- Verify `src/commands/` is now empty (all files moved to feature dirs)
- Delete `src/commands/`
- Update `src/cli.ts` (CLI entry point) to import command handlers from `src/features/*/command.ts`
- Verify `tests/` contains only files already moved to `src/` (should be empty or only have stragglers)
- Delete `tests/` directory if empty

Confirm all tests pass.

## Testing

- After each batch (phases 1-7), run `npm test` and confirm zero failures before proceeding
- Check that test count stays stable or grows (no tests accidentally dropped)
- Run `npm run build` after phase 7 to confirm esbuild still resolves all imports correctly
- Spot-check `trellis status`, `trellis ready`, `trellis lint` against a real plans directory after the build succeeds
- Confirm `src/__tests__/api-integration.test.ts`, `json-contracts.test.ts`, and `api-cli-consistency.test.ts` still pass as integration coverage for the refactored code

## Done-when

- All 17 features have a directory under `src/features/<name>/` with `logic.ts`, `command.ts`, and `<name>.test.ts`
- `src/commands/` directory is deleted; all CLI handlers live in feature dirs
- `src/viewer/` is deleted; graph viewer lives at `src/features/graph/viewer/`
- `tests/` directory is deleted or empty; all tests live co-located in `src/`
- `src/__tests__/` holds the four cross-cutting test files and `helpers.ts`
- `Trellis` class in `api.ts` delegates every method to the corresponding `logic.ts` function (shim only, no implementation)
- All tests pass (`npm test`)
- Bundle builds without error (`npm run build`)
- Binary smoke-tests pass against a real plans directory
