---
parent: manifest-workspace-resolution
---

# Implementation

## Steps
1. **Extend types** — Add `base_dir` to `ProjectManifest`, add `name`, `description`, `tags` to `RepoEntry`, add `ResolvedRepo` type in `core/types.ts`

2. **Update manifest parser** — Extend `parseManifest()` in `core/manifest.ts` to validate the new fields using the existing manual validation pattern (no zod — match codebase conventions).

3. **Implement `resolveProjectRepos()`** — New function in `core/manifest.ts` that reads a manifest file, expands `base_dir` (`~` → `os.homedir()`), resolves each repo path, checks existence, and returns `ResolvedRepo[]`

4. **Update `loadProjectRepos()`** — In `mcp.ts` (where it currently lives, lines 71-99), refactor to delegate to `resolveProjectRepos()` internally, maintaining the same return type (`RepoSpec[]`) and behavior.

5. **Export from index** — Add `resolveProjectRepos` and `ResolvedRepo` to `src/core/index.ts` and `src/index.ts` exports
## Testing

- Unit test: `resolveProjectRepos()` with `base_dir` + relative paths resolves correctly
- Unit test: `resolveProjectRepos()` without `base_dir` falls back to manifest-relative resolution
- Unit test: `~` expansion in `base_dir`
- Unit test: Missing paths correctly set `exists: false`
- Unit test: Metadata defaults (alias as name, empty description, empty tags)
- Unit test: Full manifest with all new fields parses correctly
- Unit test: Backward compatibility — old manifest format still works

## Done-when

- `ResolvedRepo` type exported from trellis
- `resolveProjectRepos()` exported and functional
- Existing `loadProjectRepos()` unchanged in behavior for manifests without new fields
- All unit tests pass
- `npm run check` clean
