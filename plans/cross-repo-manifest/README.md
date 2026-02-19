---
title: Cross-Repo Project Manifest
status: draft
depends_on:
  - plan-schema
tags: [cross-repo, foundation, plan-management]
description: Project manifest format, repo discovery, and git-based plan reader for cross-repo coordination
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

### Visibility and dependency direction

Repos are either `public` (open source, may have external contributors) or `private` (proprietary). Trellis enforces a one-directional dependency rule: **private repos can depend on public repos, never the reverse.**

This is enforced at every write boundary:

- **`trellis create`** / **`trellis_create`** — rejects `depends_on` referencing a private repo when the current repo is public
- **`trellis set`** — rejects adding a private qualified ID to `depends_on` in a public repo
- **`trellis lint`** — flags public-to-private dependencies as errors

The rule ensures public repos are self-contained for external contributors. Private repos get the full cross-repo graph. When private repo needs drive public repo work, the public plan is created as standalone work — it doesn't formally depend on the private repo. The private repo's plan depends on the public one.

### Graceful degradation

When a contributor clones a public repo, the `project` pointer in `.trellis` points to the (private) meta repo. If they can't fetch it (no access), trellis falls back to single-repo mode silently. All local commands work unchanged. They just don't see the cross-repo context — which is fine, because public repos have no dependencies on private repos.

### Repo pointer

Each child repo's `.trellis` config gains a `project` field:

```
plans_dir = plans
project = git@github.com:twiglylabs/twiglylabs.git
```

This is the only coupling between a child repo and the project. From any repo, trellis follows this pointer to discover the manifest and all sibling repos.

### Git-based plan reader

Trellis reads plan state from git objects, not the filesystem:

1. Follow the `project` pointer — fetch the meta repo (or use a cached fetch)
2. Read `.trellis-project` from the meta repo's main branch
3. For each sibling repo listed in the manifest, fetch its remote
4. Read plan files via `git show <remote>/<branch>:plans/<plan-id>/README.md`
5. Parse frontmatter from the git objects (reuses existing `parseFrontmatter`)

This works regardless of where repos are cloned, what branch is checked out locally, or whether sibling repos are on disk at all. The only requirement is network access to the git remotes.

### Caching

Fetching all remotes on every `trellis status` would be slow. The reader caches fetched data:

- `git fetch` is run on-demand (first cross-repo query in a session) or explicitly (`trellis fetch`)
- Cached refs persist across commands in the same session (the `Trellis` class holds the cache)
- A `--fetch` flag forces a fresh fetch; `--offline` uses only cached/local data
- Stale data is acceptable for read-only queries — the unified DAG is always a snapshot, not a live view

### What this plan does NOT cover

- Qualified ID syntax in `depends_on` — that's cross-repo-graph
- Unified commands (`--project` flag) — that's cross-repo-graph
- Plan claiming / distributed locking — that's plan-claim-protocol
- Workspace setup / cloning repos — that's grove
