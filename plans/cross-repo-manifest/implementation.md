# Implementation

## Steps

1. **Define manifest types** — Add to `types.ts`: `RepoEntry` with `url: string`, `branch: string`, `visibility: 'public' | 'private'`. `ProjectManifest` with `name: string` and `repos: Record<string, RepoEntry>`. Add optional `repoAlias?: string` to the `Plan` interface. Add optional `manifest?: string` to `TrellisConfig`.

2. **Add manifest parser** — New file `src/manifest.ts`. `parseManifest(content: string): ProjectManifest` uses `js-yaml` (add as direct dependency — already transitive via gray-matter) to parse `.trellis-project` YAML. Validates: `name` is string, `repos` is non-empty object, each repo has `url` + `branch` + `visibility`, visibility is `'public' | 'private'`, no duplicate aliases (object keys enforce this, but validate no empty keys).

3. **Parse `manifest` field from `.trellis`** — Extend `loadConfig()` in `scanner.ts` to parse `manifest = <git-url>` from the config. Optional field — missing means single-repo mode. The existing `project` field (display name) is unchanged.

4. **Implement git operations** — In `src/manifest.ts`, three functions that shell out to `git`:
   - `ensureRemote(name: string, url: string): void` — adds or updates a git remote with the `trellis/` prefix convention. Uses `git remote add` or `git remote set-url` if already exists.
   - `fetchRemote(name: string): { ok: boolean; error?: string }` — runs `git fetch <name>` with a timeout. Returns success/failure, doesn't throw.
   - `gitShow(ref: string): string | null` — runs `git show <ref>`, returns content or null on failure.
   - `gitListTree(ref: string): string[]` — runs `git ls-tree -d --name-only <ref>`, returns directory names.

5. **Implement manifest discovery** — `discoverManifest(manifestUrl: string, cwd: string): ProjectManifest | null`. Adds `trellis/__manifest` remote pointing to the manifest URL, fetches it, reads `.trellis-project` via `git show trellis/__manifest/main:.trellis-project`, parses with `parseManifest()`. Returns null if fetch fails or file not found (graceful degradation to single-repo mode).

6. **Implement git-based plan reader** — `fetchRepoPlans(alias: string, entry: RepoEntry, cwd: string): Plan[]`. Ensures `trellis/<alias>` remote exists and is fetched. Lists plan directories via `gitListTree('trellis/<alias>/<branch>:plans')`. For each directory, reads `README.md` via `gitShow`, parses frontmatter with existing `parseFrontmatter()`. Constructs `Plan` objects with `repoAlias` set and synthetic `filePath` (`trellis/<alias>/<branch>:plans/<id>/README.md`). `lineCount` from README.md content length. `inputs`/`outputs` left undefined.

7. **Implement project-level aggregation** — `fetchProjectPlans(manifest: ProjectManifest, cwd: string): Map<string, Plan[]>`. Calls `fetchRepoPlans` for each repo in the manifest (skipping the current repo — it's already local). Returns plans keyed by repo alias. Fetch failures per-repo: warn to stderr and continue with available repos. Never throws.

8. **Add `trellis fetch` command** — New command in `src/commands/fetch.ts`, registered in `cli.ts`. Reads `manifest` from config; if absent, prints "No manifest configured" and exits. Discovers manifest, then fetches each repo and reports: repo alias, fetch status (ok/failed), plan count. Supports `--json` flag for structured output.

9. **Add visibility check to lint** — In the `lint()` method, when a manifest is available: resolve each plan's repo alias, check `depends_on` entries that reference plans in other repos (qualified IDs — but those are cross-repo-graph's concern; for now, this is a `checkVisibility(manifest): ValidationError[]` function that can be called when qualified IDs exist). Add the infrastructure now; the actual lint rule activates once cross-repo-graph introduces qualified IDs.

10. **Integrate into Trellis class** — Add `projectPlans(): Map<string, Plan[]> | null` method. Returns null when `manifest` is not configured. Fetches on every call (no cache). Wire into the API surface so downstream code (cross-repo-graph) can call it.

## Testing

All git operations are tested by injecting a `git` executor function, avoiding real network calls.

- **Manifest parsing** (`manifest.test.ts`): valid manifest, missing `name`, missing `repos`, empty repos, missing `url`/`branch`/`visibility` on repo entry, invalid visibility value, well-formed YAML with all fields
- **Config** (`scanner.test.ts`): `manifest` field parsed correctly, optional (missing = single-repo mode), existing `project` (display name) unaffected
- **Git operations** (`manifest.test.ts`): `ensureRemote` adds/updates remotes, `fetchRemote` handles success/failure/timeout, `gitShow` returns content or null, `gitListTree` returns directory names
- **Manifest discovery** (`manifest.test.ts`): follows manifest pointer, handles fetch failure gracefully (returns null), handles missing `.trellis-project` in meta repo
- **Plan reader** (`manifest.test.ts`): reads frontmatter from git objects, sets `repoAlias` on plans, uses synthetic filePath, handles missing plans dir, handles individual plan parse failures, `lineCount` from README content
- **Aggregation** (`manifest.test.ts`): combines plans from multiple repos keyed by alias, skips current repo, skips failed fetches with warning, returns empty map on total failure
- **Visibility** (`manifest.test.ts`): `checkVisibility` rejects public-to-private edges, allows private-to-public, allows same-visibility
- **`trellis fetch` command** (`fetch.test.ts`): reports per-repo status, handles partial failures, `--json` output, no-manifest message
- **Backward compatibility**: all existing tests pass without changes — `manifest` is optional, `repoAlias` is optional, no behavior change for single-repo

## Done-when

- `loadConfig()` parses the optional `manifest` field from `.trellis` (distinct from `project` display name)
- `parseManifest()` reads `.trellis-project` YAML format using `js-yaml`, validates structure and visibility
- `Plan` interface has optional `repoAlias` field; remote plans have it set, local plans don't
- Remote plan objects use synthetic `filePath`, have `lineCount` from README only, no inputs/outputs
- Git remotes use `trellis/<alias>` naming convention to avoid collisions
- Trellis can fetch and read plan frontmatter from all repos listed in a project manifest
- `trellis fetch` shows project-wide repo status with `--json` support
- Visibility check infrastructure in place for lint (activates with qualified IDs from cross-repo-graph)
- All operations work in single-repo mode when `manifest` is not configured
- Fetch failures for individual repos don't crash — warn to stderr and continue
