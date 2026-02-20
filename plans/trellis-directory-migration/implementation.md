# Implementation

## Steps
1. **Update `loadConfig()` in `scanner.ts`** — use `statSync` to detect whether `.trellis` is a file or directory. If directory, read `.trellis/config`. If file, read directly (backward compat) and emit a stderr hint: `"Tip: run \`trellis init\` to upgrade to directory format."` This hint prints on every invocation where the file format is detected — there's no persistent state to suppress it.

2. **Update `trellis init`** — create `.trellis/` directory with `config` file and `.gitignore` (containing `cache/`). Use `statSync().isDirectory()` to distinguish existing state:
   - **`.trellis` is a directory** — already migrated. Run `setupMcpJson()` + `setupHooks()` idempotently, log "`.trellis/ already exists`", return.
   - **`.trellis` is a file** — offer to migrate: move content to `.trellis/config`, create `.gitignore`, preserve existing values. `--yes` auto-migrates without prompting.
   - **No `.trellis`** — fresh init, create directory format directly.

3. **Add cache utilities** — new file `src/core/cache.ts`:
   - `CacheEntry<T>` type: `{ data: T; fetchedAt: string }` — exported from `types.ts`
   - `ensureCacheDir(projectDir): string` — creates `.trellis/cache/` on demand, returns path
   - `readCache<T>(projectDir, key): CacheEntry<T> | null` — reads JSON from `.trellis/cache/<key>.json`, returns null if missing or corrupt. Caller unwraps `.data` for payload.
   - `writeCache<T>(projectDir, key, data: T): void` — wraps `data` in `CacheEntry` with `fetchedAt: new Date().toISOString()`, writes to `.trellis/cache/<key>.json`. Creates subdirectories as needed (e.g., `cache/plans/`).
   - `isCacheStale<T>(entry: CacheEntry<T>, maxAgeMs?: number): boolean` — compares `entry.fetchedAt` against `maxAgeMs` (default 300000ms = 5 min). Pure function, no filesystem access.
   - Cache keys map to filenames: `manifest` → `manifest.json`, `plans/canopy` → `plans/canopy.json`

4. **Update both hook scripts in `setup-hooks/logic.ts`**:
   - **`PROTECT_PLANS_HOOK`**: change `find_project_root()` to check `[ -f "$dir/.trellis" ] || [ -f "$dir/.trellis/config" ]`. Update `PLANS_DIR` extraction to detect format and read from the correct path (`.trellis` if file, `.trellis/config` if directory).
   - **Pre-commit hook**: same pattern — update `[ ! -f ".trellis" ]` to also check for `.trellis/config`, and update `grep` to read from the correct config path.

5. **Update `setup-hooks` command** — ensure the generated hook scripts use the updated detection from step 4. Running `trellis init` on an already-migrated project should reinstall hooks with the new logic.

6. **Update references and error messages**:
   - `CLAUDE.md`, `docs/architecture.md`, `docs/for-agents.md` — mention directory format alongside file format where `.trellis` is referenced.
   - `src/features/fetch/command.ts` and `src/features/fetch/logic.ts` — error messages say `Add "manifest: <git-url>" to .trellis`. Update to say `.trellis config` (works for both formats) or detect format and show the correct path.

## Testing

- **loadConfig backward compat**: `.trellis` as file still parses correctly (project, plans_dir, all optional fields)
- **loadConfig directory format**: `.trellis/config` parses identically to the file format
- **loadConfig missing**: no `.trellis` file or directory returns defaults (existing behavior)
- **loadConfig stderr hint**: file format emits upgrade hint to stderr
- **Init fresh project**: creates `.trellis/` directory with `config` and `.gitignore`
- **Init migration**: `.trellis` file → `.trellis/config` preserves all values, creates `.gitignore`
- **Init idempotent**: running init on an already-directory project doesn't corrupt it, logs "already exists"
- **Init distinguishes file from directory**: `statSync().isDirectory()` correctly routes to migration vs idempotent path
- **Cache CacheEntry round-trip**: `writeCache` + `readCache` produces `{ data, fetchedAt }`, data matches input
- **Cache isCacheStale**: fresh entry is not stale, old entry is stale, respects custom maxAgeMs
- **Cache readCache missing/corrupt**: returns null for missing files, returns null for invalid JSON
- **Cache ensureCacheDir**: creates nested directories, idempotent on repeated calls
- **Cache subdirectories**: `writeCache(dir, 'plans/canopy', data)` creates `cache/plans/canopy.json`
- **Hook protect-plans**: project root found with both file and directory formats
- **Hook pre-commit**: plans_dir extracted correctly from both file and directory formats
- **Directory-format integration**: at least one test creates `.trellis/` directory format and runs a command (e.g., `scanPlans` or `loadConfig`) through the full stack, not just unit-level

## Done-when

- `loadConfig()` reads from both `.trellis` (file) and `.trellis/config` (directory)
- File-format projects get a stderr hint suggesting `trellis init` upgrade
- `trellis init` creates directory format; migrates existing file format with `--yes`
- Init uses `statSync().isDirectory()` to distinguish file from directory (no ambiguity)
- `CacheEntry<T>` type exported from `types.ts`; `isCacheStale()` takes the entry directly
- Cache utilities (`readCache`, `writeCache`, `isCacheStale`, `ensureCacheDir`) are exported and tested
- Both hook scripts (protect-plans.sh and pre-commit) find project root with either format
- Fetch command error messages reference the correct config path
- All existing tests pass unchanged (backward compat)
- `.trellis/.gitignore` contains `cache/`
