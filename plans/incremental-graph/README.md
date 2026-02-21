---
title: Incremental Graph Patching
status: not_started
description: >-
  patchGraph() for partial graph rebuild from typed change events, avoiding full
  scanPlans + buildGraph on every file change
depends_on:
  - watch-events
tags:
  - canopy
  - performance
not_started_at: '2026-02-21T01:48:50.940Z'
---

## Problem
Even with typed watch events (from `watch-events`), the graph rebuild strategy remains all-or-nothing. When a single plan changes, `buildGraph()` recomputes the entire dependency graph from scratch: all nodes, all edges, all topological sorting, all ready/blocked status, all critical path computation.

For a single-repo setup with 30 plans this is fast enough to be imperceptible. But the cost compounds in two ways:

**Cross-repo amplification.** Canopy watches multiple repos simultaneously and maintains a merged cross-repo graph. A change in one repo's plan currently forces a full re-graph of all repos combined — re-sorting and re-computing ready/blocked status for plans that didn't change.

**Wasted computation.** When one plan's implementation.md is edited, the only nodes whose status could possibly change are: (1) the plan itself, and (2) its immediate dependents (whose blocked/ready status might shift). Every other node in the graph is guaranteed unchanged. A full `buildGraph()` recomputes all of them anyway.

The missing primitive is `patchGraph()`: given a graph and a set of typed change events, produce an updated graph by mutating only the affected subgraph.
## Approach
Add a `patchGraph()` pure function that takes an existing `GraphData` and a batch of `PlanChangeEvent` items (from the `watch-events` plan) and returns an updated `GraphData` with only the affected subgraph recomputed.

### Function signature

```ts
function patchGraph(graph: GraphData, plans: Plan[], events: PlanChangeEvent[]): GraphData
```

Returns a new `GraphData` object (immutable update pattern) so consumers can use referential equality to detect changes. The `plans` array is the current full plan list, already updated to reflect the events (plan added/removed/modified).

### Patch operations

**`plan-updated`**: Replace the plan's node data in the graph. Recompute `ready` / `blocked` status for the plan and its immediate dependents (one hop). Other nodes are untouched. If the plan's `depends_on` changed, remove old edges and insert new ones, then recompute status for affected neighbors.

**`plan-added`**: Insert the new node. Add edges for its `depends_on` entries. Walk existing nodes to resolve any dependency references that were previously dangling because this plan did not exist — those dependents may now become unblocked. Recompute ready/blocked for the new node and its immediate dependents.

**`plan-removed`**: Remove the node and all its edges (both incoming and outgoing). Mark all direct dependents as blocked (they lost a dependency). Clear any `depends_on` reference in other plans that pointed to the removed plan.

### What is NOT recomputed

Critical path and topological ordering are relatively expensive and affect the full graph. `patchGraph()` does NOT recompute these — they remain stale until the next full `buildGraph()` call. This is acceptable because:

- Critical path is a display concern (shown in `trellis show`), not a blocking/ready concern.
- Topological order only matters for `pickNext()` tiebreaking, which is advisory.

Consumers that need fresh critical path data can call `buildGraph()` on demand (e.g., when a user opens a plan detail view). The incremental path handles the common case: keeping the ready/blocked dashboard view current.

### Testing strategy

All computation is pure. Tests construct a `GraphData` and `Plan[]`, apply synthetic events via `patchGraph()`, and assert on the returned graph. Cover:

- Single plan updated, no dependency change — node data refreshed, neighbors unchanged.
- Plan updated with new `depends_on` — old edges removed, new edges added, affected neighbors recomputed.
- Plan added that unblocks a previously-blocked plan.
- Plan removed that blocks its dependents.
- Multiple events in one batch (add + update + remove).
- No-op batch (empty events array) returns the same graph reference.

### Library export

```ts
export { patchGraph } from './core/graph';
```

### Canopy integration

On each `PlanChangeBatch` from `watchPlans()`:

1. Update the local plan list (add/remove/replace affected plans).
2. Call `patchGraph(currentGraph, updatedPlans, batch.events)` to get the new graph.
3. Broadcast the patched graph over IPC.

The full-scan path (`scanPlans()` + `buildGraph()`) remains the fallback for cold starts, forced refreshes, and periodic consistency checks.
