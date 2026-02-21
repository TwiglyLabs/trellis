---
title: Project-Wide Display Flag
status: not_started
description: >-
  --project flag for status/ready/graph/lint/show to display plans across all
  repos grouped by repo
depends_on:
  - cross-repo-graph
tags:
  - cross-repo
  - display
  - plan-management
not_started_at: '2026-02-21T00:05:10.578Z'
---

## Problem

After `cross-repo-graph`, trellis builds a unified DAG and checks cross-repo deps for blocking. But all display commands (status, ready, graph, lint, epic, chunks) show only the current repo's plans. There's no way to see the full project picture — all repos' plans, their statuses, and cross-repo relationships — without switching between repos.

Agents working on a multi-repo project need a single view to understand what's ready, what's blocked, and where the bottlenecks are across the entire project.
## Approach

Add a `--project` flag to display commands that expands the view from current-repo to all-repos. The unified graph already exists (from `cross-repo-graph`); this plan adds display modes on top.

### Flag behavior

`--project` controls **display scope**, not resolution scope (resolution always includes cross-repo deps). Without the flag, commands show current-repo plans. With it, they show all plans from all repos in the manifest.

### The `repoAlias` field

`Plan.repoAlias` already exists (`string | undefined` — null for local, alias for remote). Currently `PlanSummary` does NOT carry this field. `toSummary()` maps `frontmatter.repo` (a user-defined tag) to `PlanSummary.repo`. These are different concepts:

- `repo` = user-defined frontmatter tag (e.g., `repo: cloud`) — existing, unchanged
- `repoAlias` = which repository this plan lives in (e.g., `canopy`) — new on PlanSummary

Add `repoAlias?: string` to `PlanSummary` and populate it in `toSummary()`.

### Per-command changes

**`trellis status --project`** — shows all repos' plans grouped by repo, then by status within each repo. Each repo section headed by `<alias> (local)` or `<alias>`. Per-repo counts and project totals.

**`trellis ready --project`** — lists ready plans across all repos, prefixed with repo alias. `--next` still picks from local plans only (you can't work on remote plans).

**`trellis graph --project`** — includes remote plans in output. JSON has `repoAlias` field per node. Text output shows cross-repo edges explicitly.

**`trellis lint --project`** — lint already operates on all plans (local + remote). `--project` changes the text display to group errors/warnings by repo. No logic change needed — only display grouping.

**`trellis epic --project`** — shows epics spanning all repos. Plans from different repos tagged with the same `epic:*` tag appear together. Plan lines include repo alias prefix. Also adds `--offline` support (currently missing from epic command).

**`trellis chunks --project`** — computes chunks per-repo independently (local chunks as today, remote repos chunked separately using their own plan set). Display groups chunks by repo. Also adds `--offline` support (currently missing from chunks command).

**`trellis show <plan-id>`** — no `--project` flag needed. Already handles qualified IDs (`canopy:plan-id`).

### Grouping hierarchy (text output)

When `--project` is set, text output groups by **repo first**, then by the command's natural grouping within each repo:

```
trellis (local) — 5 plans

  READY (2)
    plan-schema       Plan schema system                         [foundation]
    cross-repo-graph  Unified cross-repo dependency graph

  IN PROGRESS (1)
    mcp-server        MCP server for plan management

canopy — 3 plans

  READY (1)
    ui-lib            Shared UI component library

  BLOCKED (1)
    auth-service      ← waiting on: trellis:plan-schema
```

### JSON output

All `--project --json` output adds:
- `repoAlias: string | null` on each plan object (null = local)
- Top-level `repos` array when `--project`:
  ```json
  "repos": [
    { "alias": "trellis", "local": true, "plan_count": 5 },
    { "alias": "canopy", "local": false, "plan_count": 3 }
  ]
  ```

Without `--project`, JSON output is unchanged (backwards compatible).

### Edge cases

- **No manifest configured + `--project`**: warn to stderr ("No manifest configured — showing local plans only"), fall back to local-only display.
- **`--project --offline`**: uses cached remote plans. If cache is empty, silently degrades to local-only (same as existing `--offline` behavior).
- **`computeChunks` with remote plans**: chunks are computed per-repo independently. Remote plans don't mix into local chunks.
