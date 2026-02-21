---
title: Watch API with Incremental Graph Updates
status: archived
description: >-
  File watching, granular change events, and partial graph rebuild so Canopy can
  subscribe instead of polling
tags:
  - canopy
  - performance
depends_on:
  - recency-metadata
---

## Problem
Trellis exposes a library API (`createContext`, `buildGraph`, `scanPlans`) that consumers such as Canopy use to build and maintain a live view of plan graphs. Canopy already integrates chokidar to watch plan directories and reacts to file-system events by triggering a full `scanPlans()` + `buildGraph()` cycle on every change.

This full-rebuild approach has several compounding problems:

**Granularity: no indication of what changed.** When chokidar fires, Canopy only knows "something in this directory changed." It cannot tell whether a plan was added, removed, or which of its files (README.md, implementation.md, inputs.md, outputs.md) was modified. Without that signal, there is no choice but to re-scan everything and reconstruct the entire graph from scratch.

**Redundant I/O at scale.** A typical project has 20–50 plans, each with 2–4 files. A single keystroke in one plan's implementation.md causes all 80–200 files to be read, parsed, and re-graphed. At <30 total plans this is imperceptible, but the cost grows linearly with repo size and is paid on every save.

**Cross-repo amplification.** Canopy watches multiple repos simultaneously and maintains a merged cross-repo graph. When any file changes in any repo, the current architecture rebuilds the entire combined graph — re-scanning all repos, not just the one that changed. A change in repo A forces a full re-parse of repos B, C, and D even though their files are untouched.

**Phantom rebuilds.** Many editors write files without changing content (format-on-save, auto-import sorting, LSP side effects). Because Trellis has no per-file content hash, every write triggers a full rebuild even when the parsed result would be identical.

**Ownership mismatch.** Canopy duplicates the file-watching concern: it maintains its own chokidar instances, debounce timers, and glob filters that partially mirror what a first-class Trellis watch API would provide. Trellis is the authoritative source of plan structure but provides no watching primitive, leaving consumers to re-implement the plumbing inconsistently.

The result is an architecture that works acceptably for small, single-repo setups but will exhibit visible latency and unnecessary CPU/IO pressure as project counts and repo counts grow.
## Approach
Add a `watchPlans(plansDir, callback)` function to the Trellis library that owns the file-watching concern, emits granular typed events, and pairs with a `patchGraph()` helper for incremental graph updates. Canopy (and any other consumer) replaces its custom chokidar wiring with a single call to `watchPlans()`.

### Granular event types

Define a `PlanChangeEvent` discriminated union:

```ts
type PlanFileKind = 'readme' | 'implementation' | 'inputs' | 'outputs';

type PlanChangeEvent =
  | { type: 'plan-added';   planId: string; plan: Plan }
  | { type: 'plan-removed'; planId: string }
  | { type: 'plan-updated'; planId: string; file: PlanFileKind; plan: Plan };
```

`watchPlans(plansDir, callback)` sets up a chokidar watcher scoped to `plansDir`, maps raw fs paths to plan IDs and file kinds, and invokes `callback` with the appropriate event. The watcher handles the full plan-directory lifecycle: new directories appearing, directories being removed, and individual files within existing plan directories being modified.

### Content hashing to skip phantom rebuilds

Before re-parsing a file, compute SHA-256 of its raw content and compare against a per-file hash stored in a `Map<filePath, string>`. If the hash is unchanged, skip parsing and suppress the event entirely. This eliminates spurious rebuilds from editor autosave, LSP writes, and format-on-save passes that do not alter the semantic content.

### Debounced batch emission

Raw fs events from chokidar can arrive in rapid bursts (e.g., an editor writing multiple plan files in sequence). Buffer incoming events within a 100 ms window and emit a single `PlanChangeBatch` to the callback rather than one call per file. The batch preserves the full set of individual `PlanChangeEvent` items so consumers can still react per-plan if needed.

### Incremental graph patching with `patchGraph`

```ts
function patchGraph(graph: GraphData, events: PlanChangeEvent[]): GraphData
```

Rather than rebuilding the entire graph, `patchGraph` applies a minimal set of mutations:

- **plan-updated**: Re-insert the updated plan node. Recompute `ready` / `blocked` status for the plan and its immediate dependents (one hop). Other nodes are untouched.
- **plan-added**: Insert the new node. Walk existing nodes to resolve any dep references that were previously dangling because this plan did not exist.
- **plan-removed**: Remove the node and its edges. Mark all direct dependents as blocked. Clear any dep reference that pointed to the removed plan.

`patchGraph` returns a new `GraphData` object (immutable update pattern) so consumers can use referential equality to detect changes.

### Multi-repo support

```ts
function watchMultiRepo(
  repos: Array<{ alias: string; plansDir: string }>,
  callback: (alias: string, batch: PlanChangeBatch) => void
): WatchHandle
```

`watchMultiRepo` creates one `watchPlans` watcher per repo and qualifies every event with the repo `alias` before forwarding to the shared callback. This lets Canopy maintain per-repo graphs and patch only the affected repo's graph on each event, leaving the others untouched.

### Canopy migration path

1. Remove Canopy's existing chokidar dependency and custom debounce logic for plan directories.
2. Call `watchPlans()` (or `watchMultiRepo()`) from the Trellis service.
3. On each batch callback, call `patchGraph()` with the current graph and the received events to produce an updated graph.
4. Broadcast `trellis:plan-changed` with the patched graph as before.

The existing full-scan path (`scanPlans()` + `buildGraph()`) remains available as a fallback for cold starts, forced refreshes, and any scenario where the incremental state may be out of sync. `watchPlans` is an optimization layer on top of the existing API, not a replacement.

### Library exports

Add to the public library entry point:

```ts
export { watchPlans } from './watch';
export { watchMultiRepo } from './watch';
export { patchGraph } from './graph';
export type { PlanChangeEvent, PlanChangeBatch, WatchHandle } from './types';
```
