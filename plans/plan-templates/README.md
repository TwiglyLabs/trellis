---
title: Plan Templates by Type
status: not_started
description: >-
  Template system for different plan types (feature, bugfix, refactor,
  investigation) with tailored section scaffolds
tags:
  - refinement
not_started_at: '2026-02-21T01:48:52.973Z'
---

## Problem
Every plan created with `trellis create` or `trellis_create` gets the same empty scaffold: a README.md with blank `## Problem` and `## Approach` headings, and a generic implementation.md with blank `## Steps`, `## Testing`, and `## Done-when` headings. This one-size-fits-all structure fails to match the actual shape of different kinds of work.

A bugfix plan and a feature plan are fundamentally different documents. A bugfix needs reproduction steps, a root cause analysis, and a description of the fix. A feature plan needs a user story, design decisions, and migration concerns. A refactor plan needs a description of the current state, the target state, and an incremental migration strategy. An investigation plan — the kind written to explore an unknown before committing to a solution — may need nothing more than a hypothesis, a methodology, and a findings section, with no implementation.md at all because there is nothing to implement yet.

Without templates, every agent and every human starts from a blank slate and must remember what sections are appropriate for the type of work at hand. The result is inconsistent plans: some are thorough, some are sparse, and reviewers have no way to tell whether a sparse plan is complete or just forgot a section. Status gates already enforce that certain sections exist before a plan can advance, but they enforce the same sections for every plan regardless of type. An investigation plan that has no implementation.md will fail the not_started gate even if it is perfectly complete for its purpose.

For the plan refinement workflow, this problem compounds. Completeness scoring is only meaningful when there is a shared understanding of what a complete plan looks like. Templates provide guard rails: they define what sections should be present and give hints about what each section should contain, making it possible to score completeness relative to a known target rather than against a generic checklist.
## Approach
Introduce a lightweight template system where each plan type defines which files to create, which sections go in each file, and optional hint text per section that tells the author what to write there. Templates ship as markdown files in `.trellis/templates/` so they are project-local, version-controlled, and customizable without touching the trellis binary.

**Built-in types**

Trellis ships with four built-in templates: `feature`, `bugfix`, `refactor`, and `investigation`. `trellis init` writes these into `.trellis/templates/` as a starting point. Users can edit them freely; trellis only reads from that directory.

- `feature`: README.md (Problem with user story prompt, Approach with design decisions and migration concerns), implementation.md (Steps, Testing, Done-when)
- `bugfix`: README.md (Problem with reproduction steps and root cause analysis, Approach with fix description), implementation.md (Steps, Testing, Done-when)
- `refactor`: README.md (Problem with current state description, Approach with target state and migration strategy), implementation.md (Steps, Testing, Done-when)
- `investigation`: README.md only (Problem with hypothesis, Approach with methodology, Findings section). No implementation.md.

Epics are not a plan type — they are represented by `epic:*` tags on regular plans and tracked by `trellis epic`. This keeps the type system focused on structural differences in plan scaffolding.

**Template format**

Each template is a directory under `.trellis/templates/<type>/` mirroring the plan directory structure. Files inside are markdown with `<!-- hint: ... -->` comments that guide authorship during creation. On `trellis create --type feature my-plan`, trellis copies the template files, substitutes the plan id and title, and writes the scaffolded plan.

**CLI and MCP changes**

`trellis create` gains an optional `--type <type>` flag (default: `feature` or the value of `default_plan_type` in `.trellis/config`). `trellis_create` gains a corresponding optional `type` parameter. When type is omitted, the current generic scaffold is used as a fallback so existing workflows are not broken.

**Frontmatter field**

A new optional `type` frontmatter field records the plan type. `trellis set type investigation my-plan` lets users retroactively tag existing plans. `trellis status --json` and `trellis show --json` include the field when present. The `type` field is added to the `EDITABLE_FIELDS` whitelist in `set()`. Plans without a `type` field are treated as untyped — no implicit default is backfilled.

**Scope boundary**

Templates are scaffolding only. They do not modify status gates or enforce section content beyond what gates already do. Hints are informational. Type-aware gate modifications (e.g., investigation plans skipping implementation.md requirement) are a follow-up concern, not part of this plan. The goal is a better starting point and more meaningful completeness scoring, not a new layer of validation.
