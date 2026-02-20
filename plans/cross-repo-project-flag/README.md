---
title: Project-Wide Display Flag
status: draft
description: >-
  --project flag for status/ready/graph/lint/show to display plans across all
  repos grouped by repo
depends_on:
  - cross-repo-graph
tags:
  - cross-repo
  - display
  - plan-management
---

## Problem

After `cross-repo-graph`, trellis builds a unified DAG and checks cross-repo deps for blocking. But all display commands (status, ready, graph, lint) show only the current repo's plans. There's no way to see the full project picture — all repos' plans, their statuses, and cross-repo relationships — without switching between repos.

Agents working on a multi-repo project need a single view to understand what's ready, what's blocked, and where the bottlenecks are across the entire project.
## Approach

Add a `--project` flag to display commands that expands the view from current-repo to all-repos. The unified graph already exists (from `cross-repo-graph`); this plan adds display modes on top.

### Flag behavior

`--project` controls **display scope**, not resolution scope (resolution always includes cross-repo deps). Without the flag, commands show current-repo plans. With it, they show all plans from all repos in the manifest.

### Per-command changes

**`trellis status --project`** — shows all repos' plans grouped by repo, then by status. Each repo section headed by the repo alias. Counts per repo and totals.

**`trellis ready --project`** — lists ready plans across all repos, prefixed with repo alias. `--next` still picks from local plans only (you can't work on remote plans).

**`trellis graph --project`** — unified graph JSON with `repo` field on each node. Cross-repo edges annotated. Default (non-JSON) output shows a text summary with cross-repo edges called out.

**`trellis lint --project`** — runs lint across all repos' plans in the unified graph. Groups errors/warnings by repo. Useful for catching cross-repo issues that single-repo lint would miss (e.g., a remote plan depending on a deleted local plan).

**`trellis show <plan-id> --project`** — no change from base behavior (show already resolves qualified IDs). The flag is accepted but has no effect since show operates on a single plan.

### JSON output

All `--project --json` output includes a top-level `repos` field listing the repo aliases and their plan counts. Each plan in the output includes a `repo` field (null for local, alias string for remote).

### Display grouping

Text output groups by repo:

```
trellis (local)
  ● in_progress  plan-schema
  ○ not_started  cross-repo-graph

canopy
  ✓ done         ui-lib
  ○ not_started  auth-service
```
