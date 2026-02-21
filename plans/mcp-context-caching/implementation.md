## Steps


## Testing
### Unit tests

- First read tool call triggers `store.load()`, second call uses `store.get()` (no rescan)
- `store.get()` returns in < 1ms after initial `load()` (timing assertion)
- Write tool (`trellis_write_section`) triggers `invalidate()` → subsequent read reflects the change
- Write tool calls `persist()` after mutation
- Server shutdown calls `watchHandle.close()` and `store.persist()`

### Watch integration tests

- External file change (not via MCP tool) detected by watch → next read returns updated data
- MCP write + immediate MCP read → read sees the write (synchronous invalidation, not waiting for watch)
- Echo suppression: MCP write triggers `invalidate()`, watch event arrives within debounce → single rescan total (spy on scanPlans call count)
- Rapid external changes (touch 5 files in 50ms) → debounced into single rescan batch
- Watch handles plan file deletion → plan removed from context

### Cross-boundary integration tests

Use `createTestFixture()` from context-store-core:

- MCP server persists index → CLI ContextStore `load()` reads it correctly
- CLI writes a plan file directly → MCP watch detects change → next MCP tool call reflects it
- MCP server starts with index from prior CLI invocation → uses cached data, skips full scan
- Both MCP and CLI modify plans concurrently → file lock prevents index corruption

### E2E scenario tests

- **Startup + read**: MCP server starts → `trellis_status` returns in < 10ms (after initial load)
- **Write + read consistency**: `trellis_write_section` modifies a plan → immediate `trellis_show` returns updated content
- **External edit**: User edits plan file in editor → MCP `trellis_status` reflects change within debounce window (~200ms)
- **Shutdown persistence**: MCP server shuts down → next CLI `trellis status` uses warm cache from MCP
- **Cold start with stale index**: MCP starts with index from yesterday → detects mtime changes → rescans stale repos only
## Done-when
- [ ] `getToolContext()` is removed — all tool handlers use `store.get()`
- [ ] Read-only tool calls complete in < 5ms after initial load (measured in test)
- [ ] Write tool calls reflect changes on immediate subsequent read (no stale data)
- [ ] Watch detects external file changes and updates context via `applyBatch()` + `patchGraph()`
- [ ] Echo suppression prevents double rescan after MCP writes
- [ ] Server persists index on shutdown — CLI benefits from warm cache
- [ ] Clean shutdown: no leaked file watchers, no orphan temp files
- [ ] Existing no-op `refresh: () => {}` callbacks removed from write handlers
- [ ] All cross-boundary integration tests pass (MCP ↔ CLI shared index)
