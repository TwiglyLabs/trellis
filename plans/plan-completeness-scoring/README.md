---
title: Plan Completeness Scoring
status: not_started
description: >-
  Section depth analysis, word counts, and completeness metrics so Canopy can
  surface a needs-refinement queue
tags:
  - canopy
  - refinement
depends_on: []
not_started_at: '2026-02-21T01:48:52.428Z'
---

## Problem
Status gates in trellis are binary: a section either exists or it doesn't. A plan with `## Problem\nTBD` passes the gate check for `not_started` just as cleanly as a plan with a fully articulated problem statement. The gate enforces structure, not substance.

This gap has a practical consequence. When a user has a backlog of a dozen draft plans, there is no automated way to answer "which of these plans actually needs more thinking?" They must open each file, read it, and decide — a manual, time-consuming triage process that doesn't scale.

The problem surfaces most acutely in two scenarios:

1. **Refinement queuing.** Canopy (the Electron dashboard) needs to show a "what needs my attention" view, sorted by how unfinished each plan's thinking is. Without completeness data on the Plan object, Canopy has no signal to sort or filter on. Every plan looks identical at the API boundary.

2. **Accidental progression.** A plan can reach `not_started` status with stub content — a Problem that's one sentence, no real Approach, an implementation file that just says "TODO: figure this out." Nothing in the current system flags this as a concern. The plan looks ready to execute but isn't.

The root cause is that trellis currently tracks *where* plans are in the status lifecycle but has no opinion about *how well-developed* the thinking behind each plan is. These are orthogonal dimensions, and the second one is currently invisible.
## Approach
Add a `completeness` field to the `Plan` type and populate it during `scanPlans()`. The field is a structured object that captures per-section scores and an aggregate score, making completeness data available everywhere a `Plan` is used — CLI, API, and Canopy.

### Scoring model

Each section gets a score from 0–100 based on word count against configurable thresholds:

| Score | Meaning | Trigger |
|-------|---------|---------|
| 0 | Stub | Placeholder text detected, or word count < low threshold |
| 50 | Thin | Word count between low and high threshold |
| 100 | Complete | Word count >= high threshold |

Default thresholds (overridable via flat keys in `.trellis/config`):

| Section | Low threshold | High threshold | Config keys |
|---------|--------------|----------------|-------------|
| Problem | 20 words | 50 words | `completeness_problem_low`, `completeness_problem_high` |
| Approach | 20 words | 60 words | `completeness_approach_low`, `completeness_approach_high` |
| Steps | 30 words | 80 words | `completeness_steps_low`, `completeness_steps_high` |
| Testing | 15 words | 40 words | `completeness_testing_low`, `completeness_testing_high` |
| Done-when | 10 words | 25 words | `completeness_done_when_low`, `completeness_done_when_high` |

Sections not yet written (file missing or section absent) score 0. Aggregate plan completeness is the mean of all expected section scores for the plan's current status — sections not yet expected at a given status are excluded from the denominator.

**Placeholder detection:** Before scoring by word count, strip YAML frontmatter and check the section body for placeholder patterns: `TBD`, `TODO`, `FIXME`, `placeholder`, `coming soon`, or a body consisting entirely of whitespace. Any match forces a score of 0 regardless of word count.

### New types and module

Add to `src/types.ts`:

```ts
interface SectionScore {
  score: 0 | 50 | 100;
  wordCount: number;
  reason: 'missing' | 'placeholder' | 'thin' | 'complete';
}

interface CompletenessResult {
  sections: Record<string, SectionScore>;
  aggregate: number; // 0–100, mean of applicable sections
}
```

Add `completeness: CompletenessResult` to the `Plan` interface.

Implement `computeCompleteness(plan: Plan, config: TrellisConfig): CompletenessResult` in a new `src/completeness.ts` module. Call it from `scanPlans()` after the plan object is assembled. The function accepts an optional `type?: string` parameter for future type-aware threshold selection, but defaults to uniform thresholds for all plans.

### Export via library API

Add `completeness` to the `show --json` output. Ensure the API (`src/api.ts`) surfaces it on the `Plan` objects returned by `readPlan()` and the full scan path so Canopy can consume it without extra computation.

### CLI lint integration (opt-in)

In `trellis lint`, add a `--completeness` flag that emits warnings for sections scoring 0 or 50. Warnings follow the existing lint warning pattern (non-fatal unless `--strict` is also passed). This makes thin plans visible at the command line without requiring Canopy.

### What this deliberately excludes

- NLP, readability scoring, or semantic analysis — word counts only.
- Blocking status transitions on completeness scores — gates remain binary and structural. Completeness is advisory.
- Per-user calibration of thresholds at runtime — config-file overrides are enough.
- Type-specific threshold profiles — uniform thresholds for now. When `plan-templates` ships the `type` field, completeness scoring gains a one-line update to pass the type through for differentiated thresholds.
