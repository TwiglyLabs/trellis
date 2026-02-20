## Steps

### Phase 0: Scaffolding and infrastructure

1. Create `src/features/` directory with a placeholder `.gitkeep` to establish the structure.
2. Create `src/__tests__/` directory for cross-cutting tests.
3. Move `tests/helpers.ts` to `src/__tests__/helpers.ts` and update all imports across test files.
4. Move cross-cutting test files into `src/__tests__/`:
   - `tests/api-integration.test.ts`
   - `tests/json-contracts.test.ts`
   - `tests/api-cli-consistency.test.ts`
5. Update vitest config to pick up tests from `src/` in addition to `tests/`. Ensure esbuild config excludes `**/*.test.ts` from the bundle.
6. Confirm all 606 existing tests still pass before extracting any features.

### Phase 1: Extract status, ready, show

For each feature, follow this pattern:

- For each extracted command: update the import path in `src/cli.ts` from `./commands/<name>` to `./features/<name>/command`. The export name and cli.ts registration code stay the same.

**status:**
- Create `src/features/status/logic.ts` with standalone `computeStatus(ctx)` function + return types extracted from `Trellis.status()`
- Create `src/features/status/command.ts` with the Commander handler (currently in `src/commands/status.ts`)
- Create `src/features/status/status.test.ts` — move describe blocks from `tests/api.test.ts` (status section) and `tests/commands/status.test.ts`
- Update `Trellis.status()` in `api.ts` to delegate to `computeStatus()`
- Delete `src/commands/status.ts`

**ready** and **show:** same pattern as above, drawing from `tests/api.test.ts` (ready, show sections) and `tests/commands/ready.test.ts`, `tests/commands/show.test.ts`.

Confirm all tests pass before proceeding.

### Phase 2: Extract update, lint, create

**update:**
- Extract to `src/features/update/logic.ts`; this includes gate validation logic (currently calls into `validateStatusGate`)
- Move `tests/commands/update.test.ts` and update describe blocks from `tests/api.test.ts`

**lint:**
- Extract to `src/features/lint/logic.ts`
- Move `tests/commands/lint.test.ts` AND `tests/commands/lint-structural.test.ts` to `src/features/lint/`

**create:**
- Extract to `src/features/create/logic.ts`
- Move `tests/write-api.test.ts` create describe block AND `tests/commands/create.test.ts` to `src/features/create/`

Confirm all tests pass.

## Testing

- After Phase 0, run `npm test` — all 606 tests pass with only import path changes.
- After each feature extraction, run `npm test` and confirm test count stays stable (no tests dropped).
- Run `npm run build` after Phase 0 to confirm esbuild excludes test files from the bundle.
- Spot-check `trellis status`, `trellis ready`, `trellis lint` against a real plans directory.

## Done-when

- `src/features/` exists with 6 feature directories: `status/`, `ready/`, `show/`, `update/`, `lint/`, `create/`
- Each has `logic.ts`, `command.ts`, and `<name>.test.ts`
- `src/__tests__/` holds cross-cutting test files and `helpers.ts`
- Vitest config includes `src/` test paths; esbuild excludes `**/*.test.ts`
- `Trellis` class delegates these 6 methods to feature functions
- All tests pass (`npm test`)
- Bundle builds without error (`npm run build`)
