
## Exports

### `.trellis/` directory layout

```
.trellis/
  config          # key=value config (tracked in git)
  .gitignore      # ignores cache/
  cache/          # local, ephemeral, gitignored
```

### Backward-compatible `loadConfig()`

Detects file-vs-directory for `.trellis`. File format works unchanged with a stderr hint to upgrade. Directory format reads `.trellis/config`.

### `trellis init` migration

Creates `.trellis/` directory with `config` and `.gitignore`. Migrates existing flat `.trellis` file when present. `--yes` for non-interactive migration.

### Cache utilities — `src/core/cache.ts`

- `CacheEntry<T>` type: `{ data: T, fetchedAt: string }`
- `ensureCacheDir(projectDir): string`
- `readCache<T>(projectDir, key): CacheEntry<T> | null`
- `writeCache<T>(projectDir, key, data): void`
- `isCacheStale(entry, maxAgeMs?): boolean` (default 5min TTL)

### Updated hooks

Both protect-plans hook and pre-commit hook detect file-or-directory `.trellis` format.
