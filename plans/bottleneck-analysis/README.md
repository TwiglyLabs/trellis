---
title: Bottleneck Analysis API
status: done
description: >-
  Blocking factor, staleness, queue pressure, and project health metrics beyond
  critical path
tags:
  - canopy
  - metrics
depends_on:
  - recency-metadata
not_started_at: '2026-02-21T01:48:50.503Z'
started_at: '2026-02-21T03:37:47.391Z'
completed_at: '2026-02-21T03:50:55.286Z'
---

## Problem
Trellis can tell you what's ready to work on, and what a single plan's critical path looks like. What it cannot tell you is where the project is actually stuck.

**Critical path is plan-scoped, not project-scoped.** `trellis show <id>` reports the critical path to that plan's completion, but there is no project-level view of which plans are load-bearing for the most downstream work. A plan that blocks 15 other plans looks identical in `trellis status` output to one that blocks none.

**No fan-out / blocking-factor metric.** The question "which single plan, if completed, would unblock the most work?" has no answer in the current tooling. This is the most direct definition of a bottleneck in a dependency graph, and it is entirely absent.

**No staleness detection.** A plan that entered `in_progress` three weeks ago and has not completed is probably stuck. Nothing in the current CLI surfaces this. `trellis status` shows the plan as in_progress without any indication that something may be wrong.

**No queue pressure analysis.** If eight plans are all blocked waiting on one `in_progress` plan, that is a pressure point. The current data model has everything needed to compute this — `dependents`, `started_at`, status — but nothing aggregates it into a signal.

**`trellis metrics` is retrospective.** It measures cycle time and queue time for plans that have already reached `done`. That is useful for process improvement after the fact, but it does not help a team understand current risk. Prospective metrics — computed from the live state of the graph — are missing entirely.

**Canopy has no health primitives.** The Canopy Electron dashboard needs to surface "big picture" project health: which plans are stuck, which are high-blocking, where queues are building up. Today it can only list what is ready, which is the same information `trellis ready` provides. There is no structured data it can render as dashboard widgets for bottleneck visibility.
## Approach
Introduce a `computeBottlenecks(graph, plans)` pure function that takes existing graph data and plan metadata and returns a structured `BottleneckResult`. No side effects, no filesystem reads — all inputs come from the already-loaded graph so the function is easily testable and Canopy-consumable.

**Blocking factor (fan-out analysis)**

For each plan that is `in_progress` or `not_started`, perform a transitive traversal of its `dependents` subgraph and count all reachable plans. This count is the plan's _blocking factor_. A plan with a high blocking factor is a bottleneck regardless of whether it is on any single plan's critical path. Surface the top-N by blocking factor as `highBlockingPlans` in the result.

**Staleness scoring**

Compute how long each plan has been in its current status using the `started_at` timestamp for `in_progress` plans and the `not_started_at` timestamp for `not_started` plans. Compare against configurable thresholds. Plans past threshold receive a staleness flag.

Thresholds are flat keys in `.trellis/config`, consistent with the existing config format:

```
stale_in_progress_days = 14
stale_not_started_days = 30
```

Default values (14 and 30) are used when keys are absent from config. Parsed as integers in `loadConfig()`, added to `TrellisConfig`.

**Stuck detection**

A plan is _stuck_ if it is `in_progress` and has been so for longer than the staleness threshold. When `updatedAt` is available on the plan (from the recency-metadata feature), combine it with the status timestamp: a plan is only truly stuck if both the `started_at` is old AND no plan files have been modified recently (i.e., `updatedAt` is also past the threshold). When `updatedAt` is not available (recency-metadata not yet shipped), fall back to `started_at` age alone. Stuck plans are surfaced as a distinct `stuckPlans` list separate from the broader staleness set.

**Queue pressure by DAG layer**

Assign plans to layers by their topological depth (layer 0 = no dependencies, layer N = deepest). For each layer, compute the ratio of `blocked` plans to `in_progress` plans. A layer with many blocked plans and few or no in_progress plans is a pressure point — work is queued up with nothing actively draining it. Represent this as a `layerPressure` array sorted by pressure ratio descending.

**Project health summary**

Return a top-level `healthSummary` object:

```ts
interface HealthSummary {
  totalPlans: number;       // all non-archived plans
  activePlans: number;      // in_progress count
  blockedPlans: number;     // plans with unmet dependencies
  stuckPlans: number;       // in_progress past staleness threshold
  highBlockingPlans: number; // plans with blocking factor above threshold
  estimatedParallelism: number; // count of ready plans right now
}
```

`estimatedParallelism` answers "how many people could usefully start work right now?" — it is simply the ready-plan count, but framing it as parallelism makes it actionable for planning conversations.

**CLI surface**

Add a `trellis bottlenecks` command that prints a human-readable summary: stuck plans with age, top blockers with fan-out count, layers under queue pressure. Add a `--json` flag that emits the full `BottleneckResult` for scripting and Canopy ingestion.

**Library API export**

Export `computeBottlenecks` and the `BottleneckResult` / `HealthSummary` types from the library entry point so Canopy can call them directly without shelling out. The function signature takes `GraphData` and a `Plan[]` array — both already available in Canopy's existing trellis integration — so no new IPC surface is needed.

**Testing strategy**

All computation is pure: construct synthetic `GraphData` and `Plan` arrays in tests, assert on the returned `BottleneckResult`. No filesystem, no process spawning. Cover: single bottleneck plan blocking a long chain, multiple chains of equal depth, a stuck plan just below and just above threshold, a layer with zero in_progress plans, and an empty graph.
