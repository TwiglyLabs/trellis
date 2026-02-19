# Outputs

## Types

- `RepoEntry` — `{ url: string, branch: string, visibility: 'public' | 'private' }`
- `ProjectManifest` — `{ name: string, repos: Record<string, RepoEntry> }`
- `Plan.repoAlias?: string` — optional field identifying which repo a plan came from (undefined for local plans)
- `TrellisConfig.manifest?: string` — optional git URL of the meta repo containing `.trellis-project`

## Functions (from `src/manifest.ts`)

- `parseManifest(content: string): ProjectManifest` — parses and validates `.trellis-project` YAML
- `discoverManifest(manifestUrl: string, cwd: string): ProjectManifest | null` — fetches meta repo, reads manifest, returns null on failure
- `fetchRepoPlans(alias: string, entry: RepoEntry, cwd: string): Plan[]` — reads plan frontmatter from a repo's git objects
- `fetchProjectPlans(manifest: ProjectManifest, cwd: string): Map<string, Plan[]>` — aggregates plans from all manifest repos
- `checkVisibility(manifest: ProjectManifest): ValidationError[]` — checks for public-to-private dependency violations
- `ensureRemote(name: string, url: string): void` — adds/updates a `trellis/`-prefixed git remote
- `fetchRemote(name: string): { ok: boolean; error?: string }` — fetches a remote with error handling

## API (on `Trellis` class)

- `projectPlans(): Map<string, Plan[]> | null` — returns aggregated remote plans, or null if no manifest configured

## CLI

- `trellis fetch` — fetches all project remotes, reports per-repo status and plan counts. Supports `--json`.

## Config

- `manifest` field in `.trellis` — git URL pointing to meta repo. Optional; absence means single-repo mode.

## Conventions

- Git remotes: `trellis/<alias>` for sibling repos, `trellis/__manifest` for the meta repo
- Remote plan `filePath`: synthetic git object reference (`trellis/<alias>/<branch>:plans/<id>/README.md`)
- Remote plans are frontmatter + body only — no inputs/outputs/implementation.md data
