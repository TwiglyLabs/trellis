## Steps

1. Create `src/core/` directory and move the 8 shared modules into it: `types.ts`, `scanner.ts`, `graph.ts`, `frontmatter.ts`, `schema.ts`, `contracts.ts`, `manifest.ts`, `utils.ts`.

2. Create `src/core/context.ts` with the `TrellisContext` interface, `createContext()`, and `refreshContext()`. Extract the constructor logic from `src/api.ts` (`Trellis` class): `loadConfig`, `scanPlans`, `buildGraph` become the body of `createContext()`. `refreshContext()` calls `scanPlans` and `buildGraph` with the existing config and returns a new context object.

3. Create `src/core/index.ts` that re-exports everything from all 9 files in `src/core/` (the 8 moved modules plus `context.ts`).

3a. Verify no circular imports exist: core modules must import from each other directly (e.g., `import { Plan } from './types.ts'`), never through the barrel `./index.ts`. This avoids initialization ordering issues in the esbuild bundle.

4. Update `src/api.ts` to import from `./core` instead of individual `./scanner`, `./graph`, etc. paths. Replace the `Trellis` constructor body with a call to `createContext()`.

5. Update `src/mcp.ts` to import from `./core` where needed.

6. Update all 16 command files in `src/commands/*.ts` — each imports from `../api` (no change needed there) but any that import shared modules directly (e.g. `../types`, `../utils`) should be updated to `../core`.

7. Update `src/index.ts` to re-export from `./core` instead of the individual module paths.

8. Update all test files in `tests/` that import directly from `src/scanner`, `src/graph`, `src/types`, etc. to import from `src/core` or the barrel `src/core/index`.

9. Run `npm test` and fix any remaining import errors until all 606+ tests pass.

10. Run `npm run build` and verify the bundle builds without errors.

## Testing

- After step 3, run `npm run build` to catch any TypeScript path errors early.
- After step 4, run `trellis status` against a local plans directory to verify the Trellis class still works end-to-end.
- After step 8, run `npm test` — all tests should pass with no changes to test logic, only import paths.
- Spot-check `trellis ready`, `trellis show <id>`, and `trellis update <id> in_progress` to confirm live behavior is unchanged.

## Done-when

- All 8 shared modules live in `src/core/` and are gone from `src/` root.
- `src/core/context.ts` exports `TrellisContext`, `createContext()`, and `refreshContext()`.
- No file outside `src/core/` imports directly from the old `src/<module>` paths.
- `npm test` passes (all existing tests green, no new tests required).
- `npm run build` succeeds and the `trellis` binary behaves identically to before.
