---
title: Async I/O API Surface for Electron Integration
status: done
description: >-
  Add async variants of core trellis APIs so Electron main process can use
  non-blocking I/O. CLI retains sync APIs.
tags:
  - 'epic:responsive-app'
  - cross-repo
type: feature
not_started_at: '2026-02-22T23:00:41.590Z'
started_at: '2026-02-22T23:23:13.119Z'
completed_at: '2026-02-22T23:36:50.051Z'
---

## Problem
All trellis core I/O is synchronous: `readFileSync`, `readdirSync`, `statSync`, `existsSync`, `execFileSync`. This is fine for the CLI (single-shot process), but when called from Electron's main process it blocks the event loop and freezes the entire app.

**Hot paths that block Electron:**

| Function | What it does | Sync I/O |
|----------|-------------|----------|
| `createContext()` | Load config + scan plans + build graph | `readFileSync` × N plans, `readdirSync` recursive, `statSync` × 4N |
| `createMultiContext()` | Same as above, per repo | Multiplied by repo count |
| `loadConfig()` | Read `.trellis/config` | `existsSync`, `statSync`, `readFileSync` |
| `scanPlans()` | Walk plans directory tree | `readdirSync` recursive, `statSync` per entry, `readFileSync` × 4 per plan |
| `resolveProjectRepos()` | Parse manifest + resolve paths | `readFileSync`, `existsSync` per repo |
| `discoverManifest()` | Fetch manifest from git remote | `execFileSync('git', ...)` with 30s timeout |

A cold `createMultiContext()` for 5 repos × 40 plans takes 100-200ms of solid main-thread blocking. With git remote operations, it can reach seconds. During this time Electron cannot handle IPC, repaint windows, or process input.

Canopy currently wraps these sync calls in `async` IPC handlers, but that's cosmetic — the sync work still blocks the event loop.
## Approach
Add **async variants** of the core APIs alongside the existing sync versions. The sync APIs stay for CLI backward compatibility. The async APIs use `fs.promises.*` and `child_process.execFile` (callback/promise).

**Design principles:**

1. **Dual API surface** — every sync function that does I/O gets an `Async` sibling. Sync stays for CLI, async for Electron.
2. **Shared pure logic** — graph computation, frontmatter parsing, YAML parsing are already sync and CPU-only. These don't need async variants.
3. **Bottom-up** — start with the lowest-level I/O (scanner, config reader) and build up to `createContextAsync()` / `createMultiContextAsync()`.
4. **Same types** — async functions return `Promise<T>` where sync returns `T`. No new result types needed.
5. **Cache-aware** — the existing `ContextStore` mtime-based caching works well. The async variant should use it too.
6. **Reuse existing async code** — `src/features/sync/logic.ts` already has `AsyncGitExecutor`, `discoverManifestAsync`, `fetchRepoPlansAsync`, and async git helpers. Promote these to shared locations rather than duplicating them.

**What changes vs what doesn't:**

| Layer | Changes | Stays the same |
|-------|---------|----------------|
| Scanner (`scanner.ts`) | `walkDirAsync`, `scanPlansAsync`, `loadConfigAsync` | Plan parsing logic, `parseConfigContent` (pure) |
| Context (`context.ts`) | `createContextAsync`, `createMultiContextAsync`, `refreshContextAsync`, `resolveRemotePlansAsync` | `buildGraph` (in graph.ts, pure), `applyBatch` (pure) |
| Manifest (`manifest.ts`) | Promote `AsyncGitExecutor` + async helpers from `sync/logic.ts` here; add `resolveProjectReposAsync` | `parseManifest`, `checkVisibility` (pure) |
| Sync feature (`sync/logic.ts`) | Refactor to import async git helpers from `manifest.ts` | `computeSync` orchestration logic |
| Store (`store.ts`) | `ContextStore.loadAsync()`, `computeMtimeHashAsync` | `get()` contract unchanged |
| Cached context (`cached-context.ts`) | `createCachedContextAsync` | — |
| Features | No changes needed | All `compute*` functions are pure |
| Exports (`index.ts`) | Add async exports | All existing exports stay |

**Key constraint:** `ContextStore.get()` throws if called before `load()`. The async path follows the same contract: callers must `await store.loadAsync()` before calling `store.get()`. No lazy self-initialization — parity with sync API.
## Steps
### Chunk 1: Async scanner + config loader

**Goal:** Non-blocking plan directory traversal and config reading.

1. Add `walkDirAsync(dir, plansDir, plans)` in `scanner.ts` — uses `fs.promises.readdir` + `fs.promises.stat` for recursive traversal. Same mutation pattern as sync `walkDir` (pushes to `plans` array). Process entries sequentially within each directory (or use `Promise.all` for stat calls but keep recursive calls sequential — JS single-threading makes parallel pushes safe, but sequential is clearer).
2. Add `scanPlansAsync(plansDir, options?)` in `scanner.ts` — uses `walkDirAsync`, then `fs.promises.readFile` for each plan file (README.md, implementation.md, inputs.md, outputs.md). Reuses existing `parseFrontmatter`/parse logic unchanged.
3. Add `loadConfigAsync(cwd)` in `scanner.ts` — three branches mirroring sync `loadConfig`: (a) no `.trellis` → return defaults, (b) `.trellis` is a directory → check `.trellis/config` → read or return defaults, (c) `.trellis` is a file → read directly + stderr tip. Uses `fs.promises.access` + `fs.promises.stat` + `fs.promises.readFile`. Reuses `parseConfigContent()` (pure) unchanged.
4. Tests: mirror existing scanner tests (`scanner.test.ts`) for async variants. Verify `scanPlansAsync` produces identical output to `scanPlans` for the same fixture.

### Chunk 2: Async context creation

**Goal:** Non-blocking `createContextAsync()` and `createMultiContextAsync()`.

1. Add `resolveRemotePlansAsync(projectDir, config, options?)` in `context.ts` — async version of `resolveRemotePlans()`. Uses `discoverManifestAsync` (from manifest.ts, promoted in Chunk 3) for manifest resolution, `fetchRepoPlansAsync` for per-repo plan fetching. Same cache read/write logic (`readCache`, `writeCache`, `isCacheStale`). Falls back to `resolveFromCacheOnly` in offline mode.
2. Add `createContextAsync(projectDir, options?)` in `context.ts` — calls `loadConfigAsync` → `scanPlansAsync` → `resolveRemotePlansAsync` → `mergeWithRemote` → `buildGraph` (sync, pure). Returns `Promise<TrellisContext>`. Full feature parity with sync `createContext`.
3. Add `refreshContextAsync(ctx, options?)` — same pattern, preserves config.
4. Add `createMultiContextAsync(repos)` — uses `Promise.allSettled` (not `Promise.all`) for parallel per-repo scanning, matching the sync version's per-repo try/catch error handling. Rejected settlements produce `MultiRepoEntry` with error, successful ones contribute plans. Major perf win over sequential sync.
5. Tests: verify async context matches sync context output for same fixture input, including manifests with remote plans.

### Chunk 3: Promote async git helpers + add async manifest functions

**Goal:** Consolidate existing async git code, add missing async manifest functions.

`src/features/sync/logic.ts` already has `AsyncGitExecutor`, `defaultAsyncGit`, `discoverManifestAsync`, `fetchRepoPlansAsync`, and async git helpers (`ensureRemoteAsync`, `fetchRemoteAsync`, `gitShowAsync`, `gitListTreeAsync`). Rather than duplicate, promote to shared locations.

1. Move `AsyncGitExecutor` interface and `defaultAsyncGit` to `manifest.ts` (alongside the existing sync `GitExecutor`). Export from there.
2. Move `ensureRemoteAsync`, `fetchRemoteAsync`, `gitShowAsync`, `gitListTreeAsync` to `manifest.ts`.
3. Move `discoverManifestAsync` and `fetchRepoPlansAsync` to `manifest.ts`.
4. Refactor `sync/logic.ts` to import these from `manifest.ts` instead of defining them locally. `computeSync` stays in `sync/logic.ts`.
5. Add `resolveProjectReposAsync(manifestPath)` in `manifest.ts` — the only truly new function. Uses `fs.promises.readFile` for manifest, `fs.promises.access` for path checks. Reuses `parseManifest`, `expandTilde`, `checkVisibility` (pure).
6. Tests: verify existing `sync.test.ts` still passes after the refactor. Add test for `resolveProjectReposAsync`.

### Chunk 4: Async store + cached context + exports

**Goal:** Wire everything up and export.

1. Add `computeMtimeHashAsync(plansDir)` in `store.ts` — uses `fs.promises.readdir` + `fs.promises.stat`. **Must sort entries before hashing** to match sync version's behavior (readdir ordering can vary across platforms/Node versions).
2. Add `ContextStore.loadAsync()` — async counterpart of `load()`. Uses `computeMtimeHashAsync` for cache validation, `loadConfigAsync` + `scanPlansAsync` on cache miss. Same `loadRepo` private method gets an async counterpart (`loadRepoAsync`). Same contract as sync `load()`.
3. `ContextStore.get()` works unchanged — callers do `await store.loadAsync()` then `store.get()`. No lazy `getAsync` needed; `get()` is already sync and instant after load.
4. Add `createCachedContextAsync(projectDir, options?)` in `cached-context.ts` — async version of `createCachedContext`. Uses `loadConfigAsync`, `resolveProjectReposAsync`, `store.loadAsync()`. Same project-mode detection logic, same cache-miss fallback behavior.
5. Export all async variants from `index.ts`.
6. Verify no breaking changes to existing sync exports (run full test suite).
