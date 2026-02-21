---
title: 'ContextStore: cached, mtime-validated plan index'
status: not_started
description: >-
  Core ContextStore class with file-based index, mtime validation, and
  incremental rescan
tags:
  - 'epic:perf-cache'
type: feature
not_started_at: '2026-02-21T23:46:09.092Z'
---

## Problem
Every trellis operation rebuilds the entire world from scratch: scan 17 repos, read every plan file, parse YAML frontmatter, compute SHA256 hashes, score completeness, build the dependency graph. This takes ~160ms for local-only and 32s when remote git fetches are included. The MCP server (a long-running process) throws away its context between every tool call. The CLI (short-lived) has no way to reuse work from previous invocations.

Both paths need a shared caching layer that:
- Persists parsed plan data to a file-based index
- Validates cache freshness cheaply (mtime comparison, not content reads)
- Only rescans repos whose plan files actually changed
- Rebuilds the graph only when the plan set changes
## Approach
Build a `ContextStore` class in `src/core/store.ts` that wraps the existing `createMultiContext` / `createContext` logic with a persistent file-based index and mtime-based invalidation.

**Index format** — a JSON file stored at the project cache location:
```json
{
  "version": 1,
  "repos": {
    "canopy": {
      "path": "/abs/path/to/canopy",
      "configMtime": "2026-02-21T...",
      "mtimeHash": "<hash of all plan file mtimes>",
      "scannedAt": "2026-02-21T...",
      "plans": [ /* full Plan[] data */ ]
    }
  },
  "remotePlans": { /* keyed by alias */ },
  "graphSnapshot": { /* optional precomputed graph */ }
}
```

**Mtime validation** — on `load()`, for each repo:
1. Walk plan directories doing `stat()` only (no file reads)
2. Compute a composite hash from all plan file mtimes
3. Compare to cached `mtimeHash`
4. If match → use cached plans (zero I/O beyond stat)
5. If mismatch → full rescan of that repo only

**API surface:**
```typescript
class ContextStore {
  constructor(opts: { repos: RepoSpec[]; cacheDir: string })
  load(): MultiContext           // read index, validate, rescan stale
  get(): MultiContext            // return current (must call load first)
  watch(): WatchHandle           // start fs.watch, incremental updates
  invalidate(alias: string): void // mark repo stale, rescan, rebuild graph
  persist(): void                // write index to disk atomically
}
```

**Key design decisions:**
- ContextStore works with `MultiContext` (the multi-repo shape). Single-repo mode is just a MultiContext with one repo.
- The existing `createContext` / `createMultiContext` remain as the "no-cache, always-fresh" path for tests and simple scripting.
- `watch()` wraps the existing `watchPlans()` from `src/features/watch/logic.ts` internally — no reimplementation of fs.watch debouncing or event classification.
- Write operations (from MCP) can call `invalidate(alias)` to trigger immediate rescan rather than waiting for debounce.

**Building on existing primitives:**

The codebase already has infrastructure that ContextStore must compose, not reimplement:

| Primitive | Location | How ContextStore uses it |
|---|---|---|
| `watchPlans(plansDir, cb)` | `src/features/watch/logic.ts` | `watch()` wraps this, one per repo |
| `applyBatch(ctx, batch)` | `src/core/context.ts` | Watch events → incremental context update |
| `patchGraph(graph, changes)` | `src/core/graph.ts` | Incremental graph rebuild after batch |
| `buildHashMap(plansDir)` | `src/features/watch/logic.ts` | Initial hash state for change detection |
| `createFileLock()` | `src/core/mutex.ts` | Concurrent index access protection |
| `refreshContext(ctx)` | `src/core/context.ts` | Fallback for full rescan path |

When `watch()` detects changes, it pipes `PlanChangeBatch` through `applyBatch()` + `patchGraph()` for incremental updates. Full rescans via `scanPlans()` are only needed on `load()` when the mtime hash diverges (cold start, changes between CLI invocations).

**Config-level invalidation:**

The `.trellis` config file determines plan directory location and other settings. The index tracks each repo's config file mtime as `configMtime`. During `load()`, if config mtime changed, the entire repo entry is invalidated — the plan directory may have moved or settings changed.

**Recovery policy:**

The index is a cache, not source of truth. Plan files on disk are always authoritative. Recovery is always "delete and rebuild":

- Index JSON fails to parse → delete index, full rescan, log warning
- Index `version` doesn't match current → delete index, full rescan
- Indexed plan references a file that no longer exists on disk → prune from index, rebuild graph
- `persist()` fails (disk full, permissions) → log warning, continue without cache (next invocation does full scan)

Atomic writes (write to temp file, `fs.renameSync()`) ensure a crash during `persist()` never leaves a corrupted index.

**Edge cases:**

- **Deleted plan files**: mtime hash changes → rescan detects missing files → plans pruned from index
- **Empty plans directory**: valid state, results in empty plan array for that repo
- **Clock skew / mtime goes backward** (git checkout, backup restore): mtime hash still changes (different composite value), triggering rescan. The hash is a fingerprint of all mtimes, not a "newer than" check.
- **Symlinked plan directories**: `stat()` follows symlinks by default; works correctly
- **New repo added to manifest**: absent from index → treated as stale → full scan of that repo
- **Plans directory doesn't exist**: handled gracefully — empty plan set, no error
## Steps
1. Define the `PlanIndex` type (the JSON schema for the index file) in `src/core/types.ts` — include `version`, per-repo `configMtime`, `mtimeHash`, `scannedAt`, `plans[]`
2. Implement `computeMtimeHash(plansDir)` — stat-only directory walk returning a composite hash of all plan file mtimes
3. Implement `ContextStore` class in `src/core/store.ts`:
   - Constructor takes repos + cacheDir
   - `load()` — read index (with recovery on parse failure), check config mtime, mtime-validate per repo, rescan stale repos using existing `scanPlans()`, rebuild graph only if plan set changed
   - `get()` — return cached MultiContext
   - `invalidate(alias)` — mark repo stale, rescan, use `patchGraph()` for incremental graph update
   - `persist()` — atomic write (write to temp file, `fs.renameSync()`) of index to disk, guarded by `createFileLock()`
4. Implement `watch()` — wraps existing `watchPlans()` per repo, pipes `PlanChangeBatch` through `applyBatch()` + `patchGraph()` for incremental updates. Returns `WatchHandle` for cleanup.
5. Add recovery logic: parse failure → full rebuild, version mismatch → full rebuild, missing files → prune + rebuild graph
6. Add config mtime tracking: check `.trellis` config file mtime during `load()`, invalidate repo if changed
7. Export `ContextStore` from `src/index.ts` (library surface)
8. **Test fixture infrastructure**: Create `createTestFixture(repoCount, plansPerRepo)` helper in `src/__tests__/fixtures/` that scaffolds temp repos with plans — reusable by all `epic:perf-cache` plan tests
9. Tests — see implementation.md Testing section
