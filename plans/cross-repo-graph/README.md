---
title: Unified Cross-Repo DAG
status: not_started
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

### Qualified ID parsing

`parseQualifiedId(ref: string): { repo?: string; planId: string }` — splits on the first `:`. No colon = local plan ID. Colon present = everything before is repo alias, everything after is plan ID.

Plan IDs must not contain colons (enforced by lint and `create`).

**Important:** `checkVisibility()` in `manifest.ts` currently uses slash-based parsing for cross-repo deps. This must be updated to use colon separator to match the qualified ID format.

### Plan ID namespace in the merged graph

Remote plans get qualified IDs as their `plan.id` in the merged graph: `canopy:ui-lib`. Local plans keep unqualified IDs: `auth`. This makes plan identity unambiguous in the unified `GraphData.plans` map without changing local plan behavior.

`depends_on` entries in frontmatter use the same format — qualified for cross-repo, unqualified for local. The graph resolves both against the unified plan map.

### Async context creation

`createContext()` becomes async to support git-based fetching:

```typescript
async function createContext(projectDir: string): Promise<TrellisContext> {
  const config = loadConfig(projectDir);         // sync
  const localPlans = scanPlans(plansDir);        // sync
  
  let allPlans = localPlans;
  if (config.manifest) {
    const cached = readCache(projectDir, 'plans');
    if (cached && !isCacheStale(cached)) {
      allPlans = mergeWithRemote(localPlans, cached);
    } else {
      const manifest = await discoverManifest(...);
      const remote = await fetchProjectPlans(manifest, ...);
      writeCache(projectDir, 'plans', remote);
      allPlans = mergeWithRemote(localPlans, remote);
    }
  }
  
  const graph = buildGraph(allPlans);
  return { projectDir, config, plansDir, plans: allPlans, graph };
}
```

Local-only repos (no `manifest` in config) resolve immediately — no awaits hit. Cross-repo repos use the `.trellis/cache/` directory (from trellis-directory-migration) with a 5-minute TTL. The actual git fetch only happens when cache is stale or on explicit `trellis fetch`.

Commander action handlers and MCP handlers are already async, so the change is one `await` per command.

### Cache strategy

Cache lives in `.trellis/cache/` (from trellis-directory-migration prerequisite):
- `manifest.json` — cached `ProjectManifest` from last fetch
- `plans/<alias>.json` — cached `Plan[]` per repo
- Default TTL: 5 minutes (300s)
- `trellis fetch` forces a fresh fetch and updates cache
- `--offline` flag skips fetch entirely, uses cache or local-only

### Unified graph construction

When trellis has project context, `buildGraph` operates on the combined plan set:

- Local plans come from the filesystem (current repo, as today)
- Remote plans come from cache (originally fetched via git reader)
- Remote plan IDs are qualified: `canopy:ui-lib`, `grove:auth-service`
- `depends_on` edges resolve qualified refs against the full plan map
- Unresolved qualified refs (repo exists but plan doesn't) are lint errors

The graph algorithms (topological sort, cycle detection, critical path, `pickNext`, `newlyReady`) work on the unified graph unchanged — they operate on plan IDs and edges, which now include qualified IDs.

`newlyReady` is local-only in practice: you can only `update` local plans, so cross-repo unblocking is discovered passively on the next `ready` call when fresh data is fetched. This is acknowledged, not a bug.

### Write operations are local only

`trellis update`, `trellis set`, `trellis create`, and all write MCP tools operate on local plans only. Passing a qualified ID (containing `:`) to a write operation is an error: "Cannot modify remote plan 'canopy:ui-lib'. Write operations are local only."

### Command updates

Existing commands gain project awareness:

**`trellis status --project`** — shows all repos' plans grouped by repo, then by status. Without `--project`, shows current repo only (but cross-repo deps are still checked for blocking).

**`trellis ready --project`** — lists ready plans across all repos. Without `--project`, lists current repo's ready plans but correctly marks plans as blocked if they have unsatisfied cross-repo deps.

**`trellis graph --project`** — unified graph JSON with repo metadata on each node. Cross-repo edges marked in output. Without `--project`, current repo's graph with cross-repo deps shown as external references.

**`trellis lint --project`** — validates cross-repo references resolve. Checks that qualified IDs point to real plans. Warns when a cross-repo dep plan has no `outputs.md`.

**`trellis show <repo:plan-id>`** — works with qualified IDs. Shows the plan with its cross-repo context.

### Key UX decision: cross-repo blocking is always checked

Even without `--project`, `trellis ready` checks cross-repo deps via cache. A plan blocked by upstream work in another repo does NOT show as ready. The `--project` flag controls *display scope*, not *resolution scope*.

This means the first cross-repo query uses cache (or triggers a fetch if cache is empty/stale). `--offline` skips this entirely for speed when working locally.
