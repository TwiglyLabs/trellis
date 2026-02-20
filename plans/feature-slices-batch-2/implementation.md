## Steps

### Phase 3: Extract set, rename, archive, sections

For each extracted command: update `src/cli.ts` import from `./commands/<name>` to `./features/<name>/command`. Same pattern as batch 1.

**set:**
- Create `src/features/set/logic.ts` with standalone function + types
- Create `src/features/set/command.ts` from `src/commands/set.ts`
- Create `src/features/set/set.test.ts` — merge `tests/write-api.test.ts` set blocks AND `tests/commands/set.test.ts`
- Delete `src/commands/set.ts`

**rename:**
- Same pattern; merge `tests/write-api.test.ts` rename blocks AND `tests/commands/rename.test.ts`
- Delete `src/commands/rename.ts`

**archive:**
- Same pattern; merge `tests/write-api.test.ts` archive blocks AND `tests/commands/archive.test.ts`
- Delete `src/commands/archive.ts`

**sections:**
- `src/features/sections/logic.ts` — plan-aware wrappers around core primitives. Raw `readSection()` and `writeSection()` stay in `src/core/schema.ts` (they're used internally by `validateStatusGate` and other core code). The feature logic.ts adds plan resolution: validate plan ID exists, resolve file path from PlanFile enum, then delegate to the core primitives.
- `src/features/sections/sections.test.ts` — move `tests/sections.test.ts` AND `tests/write-api.test.ts` writeSection/readSection blocks

After extracting all blocks, verify `tests/write-api.test.ts` is empty and delete it.

Confirm all tests pass.

### Phase 4: Extract epic, chunks, metrics

**epic:**
- Standard pattern: `logic.ts`, `command.ts`, `epic.test.ts`
- Move `tests/commands/epic.test.ts` AND epic describe blocks from `tests/api.test.ts`
- Delete `src/commands/epic.ts`

**chunks:**
- Standard pattern
- Move `tests/commands/chunks.test.ts` AND chunks describe blocks from `tests/api.test.ts`
- Delete `src/commands/chunks.ts`

**metrics:**
- Standard pattern
- Move `tests/commands/metrics.test.ts` AND `tests/api-metrics.test.ts` to `src/features/metrics/`
- Delete `src/commands/metrics.ts`

Confirm all tests pass.

## Testing

- After each feature extraction, run `npm test` and confirm test count stays stable.
- After Phase 4, run `npm run build` to confirm bundle still resolves all imports.
- Spot-check `trellis set`, `trellis epic`, `trellis chunks`, `trellis metrics` against a real plans directory.

## Done-when

- 7 new feature directories exist under `src/features/`: `set/`, `rename/`, `archive/`, `sections/`, `epic/`, `chunks/`, `metrics/`
- Each has `logic.ts`, `command.ts`, and `<name>.test.ts`
- `Trellis` class delegates all 7 methods to feature functions
- Old command files in `src/commands/` for these 7 features are deleted
- All tests pass (`npm test`)
- Bundle builds without error (`npm run build`)
