## Steps


## Testing
### Unit tests

**computeMtimeHash:**
- Returns consistent hash for unchanged directory
- Returns different hash after touching a plan file
- Handles empty plans directory (returns stable empty hash)
- Handles missing plans directory (throws or returns null — design decision)

**Cache hit path:**
- `load()` returns cached plans when all repo mtimes unchanged
- Verify `scanPlans()` is NOT called on cache hit (spy/mock)
- Graph is deserialized from snapshot, not rebuilt

**Cache miss path:**
- `load()` rescans only the repo whose mtime hash changed
- Other repos remain cached (their `scanPlans()` not called)
- Graph is rebuilt only if plan set changed (new/removed plans)

**Index round-trip:**
- `persist()` then `load()` produces identical MultiContext
- Plan data survives serialization (all fields preserved)
- Graph snapshot survives serialization

**invalidate(alias):**
- Triggers rescan of target repo only
- Graph is rebuilt via `patchGraph()`, not full `buildGraph()`
- Other repos untouched

**persist() atomicity:**
- Temp file is created during write
- Final index file is valid JSON (no partial writes)
- Concurrent `persist()` calls don't corrupt (file lock)

**Config mtime tracking:**
- Config file change → entire repo invalidated on next `load()`
- Config file unchanged → repo validated normally via plan mtimes

### Recovery tests

- Corrupted index (invalid JSON) → `load()` succeeds via full rescan, logs warning
- Version mismatch (index says version 0) → `load()` succeeds via full rescan
- Indexed plan file deleted from disk → `load()` prunes it, graph reflects removal
- `persist()` failure (e.g., read-only directory) → operation continues, no crash

### Watch tests

- Watch detects new plan file → context updated with new plan
- Watch detects plan file modification → plan data updated in context
- Watch detects plan file deletion → plan removed from context, graph updated
- Rapid changes debounced → single batch applied (verify via `applyBatch` call count)
- Echo suppression: `invalidate()` then watch event within debounce → no double rescan

### Edge case tests

- Empty plans directory → valid context with zero plans
- Plans directory doesn't exist → no crash, empty plan set
- Concurrent `load()` from two processes → both succeed (file lock)
- New repo not in index → treated as cache miss, full scan

### Performance fixture

- `createTestFixture(repoCount, plansPerRepo)` creates temp directories with realistic plan files
- Benchmark: cold start with 5 repos × 20 plans completes in < 500ms
- Benchmark: warm cache hit with same fixture completes in < 20ms
- Benchmarks run in CI (vitest bench or manual timing assertions) to catch regressions
## Done-when
- [ ] `ContextStore` class passes all unit, recovery, watch, and edge case tests
- [ ] Warm cache `load()` performs zero file reads — only `stat()` calls and index deserialization
- [ ] Cold start produces a `MultiContext` identical to `createMultiContext()` (diff-tested)
- [ ] Recovery from corrupted/missing/version-mismatched index is automatic and silent
- [ ] `watch()` uses existing `watchPlans()` + `applyBatch()` + `patchGraph()` — no reimplemented watch or graph logic
- [ ] `persist()` uses atomic writes — no partial index files possible
- [ ] Config mtime changes invalidate the affected repo
- [ ] Test fixture builder (`createTestFixture`) is exported and usable by downstream plans
- [ ] Performance benchmarks pass in CI
