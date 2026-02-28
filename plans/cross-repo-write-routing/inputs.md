
## From existing code
- `parseQualifiedId()` in `src/core/utils.ts:45-49` — parses `repo:plan-id` syntax
- `qualifyPlan()` in `src/core/context.ts:195-211` — inverse operation (qualifies bare deps at read time)
- MCP `trellis_create` handler in `src/mcp.ts:302-356` — already routes writes to target repo via `ctx.getPlansDir(parsed.repo)`
- `afterWrite()` in `src/mcp.ts:290-299` — invalidates store after writes
- `computeCreate()` in `src/features/create/logic.ts:22-96` — validates deps and writes plan files
