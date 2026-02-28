---
title: CLI Cross-Repo Write Commands
status: done
description: CLI write commands gain qualified ID support for cross-repo plan operations
depends_on:
  - 'trellis:cross-repo-write-routing'
tags:
  - cross-repo
  - cli
type: feature
not_started_at: '2026-02-28T22:19:28.950Z'
started_at: '2026-02-28T22:27:18.837Z'
completed_at: '2026-02-28T22:32:12.570Z'
---

## Problem
CLI write commands (`trellis create`, `trellis set`, `trellis update`) only operate on the local repo. They call `createContext(process.cwd())` which builds a single-repo context. Qualified IDs like `infra-terraform:tf-gke-cluster` are not recognized.

This forces cross-repo plan creation to go through MCP tools or manual `cd` + CLI invocations in each repo. The CLI should support the same qualified ID syntax as the MCP tools for consistency.

Relevant code:
- `src/features/create/command.ts:31` — `createContext(projectDir)` (single-repo)
- `src/features/set/command.ts:24` — `createContext(process.cwd())` (single-repo)
- `src/features/update/command.ts:39` — `createContext(process.cwd())` (single-repo)
## Approach
1. Create a shared `resolveCliContext()` function that detects whether a manifest is available (via `project_root` or local `.trellis-project`). When available, return a multi-repo `ContextStore` graph. When not, fall back to `createContext()` (single-repo, current behavior).

2. For each CLI write command, when the plan ID is qualified:
   - Resolve the target repo's plans directory from the manifest
   - Apply `dequalifyDepsForWrite` for create commands (from plan `cross-repo-write-routing`)
   - Pass the resolved `plansDir` to the existing `compute*` function
   - Same error messages as MCP: missing alias → "add to manifest", no manifest → "set project_root"

3. Unqualified IDs continue to work exactly as today — single-repo, no manifest needed.
