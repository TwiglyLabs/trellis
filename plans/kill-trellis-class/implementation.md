## Steps

1. Audit and update `src/index.ts` — replace the `Trellis` class export and all re-exports from `api.ts` with direct exports of `createContext` from `core/context.ts` and individual feature functions from `features/*/logic.ts`. The ~20 result types (`StatusResult`, `ReadyResult`, `ShowResult`, etc.) should already live in their respective feature `logic.ts` files after the feature-slices batches.

2. Update `src/mcp.ts` — replace `new Trellis(process.cwd())` construction and method calls with `createContext()` + direct feature function imports. Note: `getTrellis()` currently creates a fresh `new Trellis(process.cwd())` per tool call with no cross-call caching. Replace with `createContext(process.cwd())` per call — same rebuild-from-scratch behavior, no performance change.

3. Delete `src/api.ts` — at this point nothing should import from it. Confirm with `grep -r "from.*api"` before deleting.

4. Fix test files — search for `new Trellis` and `from.*api` across all test files in `src/`. The main patterns to replace:
   - `import { Trellis } from '...'` → `import { createContext } from '../core'` (or appropriate relative path)
   - `const t = new Trellis(dir)` → `const ctx = createContext(dir)`
   - `t.status(...)` → `import { computeStatus } from '../features/status/logic'; computeStatus(ctx, ...)`
   - Similar for each feature function call

   Most test files in `src/features/*/` should already use the feature's logic function directly (established in the feature-slices batches). Focus on integration tests in `src/__tests__/` and any remaining direct Trellis class usage.

5. Delete `src/__tests__/api.test.ts` — the remaining 'Trellis class' and 'Trellis: empty project' describe blocks test the class being removed. No migration needed; the construction behavior is replaced by `createContext()` tests in `src/core/context.test.ts` (created in core-extraction).

6. Build and run full test suite — `npm run build && npm test`.

## Testing

- All 606+ existing tests pass after the refactor (no new behavior, pure structural change).
- `grep -r "new Trellis\|from.*api" src/` returns no matches after step 4-5. (The `tests/` directory was deleted in batch-3.)
- `trellis status`, `trellis ready`, `trellis mcp` smoke-test correctly against a local plans directory.
- MCP server starts and responds to a `trellis_create` call via stdio.

## Done-when

- `src/api.ts` is deleted.
- `src/index.ts` exports `createContext` and feature functions; no reference to `Trellis`.
- `src/mcp.ts` uses functional API only.
- All tests pass (`npm test` green).
- Build succeeds (`npm run build` produces `dist/trellis.cjs`).
