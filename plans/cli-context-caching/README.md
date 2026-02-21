---
title: Wire ContextStore into CLI commands
status: not_started
description: >-
  CLI commands use ContextStore for mtime-validated cached reads instead of full
  rescan
depends_on:
  - context-store-core
tags:
  - 'epic:perf-cache'
type: feature
not_started_at: '2026-02-21T23:46:24.180Z'
---

## Problem
CLI commands like `trellis status` are short-lived processes. They can't hold state in memory across invocations. Currently every CLI invocation does a full scan of all repos + git fetches for remote plans. With 17 repos and a manifest, this takes 32 seconds.

The CLI needs to read from a persistent index that was either built by a previous CLI invocation or kept hot by the MCP server.
## Approach
CLI commands use `ContextStore` in "load-use-persist" mode:

```
const store = new ContextStore({ repos, cacheDir })
store.load()      // reads index, mtime-validates, rescans only stale repos
const ctx = store.get()
// ... compute and display results ...
store.persist()   // write updated index for next invocation
```

**Repo discovery for CLI**: The CLI needs to know which repos to scan. In multi-repo mode this comes from `--project` / `--repos` flags. In single-repo mode, the current directory is the only repo. The store handles both shapes.

**Remote plans in CLI**: `store.load()` reads remote plans from cache only — never fetches from git. The `trellis sync` command (separate plan) handles fetching. If no cached remote data exists, remote plans are simply absent. The CLI should indicate this: `"Remote plans: cached (2h ago)"` or `"Remote plans: not synced"`.

**Cache location**: For `--project` mode, the index lives in the project manifest directory's `.trellis/cache/`. For single-repo mode, it lives in the repo's own `.trellis/cache/`. The MCP server and CLI share the same index file.

**Shared index safety**: The MCP server may be running and writing the index while the CLI reads it. Use atomic writes (write to temp file, rename) and `createFileLock()` from `mutex.ts` for concurrent write protection.

**Recovery**: If the index file is missing, corrupted, or has a version mismatch, the CLI falls back to full rescan gracefully — same behavior as today, just slower. The user sees no error; caching is transparent.

**Integration contract with MCP**: The CLI and MCP server share the same `PlanIndex` format (defined in context-store-core). Either process can write it, either can read it. The contract:
- Atomic writes guarantee no partial reads
- Version field enables forward compatibility
- File lock prevents concurrent write corruption
- Index is a cache — always safe to delete
## Steps
1. Update `statusCommand()` to use ContextStore instead of `createContext()`
2. Update `readyCommand()`, `showCommand()`, `graphCommand()`, `lintCommand()`, `bottlenecksCommand()` similarly
3. Add `--no-cache` flag to bypass the index and force full rescan
4. Add remote cache age indicator to status output
5. Update `writeCache()` to use atomic writes (write-tmp-rename)
6. Tests:
   - CLI reads from cached index when mtimes match
   - CLI rescans stale repo and persists updated index
   - CLI works with no existing index (cold start)
   - Atomic write prevents partial reads
