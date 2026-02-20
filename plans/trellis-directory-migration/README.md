---
title: Migrate .trellis file to .trellis/ directory
status: done
description: >-
  Convert flat .trellis config file to a .trellis/ directory with config,
  .gitignore, and cache/ — prerequisite for cross-repo cache storage
tags:
  - infrastructure
not_started_at: '2026-02-20T22:38:00.174Z'
started_at: '2026-02-20T22:46:57.356Z'
completed_at: '2026-02-20T22:56:57.520Z'
---

## Problem

`.trellis` is a flat config file. There's nowhere to store local, non-committed state — like cached cross-repo plan data, fetch timestamps, or future local preferences. Adding more dotfiles (`.trellis-cache`, `.trellis-local`) is messy and doesn't scale.

Cross-repo operations (coming in cross-repo-graph) need a cache directory for fetched manifests and remote plan data. Without a cache, every `trellis ready` call would trigger git fetches to all sibling repos — adding seconds of latency to the most common command.

The `.trellis` file also locks us into a single flat namespace. A directory gives room for tracked config, ignored cache, and future extensibility without proliferating dotfiles.

## Approach
### New directory layout

```
.trellis/
  config              # same key=value format as today's .trellis file
  .gitignore          # ignores cache/
  cache/
    manifest.json     # cached ProjectManifest from last fetch
    plans/
      canopy.json     # cached Plan[] for each sibling repo
      grove.json
```

`config` is tracked in git (same content as today's `.trellis` file). `cache/` is gitignored — it's local, ephemeral, and rebuilt on `trellis fetch`.

Each cache file is self-describing — it wraps the payload with a `fetchedAt` timestamp:

```json
{
  "data": { ... },
  "fetchedAt": "2026-02-20T12:00:00.000Z"
}
```

No separate `meta.json`. Staleness is determined from the `fetchedAt` field in the cache entry itself.

### Backward-compatible config loading

`loadConfig()` detects whether `.trellis` is a file or directory:

- **File** — reads it directly, same as today. No behavior change. Emits a stderr hint on every invocation: "Tip: run `trellis init` to upgrade to directory format." (This runs once per command, not persisted — there's no local state to track "already shown.")
- **Directory** — reads `.trellis/config` with the same key=value parser.

This means every existing trellis project works unchanged after the upgrade. No forced migration.

### Init creates directory format

`trellis init` creates `.trellis/` directory with `config` and `.gitignore`.

When `.trellis` already exists, init uses `statSync().isDirectory()` to distinguish:
- **Directory** — already migrated. Run `setupMcpJson()` + `setupHooks()` idempotently, then return.
- **File** — offer to migrate: move file content to `.trellis/config`, create `.gitignore`, preserve existing values. `--yes` auto-migrates without prompting.

### Cache utilities

New `CacheEntry<T>` type:

```typescript
interface CacheEntry<T> {
  data: T;
  fetchedAt: string;  // ISO 8601
}
```

`ensureCacheDir(projectDir): string` — creates `.trellis/cache/` if it doesn't exist, returns the path. Called lazily by cross-repo fetch operations, not eagerly on every command.

`readCache<T>(projectDir, key): CacheEntry<T> | null` — reads and JSON-parses a cache file from `.trellis/cache/<key>.json`. Returns null if missing or corrupt. The caller unwraps `.data` for the payload and passes the whole entry to `isCacheStale()`.

`writeCache<T>(projectDir, key, data: T): void` — wraps `data` in a `CacheEntry` with `fetchedAt: new Date().toISOString()` and writes to `.trellis/cache/<key>.json`. Creates subdirectories as needed (e.g., `cache/plans/`).

`isCacheStale<T>(entry: CacheEntry<T>, maxAgeMs?: number): boolean` — compares `entry.fetchedAt` against `maxAgeMs` (default 300000ms = 5 min). Returns true if stale. Takes the cache entry directly — no filesystem access needed.

Cache keys map to filenames: `manifest` → `manifest.json`, `plans/canopy` → `plans/canopy.json`. Plans are cached per-repo, keyed by the manifest alias.

### Hook updates

**Both** hook scripts in `setup-hooks/logic.ts` reference `.trellis`:

1. **`PROTECT_PLANS_HOOK`** (Claude Code hook) — `find_project_root()` uses `[ -f "$dir/.trellis" ]`. The `PLANS_DIR` extraction uses `grep '^plans_dir:' "$PROJECT_ROOT/.trellis"`.

2. **Pre-commit hook** — uses `[ ! -f ".trellis" ]` and `grep '^plans_dir:' ".trellis"`.

Both must be updated to detect file-or-directory and read from the correct config path (`.trellis` if file, `.trellis/config` if directory).
