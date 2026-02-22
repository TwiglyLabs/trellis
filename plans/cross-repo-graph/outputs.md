
## Exports

### Qualified plan ID format

`<repo-alias>:<plan-id>` convention for cross-repo dependencies in `depends_on` frontmatter. Unqualified IDs resolve within the current repo. Colons are the separator (not slash, since plan IDs contain slashes).

### `parseQualifiedId(ref)` — `src/core/utils.ts`

Splits on first `:` to extract `{ repo?: string; planId: string }`.

### `mergeWithRemote(localPlans, remotePlans, localAlias?)` — `src/core/context.ts`

Qualifies remote plan IDs with repo alias, resolves intra-repo deps within remote namespaces, strips local alias from remote-to-local deps.

### `createContext()` — async with cross-repo resolution

Fetches remote plans via git, caches in `.trellis/cache/plans/<alias>.json`, merges into unified graph. `--offline` skips fetch, uses cache or local-only.

### Cross-repo-aware commands

- `trellis ready` checks cross-repo deps via cache — blocked plans don't show as ready
- `trellis lint` validates cross-repo refs resolve, checks `outputs.md` presence, enforces public/private visibility rules via `checkVisibility()`
- `trellis show <repo:plan-id>` resolves qualified IDs
- `trellis fetch` — new command for explicit cache refresh

### `CacheEntry<T>` utilities — `src/core/cache.ts`

`readCache()`, `writeCache()`, `isCacheStale()` with 5-minute default TTL. Cache files stored in `.trellis/cache/`.

### Write guard for remote plans

All write operations check `plan.repoAlias != null` and reject with error: "Cannot modify remote plan 'repo:plan-id'."
