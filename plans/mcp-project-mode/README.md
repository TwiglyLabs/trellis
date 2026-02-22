---
title: 'MCP & CLI project mode: auto-detect manifest and aggregate across repos'
status: done
description: >-
  Make the MCP server and CLI commands project-aware — auto-detect manifest from
  config, resolve all local repos, aggregate plans across repos, and support
  cross-repo dependencies via qualified IDs.
depends_on:
  - manifest-workspace-resolution
tags:
  - 'epic:project-mode'
type: feature
not_started_at: '2026-02-22T15:05:05.286Z'
completed_at: '2026-02-22T15:26:17.989Z'
---

## Problem
The MCP server and CLI commands operate in single-repo mode by default. Multi-repo mode exists but requires explicit `--repos` or `--project` flags. The `.trellis` config already has a `manifest` field pointing to a git URL, and `trellis sync` produces a local `.trellis-project` file — but the MCP ignores both.

This means:
- Users must manually pass `--project <dir>` to get cross-repo visibility in the MCP
- CLI commands like `trellis status` only show local plans, even when a manifest is configured
- Creating cross-repo dependency chains requires a commit-push-sync cycle at every step, because plans in other repos are only visible via git fetch
- There's no unified project view — you have to switch between repos manually

With `resolveProjectRepos()` (from manifest-workspace-resolution), all repos can be resolved to local disk paths. The MCP and CLI should use this to auto-enter project mode, reading plans directly from disk across all repos. No git fetch needed for local repos.
## Approach
### Auto-detection

When the MCP starts or a CLI command builds context:

1. Load `.trellis` config from cwd via `loadConfig()`
2. If config has `manifest` field → look for `.trellis-project` in the project directory
3. If `.trellis-project` exists → call `resolveProjectRepos()` to get `ResolvedRepo[]`
4. Filter to repos where `exists: true` → convert to `RepoSpec[]`
5. Initialize in multi-repo mode with those specs
6. If `.trellis-project` doesn't exist → error: "Run `trellis sync` first to fetch the project manifest"
7. `--project` and `--repos` flags still work as explicit overrides in the MCP

### MCP: extend `buildStore()`

The existing `buildStore()` function in `mcp.ts` currently only checks for `options.repos`. Add a third path:

```
if (options.repos) → multi-repo mode (existing)
else if (config.manifest && .trellis-project exists) → project mode (NEW)
else → single-repo mode (existing)
```

Project mode uses `resolveProjectRepos()` to get disk paths, then creates a `ContextStore` with all resolved repos. From that point on, the existing multi-repo tool handlers work unchanged — they already handle qualified IDs, multi-repo graphs, and cross-repo resolution.

### CLI: extend `createContext()`

The CLI commands all go through `createContext(cwd)`. Extend this to auto-detect project mode:

1. After loading config, check for `manifest` + local `.trellis-project`
2. If found, resolve all repos via `resolveProjectRepos()`
3. Scan plans from all resolved repo directories on disk
4. Build a unified graph with qualified plan IDs (e.g., `canopy:auth-flow`)
5. Return a project-wide context

Since all CLI commands use `createContext()`, they get project mode for free — no per-command changes needed.

### Cross-repo dependencies

Cross-repo deps use qualified IDs in frontmatter: `depends_on: ["canopy:auth-flow"]`. This already works with the existing `resolvePlanId()` machinery.

- **Writes**: `trellis_create` with `id: "canopy:auth-flow"` writes to canopy's plans dir. `depends_on: ["trellis:mcp-project-mode"]` is stored as-is in frontmatter.
- **Reads**: In project mode, qualified IDs resolve against the full graph. In single-repo mode, they're inert strings (lint can warn).
- **No git required**: Plans are read directly from disk. No commit-push-sync cycle needed for cross-repo visibility.

### Error handling

- Config has `manifest` but no `.trellis-project` → error with "Run `trellis sync` first"
- `.trellis-project` exists but some repos don't exist on disk → include available repos, warn about missing ones
- No manifest, no flags → single-repo mode (unchanged behavior)
