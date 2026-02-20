# Implementation

## Steps

1. **Add qualified ID parser** — `parseQualifiedId(ref: string): { repo?: string; planId: string }` in `utils.ts`. Splits on first `:`. No colon = local. Add lint rule: plan IDs must not contain colons. Add validation in `create` command.

2. **Fix `checkVisibility()` in `manifest.ts`** — currently parses cross-repo deps with slash separator. Update to use colon separator (`dep.indexOf(':')`) to match the qualified ID format.

3. **Qualify remote plan IDs** — when merging remote plans into the unified plan set, set `plan.id` to `<repoAlias>:<originalId>` (e.g., `canopy:ui-lib`). Local plans keep their unqualified IDs. This ensures unique keys in `GraphData.plans`.

4. **Make `createContext()` async** — signature becomes `async function createContext(projectDir: string): Promise<TrellisContext>`. When `config.manifest` is set: check cache via `readCache()` / `isCacheStale()` from `cache.ts`. If fresh, merge cached remote plans with local. If stale or missing, `await discoverManifest()` + `await fetchProjectPlans()`, write to cache, then merge. No manifest = no awaits, resolves immediately.

5. **Update all `createContext` call sites** — add `await` in every command action handler and MCP tool handler. Commander and MCP already support async handlers. Mechanical change.

6. **Extend `buildGraph` for qualified IDs** — when resolving `depends_on` edges, use `parseQualifiedId` to determine if a dep is local or cross-repo. Cross-repo deps (with `:`) resolve against the full plan map. Unqualified deps resolve against local plans only. Unresolved cross-repo refs are recorded (lint reports them).

7. **Guard write operations** — in `update()`, `set()`, `create()`, `writeSection()`, `rename()`, `archive()`: if the plan ID contains `:`, throw "Cannot modify remote plan '<id>'. Write operations are local only."

8. **Implement `--project` flag** — add to `status`, `ready`, `graph`, `lint`, `show` commands. Controls display scope: `--project` shows all repos' plans, default shows current repo only. Resolution scope always includes cross-repo deps regardless of flag.

9. **Update `trellis ready`** — cross-repo blocking always checked (via cache or fetch). A plan with an unsatisfied qualified dep is blocked even without `--project`. `--offline` skips fetch, uses cache or local-only.

10. **Update `trellis lint`** — add cross-repo reference validation: error if qualified ID references non-existent plan, error if qualified ID references non-existent repo alias, warning if cross-repo dep has no `outputs.md`.

11. **Update `trellis show`** — accept qualified IDs (`trellis show trellis:plan-schema`). Display cross-repo dependents and dependencies.

12. **Update `trellis fetch`** — force-refresh cache (bypass TTL), report per-repo status. Already exists from cross-repo-manifest; wire it into the cache system.

## Testing

### Unit tests (no git, no network)

Construct `Plan` objects directly with `repoAlias` set and qualified `plan.id`:

- **Qualified ID parsing**: local refs (`auth`), qualified refs (`canopy:ui-lib`), edge cases (no colon, multiple colons like `canopy:sub/dir:plan`, empty segments)
- **Lint**: colons rejected in plan IDs at creation time
- **Graph construction**: mixed local and cross-repo edges, unresolved cross-repo refs detected, qualified IDs as map keys
- **Ready**: plan blocked by unsatisfied cross-repo dep not shown as ready, even without `--project`
- **Status `--project`**: groups by repo, shows cross-repo blockers
- **Ready `--project`**: lists ready plans across all repos
- **Lint `--project`**: validates cross-repo references across all repos
- **Show**: qualified IDs resolve correctly, cross-repo context displayed
- **Write guard**: `update`, `set`, `create` reject qualified IDs with clear error
- **Backward compatibility**: everything works without `manifest` configured (no cross-repo resolution, sync fast path)
- **Cache integration**: `createContext` uses cached plans when fresh, fetches when stale, works offline with `--offline`

### E2E tests (real git, no network)

Use `file://` git URLs as remotes — git doesn't care if the remote is GitHub or `/tmp`:

```
/tmp/trellis-e2e-xyz/
  bare/
    meta.git/              # bare repo — .trellis-project declares repos
    canopy.git/            # bare repo — simulates canopy remote
    trellis.git/           # bare repo — simulates trellis remote
  working/
    canopy/                # cloned from bare/canopy.git
      .trellis/config      # manifest = file:///tmp/.../bare/meta.git
      plans/ui-lib/README.md
    trellis/               # cloned from bare/trellis.git
      .trellis/config      # manifest = file:///tmp/.../bare/meta.git
      plans/plan-schema/README.md  # depends_on: [canopy:ui-lib]
```

Fixture helper: `createProjectFixture(spec)` creates bare repos, working repos, manifest, commits, and pushes. Returns working directory paths for running trellis commands.

E2E scenarios:
- Cross-repo dep satisfied: `canopy:ui-lib` is done → `plan-schema` shows as ready
- Cross-repo dep unsatisfied: `canopy:ui-lib` is in_progress → `plan-schema` is blocked
- Cache works: second `createContext` call uses cache, doesn't re-fetch
- `trellis fetch` forces refresh
- `--offline` uses stale cache without fetching
- Full `trellis ready --project` across repos
- Qualified ID in `trellis show`

## Done-when

- Qualified `repo:plan-id` syntax (colon separator) works in `depends_on`
- `checkVisibility()` uses colon separator (not slash)
- Remote plans get qualified IDs (`canopy:ui-lib`) in the merged graph; local plans keep unqualified IDs
- `createContext()` is async; uses cache with 5-min TTL; fetches only when stale
- Write operations reject qualified IDs with clear error message
- Unified graph built from local + cached remote plans
- `trellis ready` checks cross-repo deps even in single-repo mode (via cache)
- All commands support `--project` for full project view
- `--offline` skips fetch, uses cache or local-only
- Lint catches broken cross-repo references and colon-in-plan-id
- E2E tests pass with `file://` git remotes
- All existing single-repo behavior unchanged
