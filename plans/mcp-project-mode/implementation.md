## Steps
1. **Extend `buildStore()` in `mcp.ts`** — Add project-mode auto-detection path between the existing `repos` check and single-repo fallback. Load config, check for manifest + `.trellis-project`, call `resolveProjectRepos()`, filter to existing repos, create multi-repo ContextStore.

2. **Extend `createContext()` in `core/context.ts`** — Add the same auto-detection logic for CLI commands. When project mode is detected, scan plans from all resolved repo directories and build a unified graph with qualified IDs. Return a context that looks like single-repo to callers but contains all project plans.

3. **Update `loadProjectRepos()` in `mcp.ts`** — Refactor to use `resolveProjectRepos()` internally (from manifest-workspace-resolution plan). This keeps `--project` flag working and avoids duplicated resolution logic.

4. **Cross-repo dep validation in lint** — In project mode, `computeLint` should validate qualified ID references against the full project graph. In single-repo mode, qualified IDs remain warnings (can't resolve without project context).

5. **Warning for partially resolved projects** — When some repos in the manifest don't exist on disk, log a warning listing the missing repos but continue with the available ones.

6. **Integration tests** — Set up a fake project with 2-3 repo directories on disk, a `.trellis-project` manifest, plans with cross-repo deps. Verify:
   - Auto-detection enters project mode
   - `trellis_status` aggregates across repos
   - `trellis_ready` considers cross-repo deps
   - `trellis_graph` shows cross-repo edges
   - `trellis_lint` validates cross-repo dep references
   - `trellis_create` with qualified ID writes to correct repo
   - Missing repos produce warnings, not failures
## Testing
- Unit test: `buildStore()` auto-detects project mode from config + `.trellis-project`
- Unit test: `buildStore()` falls back to single-repo when no manifest configured
- Unit test: `buildStore()` errors when manifest exists but no `.trellis-project`
- Unit test: `createContext()` returns unified graph in project mode
- Unit test: `createContext()` qualifies plan IDs with repo alias
- Unit test: Partially resolved project (some repos missing) produces warnings + continues
- Integration test: Full project setup → status/ready/graph aggregate correctly
- Integration test: Cross-repo `depends_on` resolves in project mode
- Integration test: `trellis_create` with qualified ID writes to correct repo
- Integration test: `trellis_lint` validates cross-repo references
## Done-when
- MCP auto-enters project mode when config has `manifest` and `.trellis-project` exists
- CLI commands auto-enter project mode under the same conditions
- `trellis status`, `trellis ready`, `trellis graph` aggregate across all resolved repos
- Cross-repo dependencies (`depends_on: ["alias:plan-id"]`) resolve against the full project graph
- `trellis create` with qualified ID (`alias:plan-id`) writes to the correct repo directory
- `trellis lint` validates cross-repo dependency references in project mode
- Missing repos produce warnings, not failures
- Error with clear message when manifest exists but `.trellis-project` doesn't
- `--project` and `--repos` flags continue to work as overrides
- All existing single-repo behavior unchanged when no manifest is configured
- All unit and integration tests pass
- `npm run check` clean
