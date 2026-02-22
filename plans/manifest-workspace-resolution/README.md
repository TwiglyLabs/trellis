---
title: Manifest Workspace Resolution
status: done
depends_on:
  - cross-repo-manifest
tags:
  - cross-repo
  - manifest
  - canopy-integration
description: >-
  Extend project manifest with base_dir, repo metadata (name, description,
  tags), and local path resolution for desktop workspace tooling
type: feature
not_started_at: '2026-02-22T15:04:50.242Z'
started_at: '2026-02-22T15:07:30.473Z'
completed_at: '2026-02-22T15:17:20.304Z'
---

# Manifest Workspace Resolution

Extend the `.trellis-project` manifest to support local workspace resolution — mapping manifest repos to absolute disk paths with display metadata. This powers Canopy's project-driven repo management where opening a project auto-discovers all repos.

## Problem

The current manifest format (`cross-repo-manifest`) is git-native: repos are identified by URL and plan state is read from git objects. This works for cross-repo plan coordination but doesn't help desktop tools like Canopy answer "where are these repos on my disk?" or "what should I call this repo in the UI?"

Canopy currently requires users to manually add repos one by one, then associate them with a project. This is tedious and error-prone. The manifest already declares which repos belong to a project — it should also be the source of truth for local workspace setup.

## Approach
### Extended manifest format

Add optional fields to the existing format. Fully backward compatible — manifests without these fields continue to work unchanged.

**Project-level:**
- `base_dir` — base directory for resolving relative repo paths. Supports `~` expansion. Example: `~/repos`

**Per-repo (extending existing `RepoEntry`):**
- `name` — human-readable display name (e.g., "Admin Portal")
- `description` — one-line description
- `tags` — freeform string array for categorization/filtering (e.g., `[frontend, internal]`)
- `path` — already exists on `RepoEntry` as optional field; gains new semantics when `base_dir` is set (resolved relative to `base_dir` instead of manifest directory)

```yaml
name: twiglylabs
base_dir: ~/repos

repos:
  trellis:
    name: Trellis
    description: Plan tracking and dependency management
    tags: [tooling, cli]
    path: twiglylabs/tooling/trellis
    url: git@github.com:twiglylabs/trellis.git
    branch: main
    visibility: public

  canopy:
    name: Canopy
    description: Desktop workspace management app
    tags: [tooling, electron]
    path: twiglylabs/tooling/canopy
    url: git@github.com:twiglylabs/canopy.git
    branch: main
    visibility: public
```

### Type changes

Extend `RepoEntry` in `core/types.ts` (note: `path` already exists):

```typescript
export interface RepoEntry {
  url: string;
  branch: string;
  visibility: 'public' | 'private';
  path?: string;         // already exists — relative to base_dir or manifest dir
  name?: string;         // NEW: display name
  description?: string;  // NEW: one-liner
  tags?: string[];       // NEW: freeform tags
}

export interface ProjectManifest {
  name: string;
  base_dir?: string;     // NEW
  repos: Record<string, RepoEntry>;
}
```

New result type for resolved repos:

```typescript
export interface ResolvedRepo {
  alias: string;         // manifest key
  name: string;          // display name (falls back to alias)
  description: string;   // one-liner (falls back to empty)
  tags: string[];        // freeform (falls back to [])
  url: string;
  branch: string;
  visibility: 'public' | 'private';
  localPath: string;     // resolved absolute path
  exists: boolean;       // whether path exists on disk
}
```

### New export: `resolveProjectRepos()`

```typescript
export function resolveProjectRepos(manifestPath: string): ResolvedRepo[]
```

1. Read and parse the `.trellis-project` file at `manifestPath`
2. If `base_dir` is set, expand `~` to `os.homedir()`
3. For each repo: resolve `path` relative to expanded `base_dir`
4. If `base_dir` is not set, resolve `path` relative to the manifest file's directory (matches current `loadProjectRepos()` behavior in `mcp.ts`)
5. Check `fs.existsSync()` on each resolved path
6. Return `ResolvedRepo[]` with all metadata and existence flags

Also update `loadProjectRepos()` in `mcp.ts` to delegate to `resolveProjectRepos()` internally.

### Validation

Extend the existing manual validation in `parseManifest()` (the codebase uses descriptive error messages, not zod). Validate:
- `base_dir` is a string if present
- `name`, `description` are strings if present
- `tags` is a string array if present

### Backward compatibility

All new fields are optional. Manifests without `base_dir` behave exactly as before — paths resolve relative to the manifest directory (current behavior in `loadProjectRepos()`). Display metadata fields default to alias/empty/[].
## Non-goals

- Manifest editing UI — that's Canopy's concern
- `trellis clone` or repo checkout — future work
- Changing git-based remote plan reading — `cross-repo-manifest` handles that
