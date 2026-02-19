---
title: Cross-Repo Coordination
status: archived
depends_on:
  - active/chunk-reduction
tags: [workspace, multi-repo, coordination]
description: Enable trellis to track plan dependencies and contracts across multiple repositories
---

# Cross-Repo Coordination

Enable trellis to manage plan dependencies, contract validation, and status aggregation across multiple repositories within a workspace.

## Problem

Trellis today is single-project. It scans one `plans_dir` in one repo and builds a DAG from `depends_on` references within that scope. This works when all plans live in one repo, but breaks down when projects grow into multi-repo architectures.

Real coordination problems that emerge:

1. **Split dependency graphs** — An SDK plan exports types. An app plan in a different repo consumes them. Trellis can't see the edge.
2. **Orphaned contract references** — A plan's `inputs.md` says "From plans: core-types" but `core-types` lives in a different repo. Lint can't validate it.
3. **Invisible blockers** — A plan in `acorn-cloud` is blocked by a plan in `acorn` (SDK). `trellis ready` in the cloud repo says the plan is ready because it can't see the upstream blocker.
4. **Fragmented status** — "How far along is the platform?" requires manually checking `trellis status` in 5 repos and mentally composing the answer.
5. **Contract drift** — A contract spec in the meta repo defines the sync protocol. Implementation plans in SDK and cloud both reference it. When the contract changes, there's no mechanism to detect which downstream plans across which repos need updating.
6. **Stale cross-references** — Plans reference plan IDs, file paths, and type names that exist in other repos. When those targets move or rename, nothing catches the staleness.

### What we're NOT solving

- **Repo splitting/migration** — infrequent, human-guided, doesn't need tooling
- **Cross-repo code changes** — that's git + CI, not trellis
- **Cross-repo CI triggers** — out of scope (CI systems handle this)

## Approach

Introduce a **workspace** concept. A workspace is a directory containing multiple trellis projects. Trellis remains file-first and project-local by default — all existing behavior is unchanged. But when a workspace config exists, trellis can resolve cross-project dependencies and aggregate across projects.

### Key principle: no central manifest

The workspace config only tells trellis *where* projects live. Each project still owns its own plans, its own `.trellis` config, its own contracts. The workspace file is a pointer, not a source of truth.

## Components

### 1. Workspace Discovery

A `.trellis-workspace` file at the workspace root:

```
# ~/repos/acorn/.trellis-workspace
projects:
  sdk: sdk
  app: app
  cloud: cloud
  agent: agent
  meta: meta
```

Each key is a **project alias** (used in qualified plan IDs). Each value is a relative path to a directory containing a `.trellis` config.

Discovery: trellis walks up from `cwd` looking for `.trellis-workspace`, similar to how git finds `.git`. If found, trellis knows it's in a workspace and which project it's currently in (by matching `cwd` against project paths).

### 2. Qualified Plan References

Plans reference cross-project dependencies with qualified IDs:

```yaml
depends_on:
  - active/migration-infrastructure      # same project (unchanged)
  - sdk:active/core-extraction            # plan in sdk project
  - meta:contracts/sync-protocol          # plan in meta project
```

Format: `project-alias:plan-id`. Unqualified IDs resolve within the current project (backward compatible).

In `inputs.md`, the same convention:

```markdown
## From plans

### sdk:active/core-extraction
- `Person`, `Claim`, `Source` entity types from `@acorn/core`
- `AcornStore` interface

### meta:contracts/sync-protocol
- Push/pull wire format (JSON over HTTPS)
- Changeset serialization format
```

### 3. Multi-Project Scanner

When running in workspace mode, `scanPlans` expands to scan all projects:

```
scanWorkspace(workspaceConfig) → Map<projectAlias, Plan[]>
```

The unified graph merges all plans with qualified IDs. A plan `core-extraction` in project `sdk` becomes `sdk:active/core-extraction` in the workspace graph. Within its own project, the unqualified `active/core-extraction` still works.

### 4. Cross-Project Contract Validation

Extend existing lint checks to work across project boundaries:

- **Error:** `depends_on` references `sdk:active/foo` but no plan with ID `active/foo` exists in the `sdk` project
- **Error:** `inputs.md` references `sdk:active/core-extraction` but that plan has no `outputs.md`
- **Warning:** `inputs.md` references a contract heading from `sdk:active/core-extraction/outputs.md` that doesn't exist (heading-level validation)
- **Warning:** plan has cross-project dependents but no `outputs.md`

### 5. Workspace Commands

Existing commands gain workspace awareness:

**`trellis status`** (in workspace mode)
- Groups by project, then by status
- Shows cross-project dependency edges
- Flags plans that are blocked by plans in other projects

**`trellis ready`** (in workspace mode)
- Checks dependencies across all projects
- A plan is only ready if ALL dependencies (local and cross-project) are satisfied
- `--project sdk` filters to plans in one project but still checks cross-project deps

**`trellis graph`** (in workspace mode)
- Full workspace DAG with project-colored clusters
- Cross-project edges highlighted (different line style or color)
- Click a project cluster to expand/collapse

**`trellis lint`** (in workspace mode)
- Validates all cross-project references resolve
- Checks contract alignment across project boundaries
- Reports per-project and workspace-level issues

**`trellis show <qualified-id>`**
- Works with qualified IDs: `trellis show sdk:active/core-extraction`
- Shows cross-project dependents and dependencies

### 6. Project-Scoped Defaults

When running inside a project directory (not at workspace root), trellis defaults to project-local behavior but is workspace-aware:

- `trellis status` shows current project's plans
- `trellis status --workspace` shows all projects
- `trellis ready` checks cross-project deps even in project mode (a plan blocked by an upstream in another project should NOT show as ready)
- `trellis lint` validates cross-project references even in project mode

The key UX decision: **cross-project blocking is always checked**, even without `--workspace`. You don't want `trellis ready` to lie about readiness because it can't see an upstream blocker.

## Phasing

### Phase 1: Workspace Config + Qualified References
- Parse `.trellis-workspace`
- Support `project:plan-id` syntax in `depends_on`
- Walk up to find workspace root
- Basic multi-project scanning

### Phase 2: Cross-Project Dependency Resolution
- `trellis ready` checks cross-project dependencies
- `trellis show` resolves qualified IDs
- `trellis status --workspace` aggregation

### Phase 3: Cross-Project Contract Validation
- Lint checks for cross-project contract references
- `inputs.md` validation against remote `outputs.md`
- Heading-level contract matching

### Phase 4: Workspace Graph Visualization
- Project clusters in DAG view
- Cross-project edge styling
- Expand/collapse project clusters

## Design Decisions

**Why workspace file, not per-project remotes?**
Per-project remotes (each `.trellis` listing siblings) means every project needs to know about every other project. N projects = N files to update when adding a project. A single workspace file is O(1) for additions and makes the topology explicit in one place.

**Why qualified IDs, not global uniqueness?**
Requiring globally unique plan IDs across all repos is fragile — two repos might independently create `active/setup`. Qualified IDs (`sdk:active/setup` vs `cloud:active/setup`) are unambiguous and self-documenting.

**Why always check cross-project blocking?**
The alternative is `trellis ready` in project mode ignoring cross-project deps. This is dangerous — an agent working in `acorn-cloud` would pick up a plan that's actually blocked by unfinished SDK work. Silent lies about readiness are worse than the cost of scanning siblings.
