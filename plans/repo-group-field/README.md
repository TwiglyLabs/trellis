---
title: Add optional group field to RepoEntry manifest schema
status: in_progress
tags:
  - 'epic:canopy-grouping'
type: feature
not_started_at: '2026-02-28T17:57:57.140Z'
started_at: '2026-02-28T18:08:53.783Z'
---

## Problem
Canopy needs to group repos by domain (product, tooling, infra) in the Repos tab. The grouping information belongs in the `.trellis-project` manifest since it's a project-level organizational concern, but `RepoEntry` and `ResolvedRepo` have no `group` field today.

This blocks `canopy:grouping` chunks 1, 4, and 5.
## Approach
Add an optional `group?: string` field to `RepoEntry` and `ResolvedRepo`. Follow the exact pattern used by existing optional metadata fields (`name`, `description`, `tags`):

1. Add to the type definitions
2. Add validation in the manifest parser (string type check)
3. Pass through in the metadata spread during parsing
4. Map through during repo resolution
5. Add tests
6. Publish

The field is optional and additive — fully backwards-compatible. Manifests without `group` continue to work. Consumers that don't read `group` are unaffected.

## Acceptance Criteria
- [ ] `RepoEntry` in `src/core/types.ts` has `group?: string`
- [ ] `ResolvedRepo` in `src/core/types.ts` has `group?: string`
- [ ] `parseManifest()` validates `group` as optional string, rejects non-string values
- [ ] `resolveProjectRepos()` and `resolveProjectReposAsync()` pass `group` through to `ResolvedRepo`
- [ ] Unit tests cover: group present, group absent, group with invalid type
- [ ] All existing tests pass (no regressions)
- [ ] Published to local registry so canopy can consume it
