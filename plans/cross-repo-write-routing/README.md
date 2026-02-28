---
title: Cross-Repo Write Routing for MCP Tools
status: done
description: >-
  Enable MCP write tools to create and modify plans in sibling repos via
  qualified IDs
tags:
  - cross-repo
  - mcp
type: feature
not_started_at: '2026-02-28T22:19:28.393Z'
started_at: '2026-02-28T22:20:33.487Z'
completed_at: '2026-02-28T22:26:55.867Z'
---

## Problem
MCP write tools can create plans in sibling repos via qualified IDs (`infra-terraform:tf-gke-cluster`), but two gaps remain:

1. **Deps written to disk without dequalification.** When creating `infra-terraform:tf-gke-cluster` with `depends_on: ["infra-terraform:tf-gcp-foundation"]`, the dep is written as-is to frontmatter. On disk inside infra-terraform, this should be stored as `tf-gcp-foundation` (unqualified, since it's intra-repo). Cross-repo deps like `acorn-cloud:some-plan` should stay qualified.

2. **No error guidance for missing manifest.** When a qualified ID targets a repo not in the manifest, or when no manifest exists, the error messages don't guide the user toward the fix.

The MCP `trellis_create` handler at `src/mcp.ts:302-356` already parses qualified IDs and resolves the target `plansDir` via `ctx.getPlansDir(parsed.repo)`. The other write tools (`write_section`, `set`, `update`) already resolve qualified IDs via `resolveId()` against the multi-repo graph. The routing infrastructure is in place — the dequalification and error UX are not.
## Approach
1. Create a `dequalifyDepsForWrite(deps, targetAlias)` utility that strips same-repo qualification from deps before they're written to frontmatter. This is the inverse of `qualifyPlan()` in `src/core/context.ts:195-211` which qualifies bare deps at read time.

2. Wire `dequalifyDepsForWrite` into the MCP `trellis_create` handler so deps are dequalified before being passed to `computeCreate()`.

3. Add descriptive error messages in the MCP layer for two failure modes: repo alias not found in manifest, and no manifest reachable.

4. Test all paths: intra-repo deps dequalified, cross-repo deps preserved, error messages for missing alias and missing manifest.
