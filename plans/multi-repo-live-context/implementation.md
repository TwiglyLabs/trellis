
## Steps
1. **Define `RepoSpec` and `MultiContext` types in `src/core/types.ts`.**
   ```ts
   interface RepoSpec {
     path: string;
     alias: string;
   }
   interface MultiRepoEntry {
     alias: string;
     path: string;
     planCount: number;
     configFound: boolean;
   }
   interface MultiContext extends TrellisContext {
     repos: MultiRepoEntry[];
   }
   ```

2. **Implement `createMultiContext()` in `src/core/context.ts`.**
   Accept `repos: RepoSpec[]`. Validate alias uniqueness (throw if duplicates). For each repo: attempt `loadConfig()` from the repo path. If config not found, record `configFound: false, planCount: 0` and skip. Otherwise call `scanPlans()` on its `plans_dir`. Qualify plan IDs with alias using the same convention as `mergeWithRemote()` — prefix bare IDs with `alias:`, leave already-qualified deps as-is. Merge all plans into a single array, call `buildGraph()`, return `MultiContext`.

3. **Reuse `mergeWithRemote()` or extract shared qualification logic.**
   The ID qualification logic in `mergeWithRemote()` (line 28-65 of context.ts) already handles alias prefixing and dep rewriting. Either reuse it directly by treating each non-local repo's plans as "remote" plans, or extract the qualification logic into a shared helper. Prefer reuse — `mergeWithRemote()` already does exactly what's needed.

4. **Handle errors gracefully per repo.**
   Wrap each repo's scan in a try/catch. If a repo's config is unreadable or plans_dir doesn't exist, record the error in `MultiRepoEntry` (add optional `error?: string` field) and continue with remaining repos. Never throw for a single repo failure.

5. **Export from library entry point (`src/index.ts`).**
   Export `createMultiContext`, `MultiContext`, `RepoSpec`, `MultiRepoEntry`.

6. **Write tests.**
   Create fixtures with 2-3 temp directories, each with `.trellis/config` and plans. Test: merged plan count, qualified IDs, cross-repo dependency resolution, missing config handling, duplicate alias rejection, empty repo handling.

## Testing
- **Basic multi-repo test:** Create 2 fixture repos with 2 plans each. Call `createMultiContext()`. Verify 4 plans returned with qualified IDs (`repo-a:plan-1`, `repo-a:plan-2`, `repo-b:plan-3`, `repo-b:plan-4`). Verify `repos` array has 2 entries with correct `planCount`.
- **Cross-repo dependencies:** Repo A plan depends on `repo-b:plan-3`. Verify the edge appears in the returned graph. Verify ready/blocked status is correct.
- **Intra-repo dep qualification:** Repo B plan depends on `other-plan` (bare ID within same repo). Verify it becomes `repo-b:other-plan` in the merged graph.
- **Missing config:** Include a repo spec pointing to a directory without `.trellis/config`. Verify it appears in `repos` with `configFound: false, planCount: 0` and other repos still load.
- **Duplicate alias:** Pass two repos with the same alias. Verify it throws a descriptive error.
- **Empty repo:** Repo with valid config but no plans. Verify `planCount: 0` in metadata, no effect on graph.
- **Single repo:** Call with one repo. Verify it works identically to `createContext()` but with qualified IDs.
- **Graph correctness:** Verify `buildGraph()` output has correct nodes, edges, and ready set across merged repos.

## Done-when
- `createMultiContext(repos)` scans multiple local repo directories and returns a unified `MultiContext` with qualified plan IDs and a merged graph.
- Cross-repo and intra-repo dependencies resolve correctly in the merged graph.
- Missing/broken repos are skipped gracefully with metadata recorded.
- Duplicate aliases are rejected with a clear error.
- Library exports `createMultiContext`, `MultiContext`, `RepoSpec` for Canopy consumption.
- All tests pass including cross-repo dependency resolution edge cases.
