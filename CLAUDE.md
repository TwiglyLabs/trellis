# Trellis

**Freshness:** 2026-02-18

## Purpose

Trellis is a lightweight CLI tool for managing plans with dependencies across twiglylabs projects. It scans a plans directory, reads YAML frontmatter from markdown files, builds a dependency graph, and answers "what can I work on next?"

No manifest file. The plan files ARE the source of truth.

## Stack

- TypeScript, Node.js
- Single binary via esbuild bundle
- Built-in web viewer (served locally by `trellis graph`)
- Zero runtime dependencies beyond Node

## How It Works

Each consuming project has a `plans/` directory with markdown files. Each plan file has YAML frontmatter with metadata (title, status, depends_on, tags). Trellis scans, parses frontmatter, and builds the DAG.

A plan is always a directory with a `README.md` containing frontmatter. Single `.md` files are not recognized as plans. Plans live flat under `plans/` — no status-based subfolders.

Plan ID = directory name relative to plans dir.

### Plan Directory Structure

```
plans/<plan-id>/
  README.md              # frontmatter + Problem + Approach
  implementation.md      # Steps + Testing + Done-when
  inputs.md              # optional: dependencies and consumed interfaces
  outputs.md             # optional (required at done if plan has dependents)
```

### Status Gates

`trellis update` enforces structural gates on status transitions:

| Transition | Gate |
|---|---|
| → `draft` | README.md with `## Problem` |
| → `not_started` | README.md has `## Problem` + `## Approach`. implementation.md with `## Steps`, `## Testing`, `## Done-when` |
| → `in_progress` | Same as not_started (already specified) |
| → `done` | outputs.md required if plan has dependents |
| → `archived` | No gate |

Use `--force` to bypass gates.

## Commands

```
trellis status                     # dashboard: what's ready, blocked, in progress
trellis graph                      # open DAG viewer in browser
trellis ready                      # list plans with all dependencies satisfied
trellis update <plan-id> <status>  # edit frontmatter in-place, show what unblocks
trellis lint                       # find cycles, missing deps, bad frontmatter
trellis init                       # scaffold .trellis config + plans/ directory
trellis show <plan-id>             # show plan details and dependency chain
trellis epic [name]                # show epic completion status
trellis chunks                     # identify reviewable subgraphs
trellis metrics                    # cycle time, queue time, sessions for done plans
trellis setup-hooks                # install Claude Code hooks + git pre-commit hook
```

## Frontmatter Schema

```yaml
---
title: Plan Title                  # required
status: not_started                # required: draft | not_started | in_progress | done | archived
depends_on:                        # optional: list of plan IDs
  - contracts/core-types
tags: [foundation, public]         # optional: freeform tags
repo: public                       # optional: target repo
description: One-line summary      # optional
assignee: agent-name               # optional
not_started_at: 2026-02-10T09:00:00Z # optional, auto-set on → not_started
started_at: 2026-02-11T10:00:00Z  # optional, auto-set on → in_progress
completed_at: 2026-02-12T15:30:00Z # optional, auto-set on → done
sessions: 2                        # optional, prompted on → done
deviation: minor                   # optional: none | minor | major, prompted on → done
---
```

## Development

```bash
npm install
npm run build        # esbuild bundle
npm test             # vitest
npm run dev          # watch mode
trellis              # use the installed binary (not node dist/trellis.cjs)
```

**Important:** Always use the `trellis` command (installed at `/opt/homebrew/bin/trellis`), not `node dist/trellis.cjs`.

## Plan Management (for agents)

**Never use Edit, Write, or Bash to modify plan files.** Plans are managed exclusively through trellis MCP tools. Claude Code hooks will block direct file edits.

### Which tool for which operation

| Operation | MCP Tool |
|---|---|
| Create a new plan | `trellis_create` |
| Read plan content or a section | `trellis_read_section` |
| Write/update plan content | `trellis_write_section` |
| Update metadata (title, tags, etc.) | `trellis_set` |
| Change plan status | `trellis_update` |

### Plan granularity

Plans should be implementable in roughly half a context session. If a plan feels too big, split it. When reviewing plans, check granularity — flag plans that should be decomposed.

### Workflow example

```
# Check what's ready to work on
trellis ready

# Read a plan's details
trellis_read_section(plan_id="my-plan")

# Start working on it
trellis_update(plan_id="my-plan", status="in_progress")

# Write implementation details
trellis_write_section(plan_id="my-plan", file="implementation", section="Steps", content="...")

# Mark it done when finished
trellis_update(plan_id="my-plan", status="done")
```

## Design Principles

- **File-first.** Plan files are the entire state. No hidden databases or config.
- **Frontmatter-driven.** Metadata lives in the plan file itself. No manifest to sync.
- **Project-local.** Each project owns its own plans directory.
- **Read-heavy.** Most usage is `status`, `ready`, `graph`. Writes are `update`.
- **No opinions about plan content.** Trellis reads frontmatter only. Plan body can be any format.
