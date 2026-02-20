---
title: Migrate .trellis file to .trellis/ directory
status: draft
description: >-
  Convert flat .trellis config file to a .trellis/ directory with config,
  .gitignore, and cache/ — prerequisite for cross-repo cache storage
tags:
  - infrastructure
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
    meta.json         # fetch timestamps and TTL metadata
```

`config` is tracked in git (same content as today's `.trellis` file). `cache/` is gitignored — it's local, ephemeral, and rebuilt on `trellis fetch`.

### Backward-compatible config loading

`loadConfig()` detects whether `.trellis` is a file or directory:

- **File** — reads it directly, same as today. No behavior change. Emits a one-time stderr hint: "Run `trellis init` to upgrade to directory format."
- **Directory** — reads `.trellis/config` with the same key=value parser.

This means every existing trellis project works unchanged after the upgrade. No forced migration.

### Init creates directory format

`trellis init` creates `.trellis/` directory with `config` and `.gitignore`. Existing `trellis init` on a repo that already has a `.trellis` file offers to migrate (move file content to `.trellis/config`, create `.gitignore`).

### Cache utilities

`ensureCacheDir(projectDir): string` — creates `.trellis/cache/` if it doesn't exist, returns the path. Called lazily by cross-repo fetch operations, not eagerly on every command.

`readCache(projectDir, key): T | null` — reads and JSON-parses a cache file. Returns null if missing or corrupt.

`writeCache(projectDir, key, data, ttl?): void` — writes JSON to cache with timestamp in `meta.json`.

`isCacheStale(projectDir, key, maxAge): boolean` — checks meta.json timestamp against maxAge (default 5 minutes).

### Hook update

`protect-plans.sh` currently uses `[ -f "$dir/.trellis" ]` to find the project root. Updated to check for both file and directory: `[ -f "$dir/.trellis" ] || [ -f "$dir/.trellis/config" ]`.
