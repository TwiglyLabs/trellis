---
title: Resolve plans to git worktree path instead of canonical repo path
status: done
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
3. Resolve the main repo root from the `commondir` pointer in the worktree's gitdir
4. For each manifest repo, compare resolved real paths (`fs.realpathSync`) to the main repo root
5. If CWD's main repo matches a manifest repo, use CWD's path instead

**Path normalization:** Both the manifest repo path (after `expandTilde()`) and the worktree's main repo path must be normalized with `fs.realpathSync()` before comparison. This handles symlinks and inconsistent trailing slashes.

**Scope:** Only project mode (multi-repo with manifest) is affected. Single-repo mode already uses `process.cwd()` directly via `createContext()`, so no changes needed there. Only the "current repo" gets overridden — other repos in the manifest keep their canonical paths.

**Where to apply:** Three code paths need the override:
1. `createProjectContext()` in `cached-context.ts` — CLI sync path
2. `createProjectContextAsync()` in `cached-context.ts` — CLI async path
3. `loadProjectRepos()` in `mcp.ts` — MCP server path

All three call `resolveProjectRepos()` / `resolveProjectReposAsync()` and convert the results to `RepoSpec[]`. The override applies after manifest resolution, before `RepoSpec` construction.

**Cache isolation:** Automatic. Cache is keyed by the `projectDir` path parameter, so worktree paths naturally get separate `.trellis/cache/` directories. No special handling needed — just verify in tests.
## Steps
### 1. Add git worktree detection utility

Create `src/core/worktree.ts` (and async variant) that exports:

```typescript
interface WorktreeInfo {
  isWorktree: boolean;
  mainRepoPath?: string; // absolute, realpath-normalized
}

function detectWorktree(dir: string): WorktreeInfo
function detectWorktreeAsync(dir: string): Promise<WorktreeInfo>
```

Logic:
- Check if `path.join(dir, '.git')` is a file (not directory) via `fs.statSync` / `fs.lstatSync`
- If file, read contents and parse `gitdir: <path>`
- Follow the gitdir path to find `commondir` file (e.g., `.git/worktrees/<name>/commondir`)
- Read `commondir`, resolve it relative to the gitdir path to get the main `.git` dir
- Derive `mainRepoPath` as the parent of the main `.git` dir, normalized with `fs.realpathSync`
- If any step fails or `.git` is a directory, return `{ isWorktree: false }`

### 2. Add worktree override to repo resolution

Create a helper (in `worktree.ts` or `manifest.ts`):

```typescript
function applyWorktreeOverride(repos: ResolvedRepo[], cwd: string): ResolvedRepo[]
```

Logic:
- Call `detectWorktree(cwd)` to get worktree info
- If not a worktree, return repos unchanged
- For each repo, compare `fs.realpathSync(repo.localPath)` to `worktreeInfo.mainRepoPath`
- If match found, clone the repo entry with `localPath` set to `cwd` and `exists: true`
- Return modified array

Apply this override in all three code paths:
1. `createProjectContext()` in `cached-context.ts` — after `resolveProjectRepos()`, before building `RepoSpec[]`
2. `createProjectContextAsync()` in `cached-context.ts` — same, using async variant
3. `loadProjectRepos()` in `mcp.ts` — after `resolveProjectRepos()`, before returning specs

### 3. Add tests

- **Unit tests for `detectWorktree()`:** mock `.git` file with `gitdir:` content, mock `.git` directory, verify return values
- **Unit tests for `applyWorktreeOverride()`:** verify substitution when CWD matches a manifest repo, verify no-op when CWD is not a worktree, verify only the matching repo is overridden
- **Integration test:** create a plan from a worktree context, verify it resolves to the worktree's plans dir and not the canonical path
- **Verify cache isolation:** confirm that worktree path and canonical path produce independent cache directories

### 4. Update documentation

- Note worktree support in `docs/for-agents.md`
- Update `docs/architecture.md` if path resolution logic changes
