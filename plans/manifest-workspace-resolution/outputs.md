
## Exports
- `ResolvedRepo` type — resolved repo with alias, display metadata (name, description, tags), localPath, exists flag, and visibility
- `resolveProjectRepos(manifestPath: string): ResolvedRepo[]` — reads manifest, expands base_dir, resolves paths, checks existence
- Extended `ProjectManifest` type with optional `base_dir` field
- Extended `RepoEntry` type with optional `name`, `description`, `tags` fields

## Consumers
- `canopy:project-driven-repos` — uses `resolveProjectRepos()` in project service to auto-discover repos from manifest
