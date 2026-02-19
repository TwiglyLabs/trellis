---
title: Plan Schema Definition
status: done
depends_on: []
tags:
  - foundation
  - plan-management
description: >-
  Define canonical plan structure, required sections per file, and status
  lifecycle gates
started_at: '2026-02-19T02:32:46.896Z'
completed_at: '2026-02-19T02:42:18.454Z'
---

# Plan Schema Definition

Define what a well-formed trellis plan looks like so the system can enforce structure programmatically.

## Problem

Plans today are freeform markdown with YAML frontmatter. There's no consistency — some plans have implementation steps, some don't. Some have testing strategies, most don't. Agents miss parts of plans because there's nothing enforcing completeness. This is worst with large plans where the agent loses track of sections.

Without defined structure, there's no way to validate plan completeness programmatically. A plan can be marked `in_progress` without implementation steps, or `done` without documenting its outputs.

## Approach

### Directory-only plans

A plan is always a directory containing well-known files. Single-file plans are not valid. Plans live at `plans/<plan-id>/` — flat, no status-based subfolders. Plan ID = directory name.

```
plans/<plan-id>/
  README.md              # frontmatter + Problem + Approach
  implementation.md      # Steps + Testing + Done-when
  inputs.md              # optional: dependencies and consumed interfaces
  outputs.md             # optional (required at done if plan has dependents)
```

### Required sections per file

| File | Required sections |
|---|---|
| README.md | `## Problem`, `## Approach` |
| implementation.md | `## Steps`, `## Testing`, `## Done-when` |
| inputs.md | `## From plans` and/or `## From existing code` |
| outputs.md | At least one `##` heading |

Section validation is presence-only — trellis checks that headings exist, not what's under them. Content within sections is freeform.

inputs.md and outputs.md are optional files. When present, their sections are validated.

### Status lifecycle gates

| Transition | Gate |
|---|---|
| → `draft` | README.md with valid frontmatter (title, status) + `## Problem` |
| → `not_started` | README.md has `## Problem` + `## Approach`. implementation.md exists with `## Steps`, `## Testing`, `## Done-when` |
| → `in_progress` | No additional gate — plan is already fully specified |
| → `done` | outputs.md required if plan has dependents |

Gates are enforced at runtime by `trellis update`. A plan returned by `trellis ready` is guaranteed to have complete implementation details. A `--force` flag on `update` bypasses gates for exceptional cases.

### Flat directory layout

All plans live directly under `plans/`. No `plans/active/`, `plans/done/` subfolders. Status is tracked in frontmatter only — no filesystem moves, no broken IDs. Organization is the CLI's job (`trellis status` groups by status, `trellis epic` groups by tag).

Archived plans can be moved to `plans/.archive/` via `trellis archive`.

### Chunk system impact

The current chunk system (`computeChunks()`) groups plans by directory prefix. A flat `plans/` layout means all plans are root-level, so directory-based grouping no longer applies. The chunk strategy needs updating — likely to use `chunk:name` tags or topological grouping as the primary strategy. This is out of scope for this plan but is a known downstream impact.
