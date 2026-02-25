---
title: Resolve plans to git worktree path instead of canonical repo path
status: in_progress
description: >-
  In project mode, detect when CWD is a git worktree of a manifest repo and use
  the worktree path for plan reads/writes instead of the manifest's canonical
  path.
tags:
  - mcp
  - worktree
  - path-resolution
type: bugfix
not_started_at: '2026-02-24T23:40:44.804Z'
started_at: '2026-02-24T23:44:28.073Z'
completed_at: '2026-02-25T00:27:11.564Z'
---

## Problem
In project mode, the manifest defines canonical repo paths (e.g., `~/repos/twiglylabs/tooling/trellis/`). When running from a git worktree (e.g., `/Users/bmatola/worktrees/trellis/mcp-optimizations/`), trellis resolves plan operations against the canonical path, not the worktree.

This means:
- `trellis_create` writes plans to the main checkout, not the worktree's branch
- Plans don't appear in `git status` of the worktree
- The user has to manually move/cherry-pick plan files to their feature branch

**Root cause:** `resolveProjectRepos()` in `manifest.ts` resolves repo paths from the manifest's `base_dir` + relative paths. There's no check for whether CWD is a worktree of one of those repos.
## Approach
When building the multi-repo context, detect if `process.cwd()` is a git worktree of any manifest repo. If so, substitute the worktree path for that repo's canonical path.

**Detection strategy:**
1. Read CWD's `.git` — if it's a file (not directory), it's a worktree
2. Parse the `gitdir:` pointer to find the main repo's `.git` directory
3. For each manifest repo, compare git toplevel directories
4. If CWD's main repo matches a manifest repo, use CWD's path instead

**Scope:** Only the "current repo" gets overridden. Other repos in the manifest keep their canonical paths. This is correct because you're only working in one worktree at a time.

**Where to apply:** In `resolveProjectRepos()` or in `ContextStore.loadRepo()` — after manifest resolution but before plan scanning.

## Steps
### 1. Add git worktree detection utility

Create a function in `src/core/` that:
- Checks if a given path has a `.git` file (not directory)
- Parses `gitdir: <path>` to find the real `.git` dir
- Resolves the main repo toplevel from `.git/worktrees/<name>/commondir`
- Returns `{ isWorktree: boolean, mainRepoPath?: string }`

### 2. Add worktree override to repo resolution

In the code path where manifest repos are resolved to local paths:
- After resolving canonical paths, detect if CWD is a worktree
- If CWD's main repo matches a manifest repo's path, substitute CWD
- Log or note the override for debugging

### 3. Ensure cache isolation

Worktrees already have independent `.trellis/cache/` dirs. Verify that the path override doesn't break cache keying — the cache key should use the actual resolved path, not the canonical one.

### 4. Add tests

- Unit test for worktree detection (mock `.git` file vs directory)
- Integration test: create a plan from a worktree context, verify it lands in worktree's plans dir
- Test that non-worktree repos are unaffected

### 5. Update documentation

- Note worktree support in docs/for-agents.md
- Update docs/architecture.md if path resolution logic changes
