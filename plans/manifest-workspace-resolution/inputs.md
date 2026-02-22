
## From plans
- `trellis:cross-repo-manifest` — provides base manifest format (`ProjectManifest`, `RepoEntry`, `parseManifest()`) that this plan extends with workspace resolution fields

## From existing code
- `src/core/types.ts` — existing `RepoEntry` and `ProjectManifest` types
- `src/core/manifest.ts` — existing `parseManifest()` and `discoverManifest()` functions
- `src/mcp.ts` — existing `loadProjectRepos()` function (refactored to use `resolveProjectRepos`)
