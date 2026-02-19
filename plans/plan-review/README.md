---
title: Plan Review System
status: archived
tags:
  - orchestration
  - cli
  - review
depends_on:
  - orchestration-foundations
description: Chunk-based plan review with multi-agent synthesis for large plan sets
---

# Plan Review System

Review large plan sets for consistency, correctness, and completeness by breaking them into reviewable chunks and dispatching parallel review agents.

## Problem

Large trellis projects (20+ plans, 20K+ lines) exceed a single context window. Manual review misses cross-plan inconsistencies. We need:

1. **Automatic chunk discovery** — identify natural reviewable units from the dependency graph
2. **Manual chunk override** — let users control grouping via tags
3. **Parallel review** — dispatch subagents per chunk, synthesize findings
4. **Structured output** — machine-readable findings for downstream tooling

## Approach

### Trellis Side: `trellis chunks` command

Identifies reviewable subgraphs of the plan DAG. See [design/chunks-command.md](design/chunks-command.md).

### Claude Side: `plan-review` skill

Orchestrates multi-agent review using chunks as the unit of work. See [design/review-skill.md](design/review-skill.md).

## Review Artifacts

Review output lives in `plans/.review/` (gitignored). Reports are ephemeral and auto-cleaned on each run — stale cached reports (where chunk membership changed or plan files were modified) are deleted before new reviews begin. The `--recheck` flag leverages cached results to skip re-reviewing clean, unchanged chunks.

## Design Documents

- [Chunks Command](design/chunks-command.md) — trellis CLI addition
- [Review Skill](design/review-skill.md) — claude skill for orchestrated review
