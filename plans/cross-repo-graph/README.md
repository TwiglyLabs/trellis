---
title: Unified Cross-Repo DAG
status: draft
depends_on:
  - cross-repo-manifest
tags: [cross-repo, graph, plan-management]
description: Qualified plan IDs, unified graph construction, and cross-repo-aware commands
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

Format: `<repo-alias>:<plan-id>`. Unqualified IDs resolve within the current repo. This is backward compatible — existing plans with only local deps work unchanged.

The repo alias comes from the project manifest. `trellis:plan-schema` means "the plan with ID `plan-schema` in the repo aliased as `trellis` in `.trellis-project`."

### Qualified ID parsing

`parseQualifiedId(ref: string): { repo?: string; planId: string }` — splits on the first `:`. If no colon, the whole string is the plan ID (local). If a colon is present, everything before it is the repo alias, everything after is the plan ID.

Edge case: plan IDs never contain colons (enforced by lint).

### Unified graph construction

When trellis has project context (the `project` pointer is set and plans have been fetched), `buildGraph` operates on the combined plan set:

- Local plans come from the filesystem (current repo, as today)
- Remote plans come from the git reader (sibling repos)
- Each plan carries a `repo` field (its alias, or null for local)
- Edges from qualified `depends_on` refs resolve against the full plan set
- Unresolved qualified refs (repo exists but plan doesn't) are lint errors

The graph algorithms (topological sort, cycle detection, critical path, `pickNext`, `newlyReady`) work on the unified graph unchanged — they operate on plan IDs and edges, which are now qualified where cross-repo.

### Command updates

Existing commands gain project awareness:

**`trellis status --project`** — shows all repos' plans grouped by repo, then by status. Cross-repo blockers are visible. Without `--project`, shows current repo only (but cross-repo deps are still checked for blocking).

**`trellis ready --project`** — lists ready plans across all repos. Without `--project`, lists current repo's ready plans but correctly marks plans as blocked if they have unsatisfied cross-repo deps.

**`trellis graph --project`** — unified DAG with repo clusters. Cross-repo edges visually distinct. Without `--project`, current repo's graph but with cross-repo edges shown as external references.

**`trellis lint --project`** — validates cross-repo references resolve. Checks that qualified IDs point to real plans. Warns when a plan depends on a cross-repo plan that has no `outputs.md`.

**`trellis show <repo:plan-id>`** — works with qualified IDs. Shows the plan with its cross-repo context (what it blocks/is blocked by across repos).

### Key UX decision: cross-repo blocking is always checked

Even without `--project`, `trellis ready` in a single repo checks cross-repo deps. A plan blocked by upstream work in another repo does NOT show as ready. You don't want `trellis ready` to lie about readiness because it can't see a blocker. The `--project` flag controls *display scope*, not *resolution scope*.

This means the first cross-repo query in a session triggers a fetch (or uses cache). The `--offline` flag (from cross-repo-manifest) skips this for speed when you know you're working locally.
