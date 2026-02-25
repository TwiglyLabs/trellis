## Steps

### 1. Create `src/core/format.ts`

New file with exports:
- `formatStatus(status: StatusResult, ready: ReadyResult, tag?: string): string`
- `formatShow(result: ShowResult): string`
- `formatGraph(result: GraphResult): string`
- `formatLint(result: LintResult): string`
- `formatBottlenecks(result: BottleneckResult): string`

Internal helpers (not exported):
- `planLine(summary: PlanSummary): string` — formats `- {id}: {title} [{assignee}]`
- `blockedLine(summary: BlockedPlanSummary): string` — adds `(waiting on: ...)`
- `section(heading: string, lines: string[]): string` — returns empty string if lines empty

Import types from their feature modules (`src/features/*/logic.ts`).

### 2. Update `src/mcp.ts`

**trellis_status handler (lines ~536-563):**
- Add `computeReady()` call alongside existing `computeStatus()` — both use the same `graph` and `plans` from context
- Replace `JSON.stringify(result)` with `formatStatus(statusResult, readyResult, args.tag)`
- Update tool description to mention Next recommendation

**trellis_ready (lines ~566-587):**
- Remove entire tool registration block (listTools entry + callTool handler)

**trellis_show handler (lines ~590-616):**
- Replace `JSON.stringify(result)` with `formatShow(result)`

**trellis_graph handler (lines ~619-643):**
- Replace `JSON.stringify(result)` with `formatGraph(result)`

**trellis_lint handler (lines ~646-691):**
- Replace `JSON.stringify(result)` with `formatLint(result)`

**trellis_bottlenecks handler (lines ~694-718):**
- Replace `JSON.stringify(result)` with `formatBottlenecks(result)`

### 3. Update tests

**`src/__tests__/format.test.ts` (new file):**
- Unit tests for each formatter with controlled input data
- Edge cases: empty arrays, null next, no blocked plans, all done, tag filter

**`src/__tests__/mcp.test.ts` (existing):**
- Replace `JSON.parse(result.content[0].text)` with text assertions
- Remove `trellis_ready` test cases
- Add test that `trellis_ready` tool is not registered

**`src/__tests__/json-contracts.test.ts` (existing):**
- Check if this file tests MCP read tool JSON shapes — if so, convert to text assertions or remove

### 4. Update documentation

- `docs/mcp-reference.md`: New response format examples for all 5 remaining read tools
- `docs/for-agents.md`: Remove `trellis_ready` references, update status description
- `CLAUDE.md`: Remove `trellis_ready` from MCP tool table, note that status includes Next
## Testing

**Unit tests (`format.test.ts`):**
- Each formatter gets a describe block
- Test with realistic StatusResult/ShowResult/etc. objects built inline
- Verify section headings, plan line format, omission of empty sections
- `formatStatus`: test with tag filter, with/without next, overBudget > 0, all sections empty except done
- `formatShow`: test ready vs blocked vs plain status, no dependencies, no blocks, single-node critical path
- `formatGraph`: test no edges, no chunks, cross-chunk edges present/absent
- `formatLint`: test ok=true (no errors), structural issues merged, auto-fixed present/absent
- `formatBottlenecks`: test empty sections omitted, health summary always present

**Integration tests (`mcp.test.ts`):**
- Existing test fixtures create plans with known data
- Assert text output contains expected headings and plan IDs
- Verify `trellis_ready` tool call returns error (tool not found)

**Manual verification:**
- Run `trellis` MCP server against this repo's plans and inspect output readability
## Done-when

- [ ] All 5 read-only MCP tools (status, show, graph, lint, bottlenecks) return structured text instead of JSON
- [ ] `trellis_ready` tool is removed from MCP server registration
- [ ] `trellis_status` response includes `Next:` recommendation from computeReady
- [ ] No compute functions or return types were modified
- [ ] CLI commands produce identical output to before (no regressions)
- [ ] All existing MCP tests pass (updated to assert text format)
- [ ] New formatter unit tests cover each formatter + edge cases
- [ ] `docs/mcp-reference.md` updated with new response format examples
- [ ] `trellis_ready` removed from CLAUDE.md, for-agents.md, mcp-reference.md
- [ ] Error responses unchanged (still `{ isError: true, content: [{ type: 'text', text }] }`)
