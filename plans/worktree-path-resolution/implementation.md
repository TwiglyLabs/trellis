## Steps
<<<<<<< HEAD

## Testing

## Done-when
=======
### 1. Create `src/core/worktree.ts`

New file with:
- `detectWorktree(dir: string): WorktreeInfo` — sync worktree detection
- `detectWorktreeAsync(dir: string): Promise<WorktreeInfo>` — async variant
- `applyWorktreeOverride(repos: ResolvedRepo[], cwd: string): ResolvedRepo[]` — sync override
- `applyWorktreeOverrideAsync(repos: ResolvedRepo[], cwd: string): Promise<ResolvedRepo[]>` — async variant
- Export `WorktreeInfo` type
- Re-export from `src/core/index.ts`

### 2. Modify `src/core/cached-context.ts`

- In `createProjectContext()` (~line 132): after `resolveProjectRepos(manifestPath)`, call `applyWorktreeOverride(repos, projectDir)` before converting to `RepoSpec[]`
- In `createProjectContextAsync()` (~line 262): same with async variant

### 3. Modify `src/mcp.ts`

- In `loadProjectRepos()` (~line 73): after `resolveProjectRepos(manifestPath)`, call `applyWorktreeOverride(repos, projectDir)` before returning specs

### 4. Create `src/core/__tests__/worktree.test.ts`

Test cases:
- `detectWorktree` with `.git` file returns `{ isWorktree: true, mainRepoPath }`
- `detectWorktree` with `.git` directory returns `{ isWorktree: false }`
- `detectWorktree` with missing `.git` returns `{ isWorktree: false }`
- `applyWorktreeOverride` substitutes matching repo's localPath
- `applyWorktreeOverride` returns repos unchanged when not a worktree
- `applyWorktreeOverride` only overrides the matching repo, leaves others alone
- Cache directories are independent for worktree vs canonical path

### 5. Update docs

- `docs/for-agents.md` — add worktree support note
- `docs/architecture.md` — update path resolution section if needed
## Testing
**Unit tests** (`src/core/__tests__/worktree.test.ts`):
- Mock filesystem with `memfs` or similar to simulate `.git` file vs directory
- Test `detectWorktree()` with: worktree `.git` file, normal `.git` dir, missing `.git`, malformed `gitdir:` content, missing `commondir` file
- Test `applyWorktreeOverride()` with: matching repo (verify substitution), no match (verify passthrough), multiple repos (verify only one overridden)

**Integration tests:**
- Use a real git worktree (create one in a temp dir during test setup)
- Run `detectWorktree()` against it and verify correct `mainRepoPath`
- Verify that `resolveProjectRepos()` + `applyWorktreeOverride()` produces correct `localPath` for the worktree repo

**Manual verification:**
- From a real worktree, run `trellis status` and confirm plans are read from the worktree
- Run `trellis_create` via MCP and confirm the plan file appears in `git status` of the worktree
## Done-when
- [ ] Running any trellis MCP tool from a git worktree resolves plans to the worktree's plans directory, not the canonical repo's
- [ ] `trellis status` from a worktree shows plans from the worktree branch
- [ ] `trellis_create` from a worktree writes the new plan file into the worktree, visible in `git status`
- [ ] Non-worktree usage is completely unaffected (no behavioral change)
- [ ] Other repos in the manifest are not affected — only the CWD-matching repo is overridden
- [ ] All new code has both sync and async variants
- [ ] Unit tests pass for worktree detection and override logic
- [ ] Integration test passes with a real git worktree
>>>>>>> main
