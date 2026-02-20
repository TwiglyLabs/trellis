# Implementation

## Steps

1. **Update `loadConfig()` in `scanner.ts`** — detect whether `.trellis` is a file or directory. If directory, read `.trellis/config`. If file, read directly (backward compat). Emit a one-time stderr hint on file format: "Upgrade to directory format with `trellis init`."

2. **Update `trellis init`** — create `.trellis/` directory with `config` file and `.gitignore` (containing `cache/`). When `.trellis` already exists as a file, offer to migrate: move content to `.trellis/config`, add `.gitignore`, preserve existing values. `--yes` auto-migrates.

3. **Add cache utilities** — new file `src/core/cache.ts`:
   - `ensureCacheDir(projectDir): string` — creates `.trellis/cache/` on demand, returns path
   - `readCache<T>(projectDir, key): { data: T; fetchedAt: string } | null` — reads JSON from `.trellis/cache/<key>.json`, returns null if missing or corrupt
   - `writeCache(projectDir, key, data): void` — writes JSON to `.trellis/cache/<key>.json` with `fetchedAt` timestamp
   - `isCacheStale(projectDir, key, maxAgeMs): boolean` — checks fetchedAt against maxAge (default 300000ms = 5 min)
   - Cache keys map to filenames: `manifest` → `manifest.json`, `plans/canopy` → `plans/canopy.json`

4. **Update `protect-plans.sh` hook** — change `find_project_root()` to check both `[ -f "$dir/.trellis" ]` and `[ -f "$dir/.trellis/config" ]`. Update `PLANS_DIR` parsing to read from the correct config path.

5. **Update `setup-hooks` command** — ensure the generated hook script uses the updated project root detection.

6. **Update references** — `CLAUDE.md`, `docs/architecture.md`, `docs/for-agents.md` — mention directory format alongside file format where `.trellis` is referenced.

## Testing

- **loadConfig backward compat**: `.trellis` as file still parses correctly (project, plans_dir, all optional fields)
- **loadConfig directory format**: `.trellis/config` parses identically to the file format
- **loadConfig missing**: no `.trellis` file or directory returns defaults (existing behavior)
- **Init fresh project**: creates `.trellis/` directory with `config` and `.gitignore`
- **Init migration**: `.trellis` file → `.trellis/config` preserves all values, creates `.gitignore`
- **Init idempotent**: running init on an already-directory project doesn't corrupt it
- **Cache utilities**: `writeCache` + `readCache` round-trip, `isCacheStale` respects TTL, `readCache` returns null for missing/corrupt files
- **ensureCacheDir**: creates nested directories, idempotent on repeated calls
- **Hook**: project root found with both file and directory formats

## Done-when

- `loadConfig()` reads from both `.trellis` (file) and `.trellis/config` (directory)
- `trellis init` creates directory format; migrates existing file format with `--yes`
- Cache utilities (`readCache`, `writeCache`, `isCacheStale`, `ensureCacheDir`) are exported and tested
- `protect-plans.sh` hook finds project root with either format
- All existing tests pass unchanged (backward compat)
- `.trellis/.gitignore` contains `cache/`
