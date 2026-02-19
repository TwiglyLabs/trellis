---
title: Cross-Repo Project Manifest
status: in_progress
depends_on:
  - plan-schema
tags:
  - cross-repo
  - foundation
  - plan-management
description: >-
  Project manifest format, repo discovery, and git-based plan reader for
  cross-repo coordination
started_at: '2026-02-19T04:41:15.564Z'
---

# Cross-Repo Project Manifest

The data layer for cross-repo plan coordination. A project manifest declares which repos belong together, each repo points back to it, and trellis reads plan state from git objects — no filesystem coupling.

## Problem

Trellis is single-repo. Each repo has its own plans, its own DAG, its own `trellis ready`. When a project spans multiple repos (twiglylabs has trellis, canopy, grove, sap; acorn will have ~5 repos), there's no way to see how plans relate across repos, no way to know that a canopy plan is blocked by unfinished trellis work, and no unified view of project direction.

The naive solution — scanning sibling directories on the filesystem — doesn't work. Git has no concept of filesystem adjacency. Repos might be on different machines, in CI, or cloned to arbitrary locations. The coordination model needs to be git-native: remotes, refs, branches.

## Approach

### Project manifest

A `.trellis-project` file in a meta repo (e.g., `twiglylabs/`) declares the project's repos:

```yaml
name: twiglylabs
repos:
  trellis:
    url: git@github.com:twiglylabs/trellis.git
    branch: main
    visibility: public
  canopy:
    url: git@github.com:twiglylabs/canopy.git
    branch: main
    visibility: public
  acorn:
    url: git@github.com:twiglylabs/acorn.git
    branch: develop
    visibility: private
  grove:
    url: git@github.com:twiglylabs/grove.git
    branch: main
    visibility: public
  sap:
    url: git@github.com:twiglylabs/sap.git
    branch: main
    visibility: public
```

Each entry has a short alias (used in qualified plan IDs), a git URL, a `branch` (the branch trellis resolves plan state against), and a `visibility` (`public` or `private`).

For most repos `branch` is `main`. For gitops repos like acorn where staging is the active development target, it's `develop`.

The manifest is parsed with `js-yaml` (already a transitive dependency via gray-matter, promoted to a direct dependency for this use).

### Visibility and dependency direction

Repos are either `public` (open source, may have external contributors) or `private` (proprietary). Trellis enforces a one-directional dependency rule: **private repos can depend on public repos, never the reverse.**

This is enforced at the lint boundary:

- **`trellis lint`** — flags public-to-private dependencies as errors

Write-time enforcement (in `create`, `set`) is deferred — it requires fetching the manifest on every local write, making local operations network-dependent. Lint is the right place: it's opt-in, already aggregates all validation, and can fetch the manifest once per run.

The rule ensures public repos are self-contained for external contributors. Private repos get the full cross-repo graph. When private repo needs drive public repo work, the public plan is created as standalone work — it doesn't formally depend on the private repo. The private repo's plan depends on the public one.

### Graceful degradation

When a contributor clones a public repo, the `manifest` pointer in `.trellis` points to the (private) meta repo. If they can't fetch it (no access), trellis falls back to single-repo mode silently. All local commands work unchanged. They just don't see the cross-repo context — which is fine, because public repos have no dependencies on private repos.

### Manifest pointer

Each child repo's `.trellis` config gains a `manifest` field:

```
project = trellis
plans_dir = plans
manifest = git@github.com:twiglylabs/twiglylabs.git
```

The existing `project` field remains the display name. `manifest` is the git URL of the meta repo containing `.trellis-project`. This is the only coupling between a child repo and the project. From any repo, trellis follows this pointer to discover the manifest and all sibling repos.

The `manifest` field is optional — repos without it operate in single-repo mode (backward compatible, no behavior change).

### Git-based plan reader

Trellis reads plan state from git objects, not the filesystem:

1. Follow the `manifest` pointer to the meta repo git URL
2. Add the meta repo as a git remote named `trellis/__manifest` (if not already present) and `git fetch` it
3. Read `.trellis-project` from the meta repo's default branch via `git show trellis/__manifest/main:.trellis-project`
4. For each sibling repo listed in the manifest, add it as a git remote named `trellis/<alias>` and `git fetch` it
5. List plan directories via `git ls-tree -d trellis/<alias>/<branch>:plans/`
6. Read frontmatter via `git show trellis/<alias>/<branch>:plans/<plan-id>/README.md`
7. Parse frontmatter with existing `parseFrontmatter()` — reused as-is

This works regardless of where repos are cloned, what branch is checked out locally, or whether sibling repos are on disk at all. The only requirement is network access to the git remotes.

**Remote naming convention:** All trellis-managed remotes use the `trellis/` prefix to avoid collisions with user-managed remotes. The meta repo is always `trellis/__manifest`. Sibling repos are `trellis/<alias>` where alias comes from the manifest.

### Remote plan objects

Remote plans produce `Plan` objects with key differences from local plans:

- **`repoAlias`** — set to the manifest alias (e.g., `"canopy"`). Local plans have `repoAlias` undefined.
- **`id`** — the plan directory name, same as local (e.g., `"my-feature"`). Qualified IDs like `canopy/my-feature` are a cross-repo-graph concern, not this plan's.
- **`filePath`** — synthetic git object reference: `trellis/<alias>/<branch>:plans/<id>/README.md`. Not a filesystem path. Code that calls `existsSync(plan.filePath)` will correctly return false.
- **`lineCount`** — computed from README.md content only (no implementation.md read for remotes).
- **`inputs` / `outputs`** — not populated. Remote plans are frontmatter + body only. Full contract data from sub-files is a future concern.

The `Plan` interface gains an optional `repoAlias?: string` field. Existing code is unaffected — it's undefined for local plans.

### Fetching strategy

Every cross-repo operation fetches all remotes. There is no cache layer. For a project with 5 repos, this adds a few seconds of latency. This is acceptable:

- Cross-repo queries are less frequent than local ones
- `trellis fetch` provides an explicit way to fetch + report status without running another command
- The unified DAG is always a point-in-time snapshot — staleness is inherent

If per-invocation fetch proves too slow in practice, disk-based caching can be added later without changing the API surface.

### What this plan does NOT cover

- Qualified ID syntax in `depends_on` — that's cross-repo-graph
- Unified commands (`--project` flag) — that's cross-repo-graph
- Plan claiming / distributed locking — that's plan-claim-protocol
- Workspace setup / cloning repos — that's grove
- Write-time visibility enforcement (in `create`/`set`) — deferred, lint handles it
