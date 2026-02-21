## Steps


## Testing
### Unit tests

- `statusCommand()` uses cached index when mtimes match — verify `scanPlans()` not called
- `statusCommand()` rescans stale repo and calls `persist()` with updated index
- All read commands (`ready`, `show`, `graph`, `lint`, `bottlenecks`) work with ContextStore
- Cold start (no existing index) → full scan + persist, identical output to current behavior
- `--no-cache` flag forces full rescan even with valid cache
- Remote cache age indicator shows correct relative time ("2h ago") or "not synced"

### Integration tests (shared index)

- CLI reads an index file previously written by MCP's ContextStore → produces correct context
- CLI writes an index → MCP ContextStore `load()` reads it back correctly (round-trip)
- Two concurrent CLI invocations on same index → both succeed, no corruption (file lock)
- CLI reads index while it's being written (simulated race) → atomic write prevents partial read
- Corrupted index file → CLI recovers with full rescan, persists clean replacement

### E2E scenario tests

Use `createTestFixture()` from context-store-core:

- **Warm cache path**: Create fixture, run status (cold), run status again (warm) → second run measurably faster, output identical
- **Stale detection**: Create fixture, run status (populates cache), modify a plan file, run status → only modified repo rescanned, output reflects change
- **Sync integration**: Run `trellis sync` (writes remote cache), then `trellis status` → shows remote plans with age indicator
- **Index deletion**: Run status (populates cache), delete index file, run status → rebuilds gracefully, no error
## Done-when
- [ ] All read-only CLI commands (`status`, `ready`, `show`, `graph`, `lint`, `bottlenecks`) use ContextStore
- [ ] Warm cache CLI invocation completes in < 30ms (vs ~160ms uncached) — measured in benchmark test
- [ ] `--no-cache` flag works correctly on all commands
- [ ] Remote plans show cache age ("cached 2h ago") or "not synced" when absent
- [ ] Shared index readable by both CLI and MCP server (cross-boundary integration test passes)
- [ ] Concurrent CLI access is safe (file locking + atomic writes verified under test)
- [ ] Cold start (no index) produces identical output to current `createContext()` behavior
- [ ] No user-visible errors from caching — degradation is silent fallback to full scan
