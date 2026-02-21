---
title: Watch Events with Typed Emissions
status: not_started
description: >-
  Upgrade existing fs.watch watcher with granular typed events, content hashing
  to suppress phantom rebuilds, and debounced batch emission
depends_on:
  - recency-metadata
tags:
  - canopy
  - performance
not_started_at: '2026-02-21T01:48:53.620Z'
---

## Problem
Trellis has a basic `watchPlans()` in `src/features/watch/logic.ts` that uses Node's `fs.watch()` with recursive mode, debounces raw filesystem events, and emits a generic `'change'` event containing the full rebuilt graph. Canopy also runs its own chokidar watchers on plan directories.

Both approaches share the same fundamental limitation: **no indication of what changed.** When a filesystem event fires, the only option is a full `scanPlans()` + `buildGraph()` cycle. There is no way to know whether a plan was added, removed, or which of its files (README.md, implementation.md, inputs.md, outputs.md) was modified.

This causes several problems:

**Phantom rebuilds.** Many editors write files without changing content (format-on-save, auto-import sorting, LSP side effects). Every write triggers a full rebuild even when the parsed result would be identical. Without per-file content hashing, there is no way to suppress these no-op events.

**No event typing.** Consumers cannot react differently to "plan added" vs. "plan file updated" vs. "plan removed." Everything is a generic change that triggers the same full-rebuild code path.

**Ownership mismatch.** Canopy duplicates the file-watching concern with its own chokidar instances, debounce timers, and glob filters. Trellis is the authoritative source of plan structure but provides only a minimal watching primitive, leaving consumers to re-implement the plumbing inconsistently.

**Redundant I/O at scale.** A typical project has 20–50 plans with 2–4 files each. A single keystroke in one plan's implementation.md causes all 80–200 files to be re-read and re-parsed. This cost grows linearly with plan count.
## Approach
Replace the existing `watchPlans()` in `src/features/watch/logic.ts` with a richer implementation that emits granular typed events, suppresses phantom rebuilds via content hashing, and batches rapid filesystem events into a single callback.

### Granular event types

Define a `PlanChangeEvent` discriminated union:

```ts
type PlanFileKind = 'readme' | 'implementation' | 'inputs' | 'outputs';

type PlanChangeEvent =
  | { type: 'plan-added';   planId: string; plan: Plan }
  | { type: 'plan-removed'; planId: string }
  | { type: 'plan-updated'; planId: string; file: PlanFileKind; plan: Plan };
```

The watcher maps raw filesystem paths to plan IDs and file kinds. It handles the full plan-directory lifecycle: new directories appearing, directories being removed, and individual files within existing plan directories being modified.

### Content hashing to suppress phantom rebuilds

Before re-parsing a file, compute SHA-256 of its raw content and compare against a per-file hash stored in a `Map<filePath, string>`. If the hash is unchanged, skip parsing and suppress the event entirely. This eliminates spurious rebuilds from editor autosave, LSP writes, and format-on-save passes. The hash map is initialized on watcher startup by hashing all existing plan files.

This reuses the same SHA-256 hashing approach from recency-metadata's `fileHashes` — the two features share the primitive but compute it at different times (scan-time vs. watch-time).

### Debounced batch emission

Raw filesystem events can arrive in rapid bursts (e.g., an editor writing multiple plan files in sequence). Buffer incoming events within a configurable window (default 100ms) and emit a single `PlanChangeBatch` to the callback rather than one call per file:

```ts
interface PlanChangeBatch {
  events: PlanChangeEvent[];
  timestamp: Date;
}
```

The batch preserves the full set of individual events so consumers can react per-plan if needed.

### Filesystem backend

Use Node's built-in `fs.watch()` with `{ recursive: true }` (already used by the existing watcher). This avoids adding chokidar as a runtime dependency, keeping the "zero runtime deps beyond Node" principle intact. `fs.watch` recursive mode is supported on macOS (FSEvents) and Windows; on Linux it requires Node 19+, which is within the `engines: >= 20` requirement.

### Multi-repo support

```ts
function watchMultiRepo(
  repos: Array<{ alias: string; plansDir: string }>,
  callback: (batch: PlanChangeBatch) => void
): WatchHandle
```

`watchMultiRepo` creates one watcher per repo and qualifies every event's `planId` with the repo alias before forwarding to the shared callback. This lets Canopy maintain per-repo state and patch only the affected repo's graph on each event.

### Library exports

Export from the public entry point:

```ts
export { watchPlans, watchMultiRepo, unwatchPlans } from './features/watch/logic';
export type { PlanChangeEvent, PlanChangeBatch, WatchHandle, PlanFileKind } from './features/watch/types';
```

### Canopy migration path

Canopy replaces its custom chokidar dependency and debounce logic with a single `watchPlans()` (or `watchMultiRepo()`) call from the trellis library. On each batch callback, Canopy broadcasts the events over IPC. The existing full-scan path remains available for cold starts and forced refreshes.
