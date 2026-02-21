## Steps


## Testing
### Unit tests

**Parallel execution:**
- Mock git executor: 3 repos each taking 100ms → total time < 200ms (parallelism verified)
- Concurrency limit respected: 10 repos with limit 3 → max 3 concurrent at any point (track via semaphore counter)

**Partial failure:**
- 2/3 repos succeed, 1 fails (mock network error) → success results for 2, failure with error message for 1
- All repos fail → exit code 1, summary still printed
- Single repo succeeds → exit code 0

**Flags:**
- `--repo canopy` → only canopy fetched, others skipped
- `--repo nonexistent` → clear error message
- `--json` → output is valid JSON, parseable, contains per-repo results

**Manifest resolution:**
- Local `.trellis-project` file present → reads from it, no git fetch
- No local file, manifest URL configured → fetches via git
- Manifest fetch fails → clear error, exit code 1

### Cache format compatibility tests

- Synced plans written via `writeCache()` → `resolveRemotePlans()` reads them correctly (existing code path)
- Cache timestamp updated after sync → `isCacheStale()` returns false immediately after
- Sync overwrites stale cache → new data replaces old
- Sync of single repo (`--repo`) doesn't affect other repos' cache files

### Integration tests

Use `createTestFixture()` from context-store-core (or standalone fixture if sync ships first):

- `trellis sync` → `trellis status --offline` shows remote plans from cache
- `trellis sync --repo canopy` → only canopy cache updated, other repos' cache unchanged
- `trellis sync` with empty manifest (no repos) → clean exit with "nothing to sync" message
- `trellis sync` then `trellis sync` again immediately → second sync still works (no stale lock files)

### Performance

- 5 repos with mock git executor (50ms each): total < 150ms (verifies parallelism)
- Verify wall-clock time scales with concurrency limit, not repo count
## Done-when
- [ ] `trellis sync` fetches all remote repos in parallel with configurable concurrency
- [ ] Wall-clock time for 16 repos drops from ~32s (sequential) to ~3-5s (parallel)
- [ ] Partial failures reported per-repo with clear error messages, don't abort other fetches
- [ ] Exit code 0 on any success, 1 on all-fail
- [ ] Cache files written in format compatible with existing `resolveRemotePlans()` reader
- [ ] `trellis status` picks up synced data immediately — no code changes needed in status
- [ ] `--repo` flag works to sync a single repo
- [ ] `--json` flag produces structured, parseable output
- [ ] No ContextStore dependency — sync writes directly to existing cache format
