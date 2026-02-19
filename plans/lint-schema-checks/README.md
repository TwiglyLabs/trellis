---
title: Lint Schema Validation
status: not_started
depends_on:
  - plan-schema
tags: [cli, validation, plan-management]
description: Extend trellis lint to validate plan structure against the schema — missing sections, file layout, status gate compliance
---

# Lint Schema Validation

Extend `trellis lint` to validate plan structure, not just frontmatter and dependency edges.

## Problem

Current lint checks catch cycles, missing dependency references, and bad frontmatter. But it can't catch structural issues: a plan with no implementation.md, a README.md missing its `## Problem` section. These are exactly the issues that cause agents to produce incomplete work — the plan looks valid to trellis but is actually missing critical information.

## Approach

Add structural lint checks that use the plan schema. This is a hard cutover — all plans must be directory-format with proper sections. No legacy or migration mode.

### File layout checks
- **Error:** Plan is a single file, not a directory
- **Error:** Plan directory missing README.md
- **Warning:** Plan has `depends_on` but no inputs.md
- **Warning:** Plan has dependents but no outputs.md

### Section checks
- **Error:** README.md missing `## Problem` (required for all statuses)
- **Error:** Plan at `not_started` or beyond missing `## Approach` in README.md
- **Error:** Plan at `not_started` or beyond missing implementation.md
- **Error:** implementation.md missing `## Steps`, `## Testing`, or `## Done-when`
- **Warning:** inputs.md exists but missing `## From plans` or `## From existing code`

### Status gate compliance
- **Error:** Plan's current status doesn't satisfy its own gates (e.g., `not_started` plan without implementation.md)
- This catches plans that were manually edited to violate gates after creation

### Reconciliation with existing checks

Existing lint already has contract-related checks (missing outputs.md for plans with dependents, inputs.md referencing missing depends_on). These are superseded by the structural checks above. Remove the old contract checks and replace them with the schema-based checks to avoid duplicate warnings. The `contract_coverage` metric in `--json` output is dropped.

### Reporting
- Structural issues grouped under a "Structure" category in output alongside existing "Dependencies" and "Frontmatter" categories
- `--json` output gains a `structural` key with errors/warnings arrays
- `--fix` auto-scaffolds missing files and section headings (creates implementation.md with required headings, adds missing `## Problem` heading to README.md, etc.). Reports what was fixed.

### Runtime enforcement

Status gate validation is also enforced at runtime by `trellis update` (implemented in plan-schema). Lint catches retroactive violations — plans that were valid when created but no longer satisfy gates due to manual edits.
