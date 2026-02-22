---
title: 'trellis sync: explicit remote fetch command'
status: done
description: >-
  New CLI command that fetches all remotes in parallel, updates the index cache.
  Decouples network I/O from reads.
depends_on: []
tags:
  - 'epic:perf-cache'
type: feature
not_started_at: '2026-02-21T23:46:54.727Z'
started_at: '2026-02-22T14:08:47.232Z'
completed_at: '2026-02-22T14:47:30.861Z'
---

## Problem
Remote plan fetching is currently inlined into every `trellis status` call, adding 30+ seconds of blocking git operations. There's no way to fetch remote data without also running a query. Users need an explicit command to refresh remote plans on their own schedule.
## Approach
Add `trellis sync` command that fetches all remote repos in parallel and updates the cache.

**Behavior:**
```
$ trellis sync
Fetching 16 repos...
  ✓ canopy (3 plans)
  ✓ birch (5 plans)
  ✗ oak (fetch failed — network timeout)
  ...
Synced 48 plans from 15/16 repos in 4.2s
```

**Parallelization**: Use a concurrency-limited pool (`Promise.allSettled` with semaphore, limit of 5) to run git fetch operations in parallel. Today they run sequentially — this alone cuts remote fetch time from ~32s to ~3-5s.

**Cache integration (no ContextStore dependency)**: Sync writes fetched remote plans directly to the existing `.trellis/cache/` format using `writeCache()`. This is the same cache that `resolveRemotePlans()` already reads from. No ContextStore required — sync produces cache files, and whatever reads them (current code today, ContextStore later) picks them up transparently.

This decoupling means `trellis sync` can ship independently and deliver the biggest user-facing performance win (32s → 3-5s) without waiting for the full caching stack.

**Flags:**
- `--repo <alias>` — sync only one repo
- `--json` — machine-readable output
- No `--watch` for now — keep it simple

**Manifest discovery**: `trellis sync` reads the manifest from the local `.trellis-project` file (if in a project dir) or fetches it from the configured `manifest:` git URL. The fetched manifest is cached using existing `writeCache()`.

**Error handling**: Partial failures are expected (network issues, deleted repos, auth problems). Sync reports per-repo success/failure with reason and exits with:
- Code 0 if at least one repo synced successfully
- Code 1 if all repos failed
- Summary line always printed: `"Synced N plans from X/Y repos in Z.Zs"`
## Steps
1. Create `src/features/sync/command.ts` — CLI registration with `--repo` and `--json` flags
2. Create `src/features/sync/logic.ts` — `computeSync()` that:
   - Resolves manifest (from local `.trellis-project` file or git fetch)
   - Fetches all repos in parallel with concurrency limit (5)
   - Writes each repo's plans to cache using existing `writeCache()`
   - Returns typed results per repo: `{ alias, status: 'ok' | 'error', plans?: Plan[], error?: string, durationMs: number }`
3. Implement concurrency-limited pool (simple semaphore or use `Promise.allSettled` with chunking)
4. Register command in `src/cli.ts`
5. Refactor `fetchRepoPlans()` in `src/core/manifest.ts` to support being called in parallel (ensure no shared mutable state)
6. Tests — see implementation.md Testing section
