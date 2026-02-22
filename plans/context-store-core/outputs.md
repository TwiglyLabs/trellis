
## Exports

### `ContextStore` class — `src/core/store.ts`

```typescript
class ContextStore {
  constructor(opts: { repos: RepoSpec[]; cacheDir: string })
  load(): MultiContext           // read index, validate mtimes, rescan stale repos
  get(): MultiContext            // return cached context (must call load first)
  watch(onChange?): WatchHandle  // start fs.watch, incremental patchGraph updates
  invalidate(alias: string): void // rescan single repo via patchGraph
  persist(): Promise<void>      // atomic write index to disk
}
```

### `computeMtimeHash(plansDir)` — `src/core/store.ts`

Returns a 32-char hex hash of all plan file mtimes under a directory. Returns `null` if the directory doesn't exist.

### `PlanIndex` / `RepoIndexEntry` types — `src/core/types.ts`

Index schema for the JSON cache file. Includes per-repo `configMtime`, `mtimeHash`, `scannedAt`, `plans[]`, and an optional `graphSnapshot`.

### `createTestFixture(repoCount, plansPerRepo)` — `src/__tests__/fixtures/context-store.ts`

Scaffolds temp repos with `.trellis` config and plan files. Returns `{ repos, repoSpecs, cacheDir }`. Reusable by downstream `epic:perf-cache` plans.
