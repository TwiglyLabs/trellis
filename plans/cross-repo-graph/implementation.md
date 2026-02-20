# Implementation

## Steps

1. **Add qualified ID parser** — `parseQualifiedId(ref: string): { repo?: string; planId: string }` in `utils.ts`. Splits on first `:`. No colon = local. Add lint rule: plan IDs must not contain colons. Add validation in `create` command.

2. **Update `checkVisibility()` in `manifest.ts`** — change from slash-based to colon-based parsing (`dep.indexOf(':')`) for cross-repo dep detection. Wire into lint: `computeLint()` calls `checkVisibility(manifest, allPlans)` when manifest is configured, adding results to lint output.

3. **Implement `mergeWithRemote()`** — new function in `context.ts`. Takes local plans and remote plans, returns unified plan array. For each remote plan: (a) set `plan.id` to `<repoAlias>:<originalId>`, (b) qualify intra-repo deps — unqualified `depends_on` entries in a remote plan get prefixed with `<repoAlias>:` since they reference plans within that remote repo, not local plans, (c) preserve already-qualified cross-repo deps as-is.

4. **Make `createContext()` async** — signature becomes `async function createContext(projectDir: string): Promise<TrellisContext>`. When `config.manifest` is set: check cache per-repo via `readCache(projectDir, 'plans/<alias>')` / `isCacheStale()`. If fresh, use cached plans. If stale or missing, `await fetchRepoPlans()`, write to cache. Call `mergeWithRemote()` to combine. No manifest = no awaits, resolves immediately.

5. **Make `refreshContext()` async** — same pattern as `createContext()`. Currently rebuilds context synchronously; needs the same manifest/cache/fetch logic.

6. **Update all call sites to `await`** — every command action handler and MCP tool handler that calls `createContext()` or `refreshContext()` adds `await`. Commander and MCP already support async handlers. **Test files too**: any test that calls `createContext()` directly must become async or await the result. This is mechanical but touches ~15-20 test files. Run `grep -r createContext tests/` to find all sites.

7. **Extend `buildGraph` for qualified IDs** — when resolving `depends_on` edges, use `parseQualifiedId` to determine if a dep is local or cross-repo. Qualified deps resolve against the full unified plan map. Unqualified deps resolve against local plans only. Unresolved cross-repo refs recorded for lint.

8. **Guard write operations** — in `update()`, `set()`, `create()`, `writeSection()`, `rename()`, `archive()`: check `plan.repoAlias != null` on the resolved plan. If remote, throw "Cannot modify remote plan '<qualified-id>'. Write operations are local only." The canonical remote check is `repoAlias`, not `:` in the ID string.

9. **Add `trellis fetch` command** — NEW command (not wiring an existing one). `fetchProjectPlans()` exists in `manifest.ts` but has no CLI surface. Command: reads manifest from config, calls `fetchRepoPlans()` for each repo, writes to cache, reports per-repo results. Errors if `--offline` is passed.

10. **Add `--offline` flag** — per-command flag on `ready`, `lint`, `show`, `status`, `graph`. When set, skip manifest fetch entirely. If cache exists, use it. If cache is empty, degrade to local-only silently (remote plans absent from graph, no error).

11. **Update `trellis ready` for cross-repo blocking** — cross-repo deps always checked via cache (or fetch if stale). A plan with `depends_on: [trellis:plan-schema]` is blocked until that remote plan is done. No `--project` flag in this plan — display is local plans only.

12. **Update `trellis lint` for cross-repo validation** — error if qualified ID references non-existent plan, error if qualified ID references non-existent repo alias, warning if cross-repo dep has no `outputs.md`. Call `checkVisibility()` when manifest configured.

13. **Update `trellis show` for qualified IDs** — `trellis show trellis:plan-schema` resolves qualified IDs against the unified plan map. Display cross-repo dependents and dependencies. Show blocking status from remote deps.

14. **Update `trellis status` for cross-repo blockers** — default output shows local plans only. When a local plan is blocked by a remote dep, the blocker appears as a qualified ID (e.g., "blocked by: trellis:plan-schema") in the status output.
## Testing

### Unit tests (no git, no network)

Construct `Plan` objects directly with `repoAlias` set and qualified `plan.id`:

- **Qualified ID parsing**: local refs (`auth`), qualified refs (`canopy:ui-lib`), edge cases (no colon, multiple colons like `canopy:sub/dir:plan`, empty segments)
- **Lint**: colons rejected in plan IDs at creation time
- **`mergeWithRemote()`**: local plans keep unqualified IDs, remote plans get qualified IDs, intra-repo deps within remote plans get qualified, already-qualified cross-repo deps preserved
- **Graph construction**: mixed local and cross-repo edges, unresolved cross-repo refs detected, qualified IDs as map keys
- **Ready**: plan blocked by unsatisfied cross-repo dep not shown as ready
- **Show**: qualified IDs resolve correctly, cross-repo context displayed
- **Status**: cross-repo blockers shown as qualified IDs in local plan output
- **Lint cross-repo**: validates cross-repo references, checkVisibility integration, warns on missing outputs.md
- **Write guard**: `update`, `set`, `create` reject plans with `repoAlias` set, clear error message
- **Backward compatibility**: everything works without `manifest` configured (no cross-repo resolution, sync fast path)
- **Cache integration**: `createContext` uses cached plans when fresh, fetches when stale
- **`--offline`**: uses cache when available, degrades to local-only when cache empty, `fetch --offline` errors

### Async migration coverage

Verify that the `createContext` → async migration doesn't break existing tests:
- All command-level tests that call `createContext()` must await it
- All MCP handler tests that call `createContext()` must await it
- Run full test suite to confirm no sync/async mismatches

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
- Remote-to-remote dep: canopy plan depends on another canopy plan, both resolved correctly in unified graph
- Cache works: second `createContext` call uses cache, doesn't re-fetch
- `trellis fetch` forces refresh
- `--offline` uses stale cache without fetching
- `--offline` with empty cache degrades to local-only
- Qualified ID in `trellis show`
## Done-when

- Qualified `repo:plan-id` syntax (colon separator) works in `depends_on`
- `checkVisibility()` uses colon separator (not slash), wired into lint
- `mergeWithRemote()` qualifies remote plan IDs and intra-repo deps correctly
- Remote plans get qualified IDs (`canopy:ui-lib`) in the merged graph; local plans keep unqualified IDs
- `createContext()` and `refreshContext()` are async; use cache with 5-min TTL; fetch only when stale
- Write operations reject remote plans (`repoAlias != null`) with clear error message
- Unified graph built from local + cached remote plans
- `trellis ready` checks cross-repo deps even in single-repo mode (via cache)
- `trellis fetch` command exists and forces cache refresh
- `--offline` skips fetch, uses cache or local-only (degrades silently when cache empty)
- Lint catches broken cross-repo references, colon-in-plan-id, and visibility violations
- `trellis show` and `trellis status` display qualified IDs for cross-repo blockers
- Unit tests cover all qualified ID, merge, graph, and guard logic
- E2E tests pass with `file://` git remotes (including remote-to-remote deps)
- All existing single-repo behavior unchanged (full test suite green)
- `--project` display flag deferred to follow-up plan `cross-repo-project-flag`
