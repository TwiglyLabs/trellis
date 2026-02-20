# Plan Schema

## Plan Directory Structure

A plan is always a directory containing a `README.md`. Single `.md` files are not recognized as plans. Plans live flat under the configured plans directory (default `plans/`).

**Plan ID** = directory name relative to the plans directory.

```
plans/
├── my-feature/
│   ├── README.md              # Required: frontmatter + Problem + Approach
│   ├── implementation.md      # Steps, Testing, Done-when
│   ├── inputs.md              # Optional: dependencies and consumed interfaces
│   └── outputs.md             # Optional (required at done if plan has dependents)
│
├── another-plan/
│   └── README.md
```

### File Purposes

| File | Purpose | When Required |
|------|---------|---------------|
| `README.md` | Plan identity: frontmatter metadata, problem statement, approach | Always (defines the plan) |
| `implementation.md` | Execution details: steps, testing strategy, done criteria | At `not_started` and beyond |
| `inputs.md` | What this plan consumes from other plans or existing code | Optional |
| `outputs.md` | What this plan produces for downstream plans | At `done` if plan has dependents |

## Frontmatter Fields

The `README.md` file begins with YAML frontmatter:

```yaml
---
title: My Feature                    # required — plan display name
status: not_started                  # required — see Status Lifecycle below
depends_on:                          # optional — list of plan IDs
  - core-types
  - auth-system
tags: [foundation, public]           # optional — freeform tags (used by epic grouping)
repo: public                         # optional — target repository
description: One-line summary        # optional — short description
assignee: agent-name                 # optional — who's working on it
not_started_at: 2026-02-10T09:00:00Z # auto-set on → not_started
started_at: 2026-02-11T10:00:00Z    # auto-set on → in_progress
completed_at: 2026-02-12T15:30:00Z  # auto-set on → done
sessions: 2                          # prompted on → done
deviation: minor                     # prompted on → done (none | minor | major)
---
```

### Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | Yes | Display name shown in status, ready, show |
| `status` | enum | Yes | `draft`, `not_started`, `in_progress`, `done`, `archived` |
| `depends_on` | string[] | No | Plan IDs that must be `done` before this plan is ready |
| `tags` | string[] | No | Freeform tags. Tags prefixed `epic:` group plans in `trellis epic` |
| `repo` | string | No | Target repository name (for multi-repo projects) |
| `description` | string | No | One-line summary |
| `assignee` | string | No | Who is working on this plan |
| `not_started_at` | ISO datetime | No | Auto-set when status transitions to `not_started` |
| `started_at` | ISO datetime | No | Auto-set when status transitions to `in_progress` |
| `completed_at` | ISO datetime | No | Auto-set when status transitions to `done` |
| `sessions` | number | No | Number of work sessions (prompted on `done` transition) |
| `deviation` | enum | No | How much implementation deviated from plan: `none`, `minor`, `major` |

### Timestamp Behavior

- `not_started_at` is set automatically when a plan transitions to `not_started`
- `started_at` is set automatically when a plan transitions to `in_progress`
- `completed_at` is set automatically when a plan transitions to `done`
- On backward transitions (e.g., `done` → `in_progress`), later timestamps are cleared

## Status Lifecycle

```
draft → not_started → in_progress → done → archived
```

Plans can also transition backward (e.g., `in_progress` → `not_started`). Backward transitions clear timestamps that no longer apply.

A plan is **ready** when:
- Its status is `not_started` (or `draft`)
- All plans in its `depends_on` list have status `done`

A plan is **blocked** when:
- It has unfinished dependencies

### Status Meanings

| Status | Meaning |
|--------|---------|
| `draft` | Idea captured, not yet fully specified |
| `not_started` | Fully specified, waiting to be picked up |
| `in_progress` | Actively being worked on |
| `done` | Implementation complete |
| `archived` | No longer relevant or superseded |

## Status Gates

`trellis update` enforces structural requirements before allowing status transitions. Use `--force` to bypass.

| Target Status | Required Files | Required Sections |
|---------------|----------------|-------------------|
| `draft` | README.md | `## Problem` |
| `not_started` | README.md, implementation.md | README: `## Problem`, `## Approach`; implementation: `## Steps`, `## Testing`, `## Done-when` |
| `in_progress` | README.md, implementation.md | Same as `not_started` |
| `done` | README.md, implementation.md | Same as `not_started`, plus: `outputs.md` required if plan has dependents |
| `archived` | (none) | (none) |

### Section Requirements by File

**README.md:**
- `## Problem` — what needs solving
- `## Approach` — how it will be solved

**implementation.md:**
- `## Steps` — ordered implementation steps
- `## Testing` — how to verify correctness
- `## Done-when` — concrete completion criteria

**inputs.md** (optional):
- `## From plans` and/or `## From existing code` — at least one required if file exists

**outputs.md** (optional, required at `done` if plan has dependents):
- At least one `##` heading required

## Configuration

Trellis is configured via a `.trellis/config` file (directory format) or a legacy `.trellis` file in the project root. The directory format is created by `trellis init` and supports a `cache/` directory for cross-repo data.

**Directory format (preferred):**
```
.trellis/
  config              # key: value config (same syntax as legacy .trellis)
  .gitignore          # ignores cache/
  cache/              # local cache for cross-repo data (gitignored)
```

**Config syntax:**
```
project: my-project
plans_dir: plans
chunk_max_lines: 8000
chunk_strategy: directory
manifest: git@github.com:org/manifest.git
```

| Key | Default | Description |
|-----|---------|-------------|
| `project` | (required) | Project name |
| `plans_dir` | `plans` | Directory containing plan directories |
| `chunk_max_lines` | `8000` | Maximum lines per chunk in `trellis chunks` |
| `chunk_strategy` | `directory` | Chunk grouping strategy: `directory` or `topological` |
| `manifest` | (none) | Git URL for multi-repo manifest |

Inline comments are supported: `plans_dir: plans  # where plans live`

Legacy `.trellis` files still work — run `trellis init` to upgrade to the directory format.
