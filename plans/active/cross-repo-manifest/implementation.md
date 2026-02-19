# Implementation

## Steps

1. Define manifest types — `ProjectManifest` with `name: string` and `repos: Map<string, RepoEntry>`. `RepoEntry` with `url: string`, `branch: string`, `visibility: 'public' | 'private'`. Add to `types.ts`.

2. Add manifest parser — `parseManifest(content: string): ProjectManifest`. YAML format, validates required fields. Rejects duplicate aliases.

3. Add `project` field to `.trellis` config — extend `loadConfig()` to parse `project = <git-url>` from the `.trellis` file. Optional field — trellis works without it (single-repo mode, backward compatible).

4. Implement manifest discovery — `discoverManifest(projectUrl: string): ProjectManifest`. Uses `git` commands to fetch the meta repo and read `.trellis-project` from its main branch. Caches the result.

5. Implement git-based plan reader — `fetchRepoPlans(repoEntry: RepoEntry): Plan[]`. Fetches the repo's remote, lists plan directories via `git ls-tree`, reads README.md frontmatter via `git show`. Reuses `parseFrontmatter()` for parsing. Plans read this way are marked with their repo alias.

6. Implement project-level plan aggregation — `fetchProjectPlans(manifest: ProjectManifest): Map<string, Plan[]>`. Calls `fetchRepoPlans` for each repo in the manifest. Returns plans keyed by repo alias. Handles fetch failures gracefully (warns, continues with available repos).

7. Add `trellis fetch` command — explicitly fetches all project remotes and reports status. Shows which repos were fetched, which failed, and how many plans were found in each.

8. Integrate into `Trellis` class — add `projectPlans()` method that returns the aggregated plan map. Lazy-loaded and cached like existing `plans` and `graphData`. Add `--fetch` and `--offline` flags to relevant commands.

## Testing

- Manifest parsing: valid manifest, missing required fields, duplicate aliases, empty repos list, visibility field required and validated
- Visibility enforcement: `checkDependencyVisibility(fromRepo, toRepo, manifest)` rejects public → private edges
- Config: `project` field parsed correctly, optional (missing = single-repo mode)
- Discovery: follows `project` pointer, fetches meta repo, reads manifest
- Git reader: reads plan frontmatter from git objects, handles missing plans dir, handles fetch failures
- Aggregation: combines plans from multiple repos, keyed by alias, skips failed fetches
- `trellis fetch`: reports per-repo status, handles partial failures
- Cache: second query uses cached data, `--fetch` forces refresh, `--offline` skips network
- Backward compatibility: all existing behavior unchanged when `project` is not set

## Done-when

- `loadConfig()` parses the `project` field from `.trellis`
- `parseManifest()` reads `.trellis-project` format with visibility per repo
- Visibility rule enforced: public repos cannot depend on private repos
- Trellis can fetch and read plan frontmatter from all repos listed in a project manifest
- `trellis fetch` shows project-wide repo status
- All operations work in single-repo mode when `project` is not configured
- Fetch failures for individual repos don't crash — warn and continue
