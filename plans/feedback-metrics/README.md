---
title: Feedback & Metrics
status: done
depends_on: []
tags:
  - process
  - plan-management
description: >-
  Capture turnaround data on plan execution so the process can be calibrated
  over time
started_at: '2026-02-19T05:04:16.555Z'
completed_at: '2026-02-19T05:11:44.212Z'
---

# Feedback & Metrics

Instrument the plan lifecycle so you can learn from what's working and what isn't.

## Problem

Plans go `draft → not_started → in_progress → done` but nothing captures how that went. `started_at` and `completed_at` exist but nothing consumes them. There's no record of whether a plan was well-scoped, whether the agent needed multiple sessions, or whether the implementation matched the approach. Without this data, you can't tell good plans from bad ones, can't calibrate granularity, and can't identify process bottlenecks.

## Approach

Three layers, in order of effort:

### 1. `trellis metrics` command

A read-only command over data that already exists. No new collection needed.

For each done plan:

| Field | Source |
|---|---|
| plan ID | frontmatter |
| cycle time | `completed_at - started_at` |
| queue time | `not_started_at - created_at` (new, see below) |
| plan lines | `lineCount` (already computed by scanPlans) |
| tags | frontmatter |
| epic | `epic:*` tags |

Output: a summary table sorted by completion date, with aggregate stats (median cycle time, total plans completed, plans per epic).

`--json` output for canopy consumption. `--since <date>` to filter to a time range.

### 2. New timestamp: `not_started_at`

`trellis update` already auto-sets `started_at` and `completed_at`. Add `not_started_at` — auto-set when a plan transitions to `not_started`. This captures when the plan became "ready to implement" and enables queue time measurement (how long plans sit before someone picks them up).

### 3. `retro.md` — lightweight post-completion notes

A convention (not enforced yet — enforcement comes with plan-schema). When a plan is marked `done`, the implementer adds a `retro.md` to the plan directory:

```markdown
## Metrics
- sessions: 2
- deviation: minor

## What worked
Plan was well-scoped, implementation.md steps mapped directly to commits.

## What didn't
Testing section underspecified — spent a full session figuring out test strategy.

## Lessons
For plans that touch the parser, always specify which test fixtures to create.
```

Fields:

- **sessions** — how many agent sessions touched this plan. Even a rough count is useful.
- **deviation** — `none`, `minor`, `major`. Did the implementation follow the plan's approach?

The rest is freeform. The point is a 2-minute reflection, not a formal report.

`trellis update <id> done` prompts for session count and deviation (with `--yes` to skip). These two fields are also written into frontmatter so `trellis metrics` can aggregate them without parsing markdown:

```yaml
sessions: 2
deviation: minor
```

### What this does NOT cover

- Automated quality checks (test pass rate, lint violations) — that's CI, not trellis
- PR review cycle counting — useful but requires GitHub API integration, save for later
- Agent capability matching — orthogonal concern
- Real-time dashboards — canopy can build this over the `--json` output
