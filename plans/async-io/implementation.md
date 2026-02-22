## Steps
### Chunk 1: Async scanner + config loader

**Files:** `src/core/scanner.ts`, `test/scanner.test.ts`

**scanner.ts changes:**

```ts
import { readdir, stat, readFile, access } from 'fs/promises';
```

1. `walkDirAsync(dir: string, plansDir: string, plans: Plan[]): Promise<void>`
   - Replace `readdirSync(dir)` → `await readdir(dir)`
   - Replace `statSync(fullPath)` → `await stat(fullPath)`
   - Replace `existsSync(readmePath)` → try/catch `await access(readmePath)`
   - Replace `readFileSync(readmePath, 'utf8')` → `await readFile(readmePath, 'utf8')`
   - Replace `statSync(readmePath).mtime` → `(await stat(readmePath)).mtime`
   - Replace `readFileSync(filePath, 'utf8')` → `await readFile(filePath, 'utf8')` for implementation/inputs/outputs files
   - Replace `existsSync(filePath)` → try/catch `await access(filePath)` for optional files
   - All pure logic (frontmatter parsing, `derivePlanId`, etc.) stays identical
   - **Concurrency model:** Process entries sequentially within each directory. The sync version recurses and pushes to a shared `plans` array — the async version should do the same with `for...of` + `await`, not `Promise.all`. This keeps ordering deterministic and matching the sync output.

2. `scanPlansAsync(plansDir: string, options?: ScanOptions): Promise<Plan[]>`
   - Same shape as `scanPlans` but calls `walkDirAsync`
   - Returns `Promise<Plan[]>` instead of `Plan[]`

3. `loadConfigAsync(cwd: string): Promise<TrellisConfig>`
   - Three branches (must implement all to match sync `loadConfig`):
     - **(a)** `.trellis` doesn't exist → return `{ plans_dir: 'plans', project: basename(cwd) }`
     - **(b)** `.trellis` exists and is a directory → check `.trellis/config` exists → if yes, `await readFile('.trellis/config', 'utf8')` and call `parseConfigContent()` (pure); if no, return defaults
     - **(c)** `.trellis` exists and is a file → `await readFile('.trellis', 'utf8')` and call `parseConfigContent()` (pure), plus `process.stderr.write` tip about directory format
   - Uses `fs.promises.access` (existence), `fs.promises.stat` (directory check), `fs.promises.readFile`
   - Reuses `parseConfigContent()` unchanged (pure)

4. Export: add `scanPlansAsync`, `loadConfigAsync` to scanner.ts exports

**Tests:**
- Copy structure of existing `scanPlans` tests
- Use same fixtures
- Verify `await scanPlansAsync(dir)` deep-equals `scanPlans(dir)` for representative fixtures
- Verify `await loadConfigAsync(cwd)` deep-equals `loadConfig(cwd)`
- Edge cases: empty plans dir, missing config, malformed frontmatter, `.trellis` as file vs directory

---

### Chunk 2: Async context creation

**Files:** `src/core/context.ts`, `test/context.test.ts`

**context.ts changes:**

```ts
import { scanPlansAsync, loadConfigAsync } from './scanner.js';
import { discoverManifestAsync, fetchRepoPlansAsync } from './manifest.js';
import type { AsyncGitExecutor } from './manifest.js';
```

1. `resolveRemotePlansAsync(projectDir, config, options?)` — async version of `resolveRemotePlans()` (context.ts:75-121)
   - Same logic: check `config.manifest`, handle offline mode via `resolveFromCacheOnly` (already sync and cache-only, fine to call as-is)
   - Manifest resolution: `readCache` → if stale, `await discoverManifestAsync(config.manifest, projectDir)` → `writeCache`
   - Per-repo plan fetching: `readCache` → if stale, `await fetchRepoPlansAsync(alias, entry, projectDir)` → `writeCache`
   - `readCache`, `writeCache`, `isCacheStale` are sync (file I/O but small/fast) — acceptable for now, can be made async later if needed

2. `createContextAsync(projectDir: string, options?: CreateContextOptions): Promise<TrellisContext>`
   - `const config = await loadConfigAsync(projectDir)`
   - `const localPlans = await scanPlansAsync(plansDir, ...)`
   - `const { remotePlans, manifest } = await resolveRemotePlansAsync(projectDir, config, options)`
   - `const plans = remotePlans.length > 0 ? mergeWithRemote(localPlans, remotePlans, config.project) : localPlans`
   - `attachCompleteness(plans, config)` — stays sync (pure)
   - `const graph = buildGraph(plans)` — stays sync (pure)
   - Full feature parity with sync `createContext`

3. `refreshContextAsync(ctx: TrellisContext, options?: CreateContextOptions): Promise<TrellisContext>`
   - `const localPlans = await scanPlansAsync(ctx.plansDir, ...)`
   - `const { remotePlans, manifest } = await resolveRemotePlansAsync(ctx.projectDir, ctx.config, options)`
   - Rest identical to sync — preserves `ctx.config`

4. `createMultiContextAsync(repos: RepoSpec[]): Promise<MultiContext>`
   - Same alias uniqueness validation
   - **Use `Promise.allSettled`** (not `Promise.all`) to match sync version's per-repo try/catch:
     ```ts
     const results = await Promise.allSettled(
       repos.map(repo => scanOneRepoAsync(repo))
     );
     for (const [i, result] of results.entries()) {
       if (result.status === 'fulfilled') {
         // push plans, create entry
       } else {
         // create entry with error: result.reason.message
       }
     }
     ```
   - Each `scanOneRepoAsync` does: `loadConfigAsync` → `scanPlansAsync` → `attachCompleteness` → `qualifyPlan`
   - Per-repo `existsSync` config check → try/catch `await access()`

**Tests:**
- For each async function, verify output matches sync equivalent on same fixture
- `createMultiContextAsync` with one bad repo path → verify partial result (not rejection)
- Context with manifest → verify remote plans are present and match sync version

---

### Chunk 3: Promote async git helpers + add async manifest functions

**Files:** `src/core/manifest.ts`, `src/features/sync/logic.ts`, `test/manifest.test.ts`

**What exists in `src/features/sync/logic.ts` today:**
- `AsyncGitExecutor` interface (line 12)
- `defaultAsyncGit` executor (line 16)
- `ensureRemoteAsync` (line 30)
- `fetchRemoteAsync` (line 39)
- `gitShowAsync` (line 47)
- `gitListTreeAsync` (line 51)
- `fetchRepoPlansAsync` (line 57)
- `discoverManifestAsync` (line 132)
- `runWithConcurrency` (line 100)

**Step 1: Move to `manifest.ts`**

Move these declarations from `sync/logic.ts` to `manifest.ts`:
- `AsyncGitExecutor` interface
- `defaultAsyncGit`
- `ensureRemoteAsync`, `fetchRemoteAsync`, `gitShowAsync`, `gitListTreeAsync`
- `discoverManifestAsync`
- `fetchRepoPlansAsync`

Export `AsyncGitExecutor`, `defaultAsyncGit`, `discoverManifestAsync`, `fetchRepoPlansAsync` from `manifest.ts`.

`runWithConcurrency` stays in `sync/logic.ts` (it's a sync-feature utility, not manifest-specific).

**Step 2: Refactor `sync/logic.ts`**

Replace local definitions with imports:
```ts
import {
  AsyncGitExecutor, defaultAsyncGit,
  discoverManifestAsync, fetchRepoPlansAsync,
} from '../../core/manifest.ts';
```

`computeSync` stays in `sync/logic.ts` — only the git helpers move.

**Step 3: Add `resolveProjectReposAsync`**

New function in `manifest.ts`:
```ts
export async function resolveProjectReposAsync(manifestPath: string): Promise<ResolvedRepo[]> {
  const absPath = resolve(manifestPath);
  const content = await readFile(absPath, 'utf8');
  const manifest = parseManifest(content);
  // ... same logic as sync version
  // Replace existsSync(localPath) → try { await access(localPath); exists = true } catch { exists = false }
}
```

**Tests:**
- Run existing `sync.test.ts` — must pass unchanged after refactor (this is the key regression gate)
- Add test for `resolveProjectReposAsync` — verify output matches `resolveProjectRepos` for same manifest

---

### Chunk 4: Async store + cached context + exports

**Files:** `src/core/store.ts`, `src/core/cached-context.ts`, `src/index.ts`, `test/store.test.ts`

**store.ts changes:**

1. `computeMtimeHashAsync(plansDir: string): Promise<string | null>`
   - Uses `await readdir(plansDir, { recursive: true })` + `await stat(...)` per entry
   - **Must `.sort()` entries before hashing** — `readdir` ordering varies across platforms and Node versions. Sync version sorts via its recursive walk pattern; async version must sort explicitly to produce identical hashes.
   - Same SHA256 hash computation logic

2. `ContextStore.loadAsync(): Promise<MultiContext>`
   - Async counterpart of `load()` (store.ts:135-193)
   - Same structure: read index → for each repo, `loadRepoAsync` → build graph
   - `loadRepoAsync` private method: check `configMtime` and `mtimeHash` for cache hit, rescan on miss using `loadConfigAsync` + `scanPlansAsync`
   - Same graph serialization/deserialization logic for cache hits
   - Sets `this.context` and `this.index` — same contract as sync `load()`

3. No `getAsync()` needed — after `await store.loadAsync()`, callers use the existing sync `store.get()` which returns the cached result. This preserves the "must load before get" contract.

**cached-context.ts changes:**

4. `createCachedContextAsync(projectDir: string, options?: CachedContextOptions): Promise<CachedContextResult>`
   - Async version of `createCachedContext` (cached-context.ts:37-118)
   - Uses `loadConfigAsync` instead of `loadConfig`
   - Uses `resolveProjectReposAsync` instead of `resolveProjectRepos`
   - Uses `store.loadAsync()` instead of `store.load()`
   - Project-mode detection: replace `existsSync(candidate)` → try/catch `await access(candidate)`
   - `readFileSync(manifestPath, 'utf8')` for manifest parsing → `await readFile(manifestPath, 'utf8')`
   - `resolveFromCacheOnly` stays sync (all cache reads, no heavy I/O)
   - Returns same `CachedContextResult` type (ctx + persist function)

**index.ts changes:**

5. Add exports:
   ```ts
   export { scanPlansAsync, loadConfigAsync } from './core/scanner.js';
   export { createContextAsync, refreshContextAsync, createMultiContextAsync } from './core/context.js';
   export { resolveProjectReposAsync, AsyncGitExecutor, defaultAsyncGit, discoverManifestAsync } from './core/manifest.js';
   export { computeMtimeHashAsync } from './core/store.js';
   export { createCachedContextAsync } from './core/cached-context.js';
   ```

6. Verify: full test suite passes, no breaking changes to sync API
## Testing
**Strategy:** Each async function must produce output identical to its sync counterpart for the same input. This is the primary correctness invariant.

**Per-chunk tests:**

1. **Scanner tests** (`test/scanner.test.ts`)
   - `scanPlansAsync(fixtureDir)` deep-equals `scanPlans(fixtureDir)`
   - `loadConfigAsync(fixtureDir)` deep-equals `loadConfig(fixtureDir)`
   - Edge cases: empty plans dir, missing config, malformed frontmatter
   - Config branch coverage: no `.trellis`, `.trellis` directory, `.trellis` file (legacy)

2. **Context tests** (`test/context.test.ts`)
   - `await createContextAsync(fixtureDir)` deep-equals `createContext(fixtureDir)` — including remote plans if manifest configured
   - `await refreshContextAsync(ctx)` deep-equals `refreshContext(ctx)`
   - `await createMultiContextAsync(repos)` deep-equals `createMultiContext(repos)`
   - Partial failure: `createMultiContextAsync` with one bad repo path returns partial result (not rejection)

3. **Manifest tests** (`test/manifest.test.ts`)
   - `await resolveProjectReposAsync(path)` deep-equals `resolveProjectRepos(path)`
   - Refactor gate: existing `sync.test.ts` passes unchanged after moving async git helpers

4. **Store tests** (`test/store.test.ts`)
   - `await store.loadAsync()` deep-equals `store.load()` on same fixture
   - `computeMtimeHashAsync(dir)` equals `computeMtimeHash(dir)` — test on multiple platforms if possible
   - Cache hit: second `store.get()` call after `loadAsync()` returns same object without re-scanning

5. **Cached context tests**
   - `await createCachedContextAsync(dir)` produces context matching `createCachedContext(dir)`
   - Project-mode and single-repo-mode both tested

6. **Integration:** Full existing test suite passes unchanged (no sync API regressions)
## Done-when
- [ ] Async git helpers promoted from `sync/logic.ts` to `manifest.ts`; `sync/logic.ts` imports from there
- [ ] Existing `sync.test.ts` passes unchanged after refactor
- [ ] All async functions exported from `index.ts`: `scanPlansAsync`, `loadConfigAsync`, `createContextAsync`, `refreshContextAsync`, `createMultiContextAsync`, `resolveProjectReposAsync`, `computeMtimeHashAsync`, `createCachedContextAsync`
- [ ] Each async function returns identical results to its sync counterpart
- [ ] `createContextAsync` resolves remote plans (feature parity with sync `createContext`)
- [ ] `createMultiContextAsync` handles per-repo failures gracefully (partial results, not rejection)
- [ ] `computeMtimeHashAsync` sorts entries before hashing (platform-independent)
- [ ] All new async functions have tests
- [ ] Full existing test suite passes (no regressions to sync API)
- [ ] `npm run build` succeeds
- [ ] No new runtime dependencies added
