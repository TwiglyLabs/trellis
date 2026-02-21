
## Steps

### 1. Add `remote` field to Plan and update write guards

**Files:** `src/core/types.ts`, `src/core/manifest.ts`, `src/features/update/logic.ts`, `src/features/set/logic.ts`, `src/features/sections/logic.ts`, `src/features/rename/logic.ts`, `src/features/archive/logic.ts`

- Add `remote?: boolean` to `Plan` interface in types.ts
- Set `remote: true` in `fetchRepoPlans()` (manifest.ts line ~144) alongside existing `repoAlias`
- Change all 6 write guards from `plan.repoAlias != null` to `plan.remote === true`
- Update `toSummary()` in types.ts to propagate `remote` if present
- Verify all existing tests still pass (they should — local plans don't have `remote` set)

### 2. Extend `MultiRepoEntry` with `plansDir` and `config`

**Files:** `src/core/types.ts`, `src/core/context.ts`

- Add optional `plansDir?: string` and `config?: TrellisConfig` to `MultiRepoEntry`
- In `createMultiContext()`, populate these fields during the per-repo scan (the values are already computed locally, just not returned)
- Update multi-context tests to verify the new fields are present

### 3. Add plan ID resolution helper

**Files:** `src/core/utils.ts` (new function)

- `resolvePlanId(graph: GraphData, rawId: string): { qualifiedId: string; alias?: string; localId: string }`
- Uses `parseQualifiedId()` for qualified IDs — verify alias:plan exists in graph
- For unqualified IDs — search all qualified entries, error if ambiguous
- Used by MCP tool handlers to normalize plan IDs before passing to compute functions

### 4. Add repo specification parsing

**Files:** `src/mcp.ts` (or new `src/core/repos.ts`)

- `parseReposFlag(input: string): RepoSpec[]` — parses `alias=path,alias=path` format
- Validates: paths are absolute and exist, aliases are valid identifiers, no duplicates
- `loadProjectRepos(projectDir: string): RepoSpec[]` — reads `.trellis-project`, extracts entries with `path` field, builds RepoSpec array
- Validates: project dir exists, manifest is valid, at least one repo has `path`

### 5. Extend `createMcpServer` for multi-repo mode

**Files:** `src/mcp.ts`

- Change signature: `createMcpServer(options?: { repos?: RepoSpec[] }): McpServer`
- Internal context factory: `getContext()` returns `{ plans, graph, repos?, repoEntries? }` — calls `createMultiContext(repos)` if repos provided, else `createContext(cwd)`
- Define a `ToolContext` interface that both modes satisfy:
  ```
  { plans, graph, getPlansDir(alias?), getConfig(alias?), repos?, isMultiRepo }
  ```
- Thread `ToolContext` through all tool handlers

### 6. Update write tools for multi-repo

**Files:** `src/mcp.ts`

- **`trellis_create`**: Parse alias from plan_id. Look up `plansDir` from `repoEntries` by alias. Pass correct plansDir to `computeCreate`.
- **`trellis_update`**: Use `resolvePlanId()` to normalize the plan ID. Pass to `computeUpdate` with multi-repo graph.
- **`trellis_set`**: Same pattern — resolve ID, pass to `computeSet`.
- **`trellis_write_section` / `trellis_write_sections`**: Same — resolve ID, pass to compute function.
- All write tools: use qualified plan ID for the file lock key.

### 7. Update read tools for multi-repo

**Files:** `src/mcp.ts`

- **`trellis_status`**: Pass full plan list. Include `repos` array in JSON response.
- **`trellis_ready`**: Compute readiness across unified graph. Plans already have qualified IDs.
- **`trellis_show`**: Use `resolvePlanId()` to look up plan. Return qualified deps.
- **`trellis_graph`**: Return unified graph. Nodes already have `repoAlias` from plan data.
- **`trellis_lint`**: Validate across repos. Cross-repo dep issues surfaced naturally.
- **`trellis_bottlenecks`**: Analyze across unified graph.

### 8. Add `--project` and `--repos` flags to CLI

**Files:** `src/commands/mcp.ts` (or wherever the mcp subcommand is defined)

- Add `.option('--repos <repos>', 'Comma-separated alias=path pairs for multi-repo mode')`
- Add `.option('--project <dir>', 'Path to directory containing .trellis-project manifest')`
- Parse flags → `RepoSpec[]`
- Pass to `createMcpServer({ repos })`
- Validate mutual exclusivity of `--repos` and `--project`

### 9. Extend manifest to support local `path` field

**Files:** `src/core/manifest.ts`, `src/core/types.ts`

- Add optional `path?: string` to `RepoEntry` type
- Update `parseManifest()` validation to accept entries with `path` (without requiring `url`)
- `loadProjectRepos()` (from step 4) filters manifest entries that have `path` set

## Testing

### Unit Tests

**`src/__tests__/mcp-multi-repo.test.ts`** (new file):
- `parseReposFlag` — valid input, invalid paths, missing aliases, duplicates
- `resolvePlanId` — qualified hit, unqualified unique hit, unqualified ambiguous error, not found
- `loadProjectRepos` — manifest with path entries, manifest without paths, missing manifest

**`src/__tests__/remote-field.test.ts`** (new file or extend existing):
- Plans from `fetchRepoPlans` have `remote: true`
- Plans from `createMultiContext` do NOT have `remote: true`
- Write guards reject `remote: true` plans
- Write guards allow plans with `repoAlias` but no `remote` flag (multi-repo local)

**Existing test suites** — must all pass unchanged:
- All write guard tests still pass (local plans unchanged)
- Multi-context tests still pass (extended return type is additive)
- Cross-repo tests still pass (remote plans now have `remote: true`)

### Integration Tests

**`src/__tests__/mcp-multi-repo-integration.test.ts`** (new file):
- Set up two fixture repos with `createFixture()`
- Create MCP server with `createMcpServer({ repos: [...] })`
- Test each tool handler via `server._registeredTools[name].handler(args, {})`:
  - `trellis_status` — returns plans from both repos, qualified IDs
  - `trellis_create` — creates plan in specified repo (`grove:new-plan`)
  - `trellis_write_section` — writes to plan in correct repo
  - `trellis_set` — updates frontmatter in correct repo
  - `trellis_update` — transitions status with cross-repo gate validation
  - `trellis_show` — returns qualified plan with cross-repo deps
  - `trellis_ready` — computes readiness across repos
  - `trellis_lint` — validates cross-repo dependencies
  - `trellis_graph` — returns unified nodes with `repoAlias`
  - `trellis_bottlenecks` — analyzes across repos
- Write isolation: creating plan in repo A doesn't create files in repo B
- Unqualified ID resolution: works when unambiguous, errors when ambiguous
- Error cases: unknown alias, missing plan, write to nonexistent repo

### Backward Compatibility Tests

- MCP server without `repos` option behaves identically to current (single-repo)
- Existing MCP tests pass without modification
- `--repos` and `--project` flags don't affect `trellis mcp` without arguments

## Done-when

- [ ] `trellis mcp --repos canopy=/path,grove=/path` starts MCP server scanning both repos
- [ ] All read tools (`status`, `ready`, `show`, `graph`, `lint`, `bottlenecks`) return unified data with qualified plan IDs
- [ ] All write tools (`create`, `write_section`, `write_sections`, `set`, `update`) accept qualified `alias:planId` and write to the correct repo's filesystem
- [ ] Unqualified plan IDs resolve when unambiguous across repos; error with suggestions when ambiguous
- [ ] `trellis_create` with `grove:new-plan` creates the plan directory under grove's plans dir, not cwd
- [ ] Plans from `createMultiContext` (local worktrees) are writable; plans from git-fetch remain read-only
- [ ] `trellis mcp` without `--repos`/`--project` flags behaves identically to current single-repo mode
- [ ] All existing tests (633+) pass unchanged
- [ ] New test file covers: repo parsing, ID resolution, write isolation, cross-repo reads, error cases
- [ ] `trellis mcp --project /path` reads `.trellis-project` and resolves repos with `path` field
