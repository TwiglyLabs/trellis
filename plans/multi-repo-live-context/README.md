---
title: Multi-Repo Live Context for Canopy
status: done
description: >-
  Build unified graphs across local repos by scanning plan directories directly
  — the API Canopy needs for the big-picture view
tags:
  - foundation
  - canopy
not_started_at: '2026-02-21T01:48:51.983Z'
completed_at: '2026-02-21T02:32:48.919Z'
---

## Problem
Trellis already supports cross-repo plan graphs through its manifest system: a `.trellis/manifest` file lists remote repos, and trellis fetches each repo's plans from git (using `git archive` or similar) to build a unified dependency graph. This works well for CI pipelines and shared review dashboards where data is read-only and a few seconds of latency is acceptable.

Canopy is a different context. It is an Electron desktop application that shows live work status across all repos a developer has checked out locally. Every repo Canopy tracks is already on disk. Canopy's trellis service uses chokidar to watch plan directories and broadcasts updates over IPC channels (`trellis:plan-status`, `trellis:plan-ready`, `trellis:plan-graph`, `trellis:plan-details`) within milliseconds of a file change.

The git-fetch cross-repo approach does not fit this model for several reasons:

**Latency and freshness mismatch.** Fetching from a git remote requires a network round-trip and reads only committed data. A developer actively working — creating plans, updating statuses, editing sections — won't see their own changes reflected until they commit and push. A live dashboard that lags behind local state by commits (potentially hours) loses its core value.

**No real-time update path.** The manifest system is point-in-time: call it, get a snapshot. There is no mechanism for it to emit change events. Canopy's architecture is event-driven; the main process watches the filesystem and pushes updates to the renderer. A polling-based or fetch-based cross-repo API cannot participate in that event loop without bolted-on workarounds.

**Unnecessary overhead for local repos.** Network I/O, git subprocess spawning, and cache invalidation logic all add complexity and failure modes that simply do not exist when the repos are already on the local filesystem. Using git fetch to read a file that is sitting three directories away is pure waste.

**No unified API call for all work.** Right now there is no single function that accepts a list of local repo paths and returns a merged, qualified plan graph across all of them. Canopy's renderer cannot ask "show me everything in progress across all repos" without either duplicating scan logic or shelling out per-repo. This is the missing primitive.

The result is a UX gap: Canopy can show deep real-time detail for the repo it is currently focused on, but cannot show a true cross-repo picture without stale, network-dependent, or hand-rolled solutions.
## Approach
Add a `createMultiContext()` function to the trellis library API that scans multiple local repo directories in parallel, qualifies plan IDs with a per-repo alias, merges the results into a single plan array, and runs the existing `buildGraph()` over it to produce a unified cross-repo graph.

### Function signature

```ts
interface RepoSpec {
  path: string;   // absolute path to repo root
  alias: string;  // short name used to prefix plan IDs, e.g. "canopy" or "trellis"
}

interface MultiContext extends TrellisContext {
  repos: {
    alias: string;
    path: string;
    planCount: number;
    configFound: boolean;
  }[];
}

async function createMultiContext(repos: RepoSpec[]): Promise<MultiContext>
```

### How it differs from the manifest system

The existing manifest system (`src/core/manifest.ts`) works by fetching plan data from git remotes via `fetchRepoPlans()` and caching it locally. It is designed for CI and review contexts where repos are not checked out locally and commits are the unit of truth.

`createMultiContext()` is purely filesystem-based: it calls the existing `scanPlans()` against each repo's `plans_dir` (read from that repo's `.trellis/config`) and reads files directly. No network, no git subprocess, no cache invalidation. This means it sees uncommitted changes — the live working-directory state — which is exactly what a desktop dashboard needs.

### Consumption surface

`createMultiContext()` is a library export only. Canopy imports it directly from the trellis package. No CLI command, no MCP tool in this plan — those can be added as follow-ups if needed.

### Plan ID qualification

Each repo's plans are prefixed with its alias before merging: a plan with ID `auth-redesign` in the repo aliased `canopy` becomes `canopy:auth-redesign`. This matches the convention already used by the manifest system's `mergeWithRemote()` for qualified IDs. `depends_on` entries that are already qualified (contain `:`) are left as-is; bare IDs are treated as local to that repo and rewritten to `alias:bare-id` during the merge step.

### Reusing buildGraph()

After all repos are scanned and IDs are qualified, the full plan list is passed to the existing `buildGraph()` unchanged. Cross-repo dependency edges resolve naturally because both sides are now qualified IDs in the same flat namespace. The graph, critical path, and ready-set computations all work without modification.

### How Canopy uses this

On startup, Canopy's trellis service calls `createMultiContext()` with all registered repos (pulled from its own config store). The returned `MultiContext` is cached in the main process and broadcast to the renderer via the existing `trellis:plan-graph` IPC channel.

When a watch event fires for any file under any watched repo's plan directory, Canopy calls `createMultiContext()` again (debounced) and re-broadcasts. Because the function is a pure filesystem scan with no network dependency, re-running it on every change is fast enough to keep the dashboard live. (Once `watch-events` and `incremental-graph` ship, the full re-scan can be replaced with incremental patching.)

### Coexistence with the manifest system

`createMultiContext()` and the manifest system solve different problems and coexist. Canopy uses `createMultiContext()` for local repos on disk. A CI job or remote review dashboard can continue using the manifest system to fetch the same repos over git. The two systems operate on separate code paths and produce the same qualified-ID convention, so their outputs are interchangeable at the graph level.

### Return shape

`MultiContext` extends `TrellisContext` (which already carries `plans`, `graph`, `config`, `plansDir`) with a `repos` array that records per-repo metadata: alias, absolute path, plan count after scanning, and whether a valid `.trellis/config` was found. This lets the renderer show per-repo breakdowns (e.g. "canopy: 4 plans, trellis: 11 plans") alongside the unified graph.

### Edge cases

**Repo missing `.trellis` config.** If a repo spec has no readable `.trellis/config`, `createMultiContext()` skips it gracefully, records `configFound: false` in the `repos` entry with `planCount: 0`, and continues. It does not throw.

**Plan ID collisions across repos.** Two repos with the same alias would produce colliding qualified IDs. The function validates that all aliases are unique before scanning and throws a descriptive error if duplicates are found. Two repos with different aliases but identically named plans are not a collision — their qualified IDs differ.

**Circular cross-repo dependencies.** `buildGraph()` already handles cycles by detecting them during topological sort and marking the involved plans. No new cycle-detection logic is needed.

**Empty repos.** Repos that exist on disk but have no plans produce an empty plan array for that repo. They appear in the `repos` metadata with `planCount: 0` and do not affect the graph.
