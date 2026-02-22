---
title: Wire ContextStore into MCP server with fs.watch
status: done
description: >-
  Replace getToolContext() rebuild-from-scratch with ContextStore.get(), add
  fs.watch for live invalidation
depends_on:
  - context-store-core
tags:
  - 'epic:perf-cache'
type: feature
not_started_at: '2026-02-21T23:46:39.576Z'
started_at: '2026-02-22T05:09:50.834Z'
completed_at: '2026-02-22T13:57:27.296Z'
---

## Problem
The MCP server is a long-running process that lives for the entire Claude Code session, but `getToolContext()` rebuilds everything from scratch on every single tool call. With 17 repos, this means every `trellis_status`, `trellis_ready`, etc. pays the full scan cost. There's no reason for this — the server could hold the context in memory and update it incrementally.
## Approach
Replace the stateless `getToolContext()` function in `mcp.ts` with a `ContextStore` instance that:

1. **On server start**: `store.load()` — full scan, populate cache
2. **Immediately after**: `store.watch()` — start watching all repo plan dirs for live invalidation
3. **On read tool calls** (status, ready, show, graph, lint, bottlenecks): `store.get()` — return cached context, sub-millisecond
4. **On write tool calls** (create, write_section, update, set): perform the write, then `store.invalidate(alias)` to trigger immediate rescan of the affected repo

**Watch lifecycle**: The MCP server owns the watch lifecycle. It calls `store.watch()` at startup and the returned `WatchHandle.close()` on shutdown. The ContextStore provides the watch capability; the MCP server decides when to use it. CLI commands never watch (short-lived).

Under the hood, `store.watch()` uses the existing `watchPlans()` from `src/features/watch/logic.ts`, which handles fs.watch setup, debouncing, and `PlanChangeEvent` classification. Changes flow through `applyBatch()` + `patchGraph()` for incremental updates — no full rescans on file-change events.

**Write-then-read consistency**: After a write operation, the store must reflect the change before returning the response. Use synchronous invalidation (Option A): write operation calls `invalidate(alias)` which rescans synchronously before returning. Simple, correct, adds ~10ms. Correctness over cleverness.

**Watcher echo suppression**: When a write tool modifies a file, fs.watch will fire. The store suppresses redundant rescans if a manual `invalidate()` already handled the change. Mechanism: "last invalidated at" timestamp per repo — if a watch event arrives within the debounce window of a manual invalidate, skip it.

**Index persistence for CLI**: The MCP server calls `store.persist()` after write mutations so the CLI can benefit from the warm cache. This means during an active MCP session, CLI invocations get near-instant responses from the shared index.

**Shutdown**: On process exit or transport close, call `watchHandle.close()` and `store.persist()` for clean teardown and a fresh index for next startup.
## Steps
1. In `mcp.ts`, replace the closure-scoped `getToolContext()` with a `ContextStore` instance created at server startup
2. Wire `store.load()` + `store.watch()` into `startMcpServer()` initialization
3. Update all read-only tool handlers to use `store.get()` instead of `getToolContext()`
4. Update write tool handlers to call `store.invalidate(alias)` after mutations, then `store.persist()`
5. Handle server shutdown: `watchHandle.close()` + `store.persist()` on process exit / transport close
6. Remove the existing no-op `refresh: () => {}` callback from write handlers
7. Tests — see implementation.md Testing section
