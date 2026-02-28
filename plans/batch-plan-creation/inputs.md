
## From plans
### From: cross-repo-write-routing
- `dequalifyDepsForWrite()` function for stripping same-repo qualification
- MCP write routing pattern (parse qualified ID → resolve plansDir → dequalify → write → invalidate)

## From existing code
- `computeCreate()` in `src/features/create/logic.ts` — single plan creation
- `ContextStore` in `src/core/store.ts` — multi-repo state with `invalidate()` and `getPlansDir()`
- `buildGraph()` in `src/core/graph.ts` — DAG construction from plan list
- MCP server registration pattern in `src/mcp.ts`
- CLI command registration pattern in `src/cli.ts`
