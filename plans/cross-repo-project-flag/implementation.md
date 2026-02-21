# Implementation

## Steps

### 1. Add `repoAlias` to PlanSummary and toSummary

**Files:** `src/core/types.ts`

- Add `repoAlias?: string` to `PlanSummary` interface (after `assignee` field, line ~151)
- Update `toSummary(p: Plan)` (line ~166) to include `repoAlias: p.repoAlias`
- This flows through all commands automatically since they all use `toSummary()`

### 2. Add shared `--project` guard helper

**Files:** `src/core/utils.ts`

Add a helper used by all commands:

```typescript
export function resolveProjectPlans(
  ctx: TrellisContext,
  project?: boolean,
): { plans: Plan[]; isProject: boolean } {
  if (!project) return { plans: ctx.plans.filter(p => p.repoAlias == null), isProject: false };
  if (!ctx.manifest) {
    console.error('No manifest configured — showing local plans only');
    return { plans: ctx.plans.filter(p => p.repoAlias == null), isProject: false };
  }
  return { plans: ctx.plans, isProject: true };
}
```

This centralizes the no-manifest guard and local-filter logic so every command doesn't repeat it.

### 3. Add `--project` to Commander definitions

**Files:** `src/features/status/command.ts`, `src/features/ready/command.ts`, `src/features/graph/command.ts`, `src/features/lint/command.ts`, `src/features/epic/command.ts`, `src/features/chunks/command.ts`

Add `.option('--project', 'Show plans from all repos in the project')` to each command's chain. Add `project?: boolean` to each command's options interface.

Also add `--offline` to epic and chunks commands (currently missing):
- `epic/command.ts`: add `.option('--offline', 'Skip remote fetch, use cache or local only')`, pass to `createContext()`
- `chunks/command.ts`: same

### 4. Update `computeStatus` for project mode

**Files:** `src/features/status/logic.ts`, `src/features/status/command.ts`

**Logic (`logic.ts`):**
- Add `project?: boolean` to `ComputeStatusOptions.filters`
- When `project` is true, skip the local-only filter at line 31. Instead, keep all plans and pass through.
- Return type change: add `byRepo?: Map<string, StatusResult>` for grouped results? No — simpler: add `repoAlias` to `PlanSummary` (step 1 handles this), let the command layer group by `repoAlias`.

Concretely: replace line 31 (`const localPlansRaw = allPlansRaw.filter(p => p.repoAlias == null)`) with:
```typescript
const localPlansRaw = filters?.project
  ? allPlansRaw
  : allPlansRaw.filter(p => p.repoAlias == null);
```

**Command (`command.ts`):**
- Use `resolveProjectPlans(ctx, options.project)` to get the plan set
- For text output when `isProject`: group `allPlans` by `repoAlias ?? config.project`, print repo header before each group, show per-repo status sections
- For JSON output when `isProject`: add `repos` array to the output object

### 5. Update `computeReady` for project mode

**Files:** `src/features/ready/logic.ts`, `src/features/ready/command.ts`

**Logic (`logic.ts`):**
- Add `project?: boolean` to `ComputeReadyOptions.filters`
- Line 21: when `project`, include remote ready plans too:
  ```typescript
  let readyPlans = plans.filter(p => graph.ready.has(p.id) && (filters?.project || p.repoAlias == null));
  ```
- `pickNext()` stays local-only: pass only local IDs to `pickNext()` regardless of `--project`

**Command (`command.ts`):**
- For text output when `isProject`: prefix each plan line with `[alias]` or `(local)`
- For JSON output when `isProject`: plans already have `repoAlias` from `toSummary()`; add `repos` array

### 6. Update graph command for project mode

**Files:** `src/features/graph/command.ts`

- Line 19: when `--project`, don't filter to local plans:
  ```typescript
  const displayPlans = options.project ? ctx.plans : ctx.plans.filter(p => p.repoAlias == null);
  ```
- JSON output: `repoAlias` already flows through `computeGraph` node objects (verify — may need to add it to the GraphNode type and `computeGraph` mapping)
- Text output: annotate cross-repo edges in blocked list (e.g., `auth-service (by: trellis:plan-schema)` — already works since IDs are qualified)

### 7. Update lint display for project mode

**Files:** `src/features/lint/command.ts`

`computeLint()` already operates on all plans (local + remote) — no logic change needed.

**Display change only:**
- When `--project`: group errors and warnings by repo alias before printing. Add repo header between groups.
- When not `--project`: display unchanged (current behavior)

Note: `computeLint` doesn't filter to local plans, so `--project` is purely a display concern here. The lint results are the same either way. Consider whether non-project lint should suppress remote-plan issues in the display (currently it shows them all).

### 8. Update epic command for project mode

**Files:** `src/features/epic/logic.ts`, `src/features/epic/command.ts`

**Logic (`logic.ts`):**
- `computeEpic` currently operates on whatever plans are passed. No filter needed — just pass all plans when `--project`, local-only when not.
- No logic change needed in `computeEpic` itself.

**Command (`command.ts`):**
- Add `--project` and `--offline` options
- Use `resolveProjectPlans(ctx, options.project)` for the plan set
- Pass `{ offline: options.offline }` to `createContext()`
- Text display for individual epic: include `[repoAlias]` after plan ID when plan is from a remote repo
- JSON output: plans already carry `repoAlias` from `toSummary()`

### 9. Update chunks command for project mode

**Files:** `src/features/chunks/command.ts`

**Key constraint:** chunks should be computed per-repo independently (mixing local and remote plans into one chunk set doesn't make sense — you can't review them together).

**Approach:**
- Add `--project` and `--offline` options
- When `--project`:
  1. Compute local chunks as today (filter to local plans)
  2. For each remote repo (group plans by `repoAlias`), compute chunks independently
  3. Display grouped by repo with repo headers
- When not `--project`: unchanged behavior
- JSON output: wrap in `{ repos: [{ alias, local, chunks: ChunkResult }] }` when `--project`

Note: `computeChunks` > `groupByDirectory` uses `plan.id.indexOf('/')` for grouping. Remote plan IDs are qualified (`canopy:ui-lib`) — the colon won't be mistaken for a slash, so each remote plan gets its own `__root__` group. This works correctly but means remote repos' chunks won't benefit from directory-based merging. For now this is acceptable — remote plan sets are typically smaller.

### 10. Verify `GraphNode` carries `repoAlias`

**Files:** `src/features/graph/logic.ts`

Check that `computeGraph` maps `plan.repoAlias` onto the output node. If not, add `repoAlias?: string` to the `GraphNode` interface and populate it.
## Testing

### Unit tests

**New file: `src/__tests__/project-flag.test.ts`**

Test the compute-layer changes in isolation using `makePlan()` helpers (same pattern as `cross-repo.test.ts`):

- **computeStatus with project=true**: returns plans from all repos, grouped correctly
- **computeStatus with project=false**: returns only local plans (regression)
- **computeReady with project=true**: includes remote ready plans
- **computeReady with project=true + --next**: `next` is still local-only
- **computeReady with project=false**: only local ready plans (regression)
- **PlanSummary.repoAlias**: `toSummary()` populates `repoAlias` from `Plan.repoAlias`
- **resolveProjectPlans with no manifest**: returns local plans, `isProject: false`
- **resolveProjectPlans with manifest**: returns all plans, `isProject: true`
- **computeEpic with mixed plans**: epic aggregates plans from multiple repos
- **computeChunks per-repo**: remote plans don't mix into local chunks

### Command-layer tests

**Extend existing test files** (`status/command.test.ts`, etc.) or add to `project-flag.test.ts`:

- **status --project --json**: output includes `repos` array, plans have `repoAlias` field
- **ready --project --json**: plans include `repoAlias`, `repos` array present
- **graph --project --json**: nodes include `repoAlias`
- **lint --project**: text output groups by repo
- **epic --project**: epic spans repos, plans show repo prefix
- **chunks --project**: chunks grouped by repo in output
- **No manifest + --project**: stderr warning, local-only output
- **Without --project**: all commands identical to current behavior (regression suite)

### Edge case tests

- **--project --offline with empty cache**: degrades to local-only silently
- **--project with only local plans (no remotes in manifest)**: works, shows single repo
- **JSON backwards compatibility**: without `--project`, JSON output has no `repos` field, `repoAlias` is null on local plans
## Done-when

- `PlanSummary` has `repoAlias?: string` field, populated by `toSummary()`
- `resolveProjectPlans()` utility centralizes the no-manifest guard and local filter
- `--project` flag accepted on `status`, `ready`, `graph`, `lint`, `epic`, `chunks`
- `--offline` flag added to `epic` and `chunks` commands
- Status groups plans by repo with per-repo counts when `--project`
- Ready lists cross-repo ready plans; `--next` stays local-only
- Graph includes remote nodes when `--project`; text output annotates cross-repo edges
- Lint groups errors/warnings by repo in text display when `--project`
- Epic shows cross-repo epics with repo-prefixed plan lines when `--project`
- Chunks computes per-repo independently when `--project`; display groups by repo
- All `--json` outputs include `repoAlias` on plan objects
- `--project --json` adds top-level `repos` array
- Without `--project`, all commands behave identically to pre-change (no regression)
- No manifest configured + `--project` warns to stderr and shows local-only
- All existing tests still pass
