---
title: Unified Cross-Repo DAG
status: done
depends_on:
  - cross-repo-manifest
  - kill-trellis-class
  - trellis-directory-migration
  - extract-viewer
tags:
  - cross-repo
  - graph
  - plan-management
description: 'Qualified plan IDs, unified graph construction, and cross-repo-aware commands'
not_started_at: '2026-02-20T00:16:06.094Z'
started_at: '2026-02-20T23:24:41.769Z'
completed_at: '2026-02-20T23:49:40.848Z'
---

# Unified Cross-Repo DAG

Build a single dependency graph across all repos in a project so `trellis ready`, `trellis status`, and `trellis graph` answer questions about the whole project, not just one repo.

## Problem

With the manifest and git reader (cross-repo-manifest), trellis can discover and read plans from sibling repos. But it can't do anything useful with them yet. There's no way to express "this canopy plan depends on trellis:plan-schema" in frontmatter, no way to build a graph that spans repos, and no commands that show the unified picture.

Without this, a plan in canopy that depends on trellis work shows as ready (because canopy can't see the trellis blocker). An agent picks it up and either builds on assumptions that haven't landed, or you manually track cross-repo dependencies in your head.

## Approach

### Qualified plan IDs

Plans reference cross-repo dependencies with qualified IDs in `depends_on`:

```yaml
depends_on:
  - implementation/electron-scaffold      # local (same repo)
  - trellis:plan-schema                   # cross-repo (qualified)
```

Format: `<repo-alias>:<plan-id>`. Colon separator — not slash, because plan IDs already contain slashes (subdirectories). Unqualified IDs resolve within the current repo. Backward compatible — existing plans with only local deps work unchanged.

The repo alias comes from the project manifest. `trellis:plan-schema` means "the plan with ID `plan-schema` in the repo aliased as `trellis` in `.trellis-project`."

Remote plans fetched via `fetchRepoPlans()` already have their `Plan.repoAlias` field set to the manifest alias. This existing field is the canonical marker for remote vs local plans throughout the system.

### Qualified ID parsing

`parseQualifiedId(ref: string): { repo?: string; planId: string }` — splits on the first `:`. No colon = local plan ID. Colon present = everything before is repo alias, everything after is plan ID.

Plan IDs must not contain colons (enforced by lint and `create`). Since remote repos also run trellis, multiple-colon IDs are unlikely in practice. If encountered, the parser splits on the first colon: `canopy:sub/dir:plan` → repo=`canopy`, planId=`sub/dir:plan`. Acknowledged as a theoretical limitation.

### Plan ID namespace in the merged graph

Remote plans get qualified IDs as their `plan.id` in the merged graph: `canopy:ui-lib`. Local plans keep unqualified IDs: `auth`. This makes plan identity unambiguous in the unified `GraphData.plans` map without changing local plan behavior.

`depends_on` entries in frontmatter use the same format — qualified for cross-repo, unqualified for local. The graph resolves both against the unified plan map.

**Remote-to-remote dep resolution:** When merging remote plans, unqualified `depends_on` entries within a remote plan resolve within that remote's namespace. If canopy plan `ui-lib` has `depends_on: [core-utils]`, this resolves to `canopy:core-utils` in the unified graph — not to a local plan called `core-utils`. The merge step qualifies all intra-repo deps for remote plans before adding them to the unified map.

### Async context creation

`createContext()` becomes async to support git-based fetching:

```typescript
async function createContext(projectDir: string): Promise<TrellisContext> {
  const config = loadConfig(projectDir);         // sync
  const localPlans = scanPlans(plansDir);        // sync
  
  let allPlans = localPlans;
  if (config.manifest) {
    let manifest: ProjectManifest;
    const cachedManifest = readCache<ProjectManifest>(projectDir, 'manifest');
    if (cachedManifest && !isCacheStale(cachedManifest)) {
      manifest = cachedManifest.data;
    } else {
      manifest = await discoverManifest(...);
      writeCache(projectDir, 'manifest', manifest);
    }

    const remotePlans: Plan[] = [];
    for (const alias of Object.keys(manifest.repos)) {
      const cached = readCache<Plan[]>(projectDir, `plans/${alias}`);
      if (cached && !isCacheStale(cached)) {
        remotePlans.push(...cached.data);
      } else {
        const plans = await fetchRepoPlans(manifest, alias, ...);
        writeCache(projectDir, `plans/${alias}`, plans);
        remotePlans.push(...plans);
      }
    }
    allPlans = mergeWithRemote(localPlans, remotePlans);
  }
  
  const graph = buildGraph(allPlans);
  return { projectDir, config, plansDir, plans: allPlans, graph };
}
```

Local-only repos (no `manifest` in config) resolve immediately — no awaits hit. Cross-repo repos use `.trellis/cache/` with a 5-minute TTL. The actual git fetch only happens when cache is stale or on explicit `trellis fetch`.

`readCache()` returns `CacheEntry<T> | null` (a `{ data, fetchedAt }` wrapper). `isCacheStale()` checks `fetchedAt` against the default 5-minute TTL. Callers unwrap `.data` for the payload.

`refreshContext(ctx)` must also become async — same pattern, rebuilds context. Every call site changes: command handlers, MCP handlers, AND test files that call `createContext()` directly. The test migration is mechanical but touches many files.

### Cache strategy

Cache lives in `.trellis/cache/` (from trellis-directory-migration prerequisite):
- `manifest.json` — cached `ProjectManifest` from last fetch
- `plans/<alias>.json` — cached `Plan[]` per repo, keyed by manifest alias
- Each file is a `CacheEntry<T>` wrapper: `{ data: T, fetchedAt: string }`
- Default TTL: 5 minutes (300000ms), checked via `isCacheStale(entry)`
- `trellis fetch` forces a fresh fetch and updates all cache files
- `--offline` flag skips fetch entirely, uses cache or local-only

`--offline` edge cases:
- Cache empty + `--offline` → degrades to local-only silently (remote plans simply absent from graph)
- `trellis fetch --offline` → error: "--offline and fetch are contradictory"
- `--offline` is per-command (added to `ready`, `lint`, `show`, `status`, `graph`)

### Unified graph construction

When trellis has project context, `buildGraph` operates on the combined plan set:

- Local plans come from the filesystem (current repo, as today)
- Remote plans come from cache (originally fetched via git reader)
- Remote plan IDs are qualified: `canopy:ui-lib`, `grove:auth-service`
- `depends_on` edges resolve qualified refs against the full plan map
- Unresolved qualified refs (repo exists but plan doesn't) are lint errors

The graph algorithms (topological sort, cycle detection, critical path, `pickNext`, `newlyReady`) work on the unified graph unchanged — they operate on plan IDs and edges, which now include qualified IDs.

`newlyReady` is local-only in practice: you can only `update` local plans, so cross-repo unblocking is discovered passively on the next `ready` call when fresh data is fetched. This is acknowledged, not a bug.

Lint calls `checkVisibility(manifest, allPlans)` after graph construction to validate public/private dependency rules across repos.

### Write operations are local only

`trellis update`, `trellis set`, `trellis create`, and all write MCP tools operate on local plans only. The canonical check for remote plans is `plan.repoAlias != null`, not presence of `:` in the ID. The write guard checks `repoAlias` on the resolved plan object. Error message includes the qualified ID for clarity: "Cannot modify remote plan 'canopy:ui-lib'. Write operations are local only."

### Command updates

Existing commands gain cross-repo awareness in their default mode:

**`trellis ready`** — checks cross-repo deps via cache. A local plan with `depends_on: [trellis:plan-schema]` will not show as ready until `trellis:plan-schema` is done. Blocks on unsatisfied remote deps.

**`trellis lint`** — validates cross-repo references resolve, calls `checkVisibility()` to enforce public/private dependency rules, warns when a cross-repo dep has no `outputs.md`.

**`trellis show <repo:plan-id>`** — resolves qualified IDs, displays cross-repo context (remote dep status, blocking info).

**`trellis status`** — default output shows local plans only but cross-repo blockers appear in blocking info for local plans.

**`trellis fetch`** — NEW command. Forces cache refresh for all repos in the manifest, reports per-repo status (fetched N plans, cached at timestamp). Errors if `--offline` is passed.

The `--project` display flag (grouping by repo, project-wide views) is deferred to follow-up plan `cross-repo-project-flag`.

### Key UX decision: cross-repo blocking is always checked

`trellis ready` checks cross-repo deps via cache even in single-repo default mode. A plan blocked by upstream work in another repo does NOT show as ready. Display scope is current-repo by default, but resolution scope always includes cross-repo deps.

The first cross-repo query uses cache (or triggers a fetch if cache is empty/stale). `--offline` skips this entirely for speed when working locally.
