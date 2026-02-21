
## Steps
1. **Add `trellis_status` tool to `src/mcp.ts`.**
   Call `createContext()`, then reuse the status-grouping logic from `src/features/status/command.ts` (or extract it into a shared compute function if not already extracted). Return `{ counts: Record<PlanStatus, number>, plans: PlanSummary[] }`. Apply optional `tag` filter before grouping. Zod input: `{ tag: z.string().optional() }`.

2. **Add `trellis_ready` tool.**
   Call `createContext()`, filter plans to those that are ready (not blocked, status is `not_started`), call `pickNext()` for the recommendation. Return `{ ready: PlanSummary[], next: PlanSummary | null }`. No inputs.

3. **Add `trellis_show` tool.**
   Call `createContext()`, find the plan by ID, compute dependencies/dependents from graph edges, include blocking status and critical path position. Return the full detail object matching `show --json` output. Zod input: `{ plan_id: z.string() }`. Return error text (not throw) if plan_id not found.

4. **Add `trellis_graph` tool.**
   Call `createContext()`, return `{ nodes: Array<{ id, title, status, tags }>, edges: Array<{ from, to }> }` from the graph data. No inputs.

5. **Add `trellis_lint` tool.**
   Call `createContext()`, run lint logic, return `{ issues: Array<{ planId, severity, message }>, summary: { errors: number, warnings: number } }`. Zod input: `{ strict: z.boolean().optional() }`.

6. **Extract shared compute functions if needed.**
   If status/ready/show/lint logic is currently inline in command files, extract into importable functions so both CLI commands and MCP tools share the same code path. If already extracted, skip this step.

7. **Write MCP integration tests.**
   In a new test file or extend existing MCP tests. Test each tool using the `server._registeredTools[name].handler(args, {})` pattern. Create a fixture with 3-4 plans in various statuses and dependency relationships. Test: status grouping, tag filtering, ready list accuracy, show with valid/invalid plan_id, graph node/edge counts, lint issue detection.

8. **Update `docs/mcp-reference.md`.**
   Add schemas and examples for all 5 new tools, following the existing format for write tools.

## Testing
- **Fixture:** Create a temp directory with `.trellis/config` and 4 plans: one `not_started` with no deps (ready), one `in_progress`, one `draft` blocked by the `in_progress` plan, one `done`. Tag two plans with `epic:auth`.
- **trellis_status:** Verify counts match (1 per status). Test `tag: "epic:auth"` filter returns only 2 plans.
- **trellis_ready:** Verify the `not_started` unblocked plan appears. Verify `next` is non-null and matches.
- **trellis_show:** Valid plan_id returns full detail with correct dependencies/dependents. Invalid plan_id returns error content (not a thrown exception).
- **trellis_graph:** Node count matches plan count. Edge count matches dependency count. Each edge has valid `from`/`to` IDs.
- **trellis_lint:** Introduce a lint-triggering condition (e.g., plan with missing Problem section) and verify it appears in issues.
- **Context isolation:** Each tool call gets a fresh context — verify by modifying a plan file between calls and checking the second call reflects the change.

## Done-when
- All 5 read tools (`trellis_status`, `trellis_ready`, `trellis_show`, `trellis_graph`, `trellis_lint`) are registered in the MCP server and return well-structured JSON.
- Each tool creates a fresh context per call (no stale caching).
- Integration tests pass for all tools, including edge cases (empty graph, missing plan_id, tag filtering).
- `docs/mcp-reference.md` documents all new tools with input schemas and example outputs.
- Existing MCP write tool tests still pass (no regressions).
