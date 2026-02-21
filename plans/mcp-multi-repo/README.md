---
title: MCP Multi-Repo Mode
status: done
description: >-
  Add --project flag to trellis mcp that enables multi-repo mode using
  createMultiContext. Allows reading and writing plans across all project repos
  from a single MCP server instance.
depends_on:
  - cross-repo-graph
  - cross-repo-manifest
  - mcp-read-tools
tags:
  - mcp
  - cross-repo
type: feature
started_at: '2026-02-21T15:50:37.773Z'
completed_at: '2026-02-21T16:09:48.416Z'
---

## Problem

The trellis MCP server is single-repo: every tool call runs `createContext(process.cwd())` and can only read/write plans in that one directory. Write operations to remote plans are explicitly blocked.

The cross-repo library infrastructure exists and is fully built — `createMultiContext`, `.trellis-project` manifests, qualified plan IDs (`alias:planId`), and git-based remote plan fetching are all done. But none of this is wired into the MCP server.

This is a blocker for Canopy's planning mode, where Claude Code needs to create and edit plans across multiple project repos from a single terminal session. Without multi-repo MCP, Claude can only author plans in one repo at a time.

## Approach

Add a `--project` flag to `trellis mcp` that boots the server in multi-repo mode:

```
trellis mcp --project /path/to/manifest-repo
```

In multi-repo mode:

1. **Context creation** — uses `createMultiContext(repos)` instead of `createContext(cwd)`. The repo list comes from the `.trellis-project` manifest in the specified directory, resolved to local filesystem paths.
2. **Plan IDs are qualified** — all tools return and accept `alias:planId` format (e.g., `grove:auth-models`). Unqualified IDs default to the home repo.
3. **Write tools resolve to correct repo** — `trellis_create`, `trellis_write_section`, `trellis_write_sections`, `trellis_set`, `trellis_update` parse the repo alias from the plan ID and write to the correct repo's `plans/` directory.
4. **Read tools show unified graph** — `trellis_status`, `trellis_graph`, `trellis_ready`, `trellis_show`, `trellis_lint`, `trellis_bottlenecks` all operate on the merged multi-repo context.

Without `--project`, behavior is identical to today (single-repo, cwd-based). This is a purely additive change.

## Design

### Repo Resolution

Two ways to specify repos:

**`--repos` flag** (primary, no manifest needed):
```
trellis mcp --repos canopy=/path/canopy,grove=/path/grove
```
Parsed into `RepoSpec[]` (alias + absolute path). Paths must exist at startup.

**`--project` flag** (reads manifest):
```
trellis mcp --project /path/to/manifest-repo
```
Reads `.trellis-project` from that directory. The manifest format gains an optional `path` field on repo entries for local resolution:

```yaml
repos:
  canopy:
    path: /path/to/canopy/worktree   # local — used for MCP multi-repo
    url: https://github.com/org/canopy.git  # git remote — used for CLI --project
    branch: main
    visibility: public
```

When `path` is present, MCP multi-repo mode uses local scanning via `createMultiContext`. When only `url` is present, the path field is ignored and the existing git-fetch pipeline handles it. Flags `--repos` and `--project` are mutually exclusive.

### Write Resolution

When a write tool receives `grove:auth-models` as `plan_id`:
1. Parse alias `grove` and local ID `auth-models` via `parseQualifiedId()`
2. Look up `grove` in the repo map → `/path/to/grove/worktree`
3. Resolve plans directory from the repo's loaded config
4. Perform the write operation against that directory
5. Re-scan the multi-context (stateless, fresh per call)

### Writability Model

The current single-repo code uses `plan.repoAlias != null` as a proxy for "remote, don't write." This breaks in multi-repo mode where all plans have `repoAlias`.

**Fix:** Replace the `repoAlias` guard with a `remote?: boolean` field on Plan:
- Plans from `createMultiContext` (local worktrees): `remote` is undefined/false → writable
- Plans from `fetchRepoPlans` (git-fetched): `remote: true` → read-only

All 6 write guards (`computeUpdate`, `computeSet`, `computeWriteSection`, `computeWriteSections`, `computeRename`, `computeArchive`) change from:
```typescript
if (plan.repoAlias != null) throw new Error('Cannot modify remote plan...');
```
to:
```typescript
if (plan.remote) throw new Error('Cannot modify remote plan...');
```

This is backward-compatible: single-repo local plans have neither `repoAlias` nor `remote` set, so the guard never fires.

### Unqualified ID Resolution

In multi-repo mode, plan IDs in the graph are always qualified (`grove:auth-models`). When a tool receives an unqualified ID:
1. Try `graph.plans.get(id)` — matches if somehow unqualified
2. Search all repos: `graph.plans.get(alias + ':' + id)` for each alias
3. If exactly one match → use it
4. If zero matches → "plan not found" error
5. If multiple matches → error listing the qualified alternatives

This avoids needing a "home repo" concept and gives clear errors.

### `plansDir` Resolution for Create

`computeCreate` needs a `plansDir` path (the plan doesn't exist in the graph yet). Extend `MultiRepoEntry` to expose `plansDir` and `config`:

```typescript
interface MultiRepoEntry {
  alias: string;
  path: string;
  planCount: number;
  configFound: boolean;
  plansDir?: string;    // NEW
  config?: TrellisConfig; // NEW
  error?: string;
}
```

The MCP server looks up the target repo's entry by alias to get `plansDir`.

### Tool Changes

No new tools. Existing tools gain multi-repo awareness:

| Tool | Change |
|------|--------|
| `trellis_create` | `plan_id` can be `alias:id`. Creates in the resolved repo's plans dir. |
| `trellis_write_section(s)` | `plan_id` resolves across repos. |
| `trellis_set` | `plan_id` resolves across repos. |
| `trellis_update` | `plan_id` resolves across repos. Status gates checked against multi-context graph. |
| `trellis_status` | Shows plans from all repos. `repos` array in JSON output. |
| `trellis_ready` | Computes readiness across the unified graph. |
| `trellis_show` | Returns qualified plan with cross-repo dependency info. |
| `trellis_graph` | Returns unified graph nodes with `repoAlias` field. |
| `trellis_lint` | Validates across repos (cross-repo dep cycles, missing deps). |
| `trellis_bottlenecks` | Analyzes bottlenecks across the full project. |

### Context Strategy

Stateless, fresh context per tool call. The MCP server stores `RepoSpec[]` at startup. Each tool call runs `createMultiContext(repos)` — scans all repo plan directories. This is fast enough for typical project sizes (5-10 repos, 50-200 plans total).

### Concurrency

The per-plan file lock already uses the plan ID as key. In multi-repo mode, qualified IDs (`grove:auth-models`) are naturally distinct from local IDs (`auth-models`), so the lock works correctly across repos.
## Risks

- **Path resolution** — local paths must be valid at MCP server startup time. If a worktree doesn't exist yet, the server fails clearly with a list of missing paths.
- **Manifest format extension** — adding `path` to `RepoEntry` is backward-compatible (existing manifests without `path` still work for git-fetch). But the dual `path`/`url` model means a single repo entry can have both, so `loadProjectRepos()` must prefer `path` when present.
- **Write atomicity** — writes to different repos are independent (no cross-repo transactions). A failure writing to repo B after successfully writing to repo A leaves partial state. Acceptable for plan authoring (plans are markdown, easily fixed).
- **`remote` field migration** — existing code that checks `plan.repoAlias != null` as a write guard must ALL be updated. Missing one creates a subtle bug where multi-repo writes silently fail. The grep for `repoAlias.*!=.*null` should be exhaustive.
- **Scan cost** — `createMultiContext` re-scans all repos on every tool call. With 5-10 repos and 50-200 plans, this is ~50ms. If repos grow larger, may need caching. Not a concern for initial implementation.
