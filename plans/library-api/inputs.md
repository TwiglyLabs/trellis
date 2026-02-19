# Inputs

## From existing code

### src/types.ts
- `Plan`, `PlanFrontmatter`, `PlanStatus`, `PlanContract`, `ContractSection`, `TrellisConfig`, `ValidationError`

### src/scanner.ts
- `scanPlans(plansDir)` — recursive plan discovery and parsing
- `loadConfig(cwd)` — `.trellis` config file loading
- `derivePlanId(filePath, plansDir)` — path-to-ID derivation

### src/graph.ts
- `buildGraph(plans)` — dependency graph construction
- `detectCycles(plans)` — DFS cycle detection
- `topologicalSort(plans)` — Kahn's algorithm
- `transitiveDependents(planId, graph)` — DFS transitive dependents
- `computeCriticalPath(planId, graph)` — longest dependency chain
- `pickNext(graph, candidates?)` — heuristic next-plan selection
- `computeChunks(plans, graph, options?)` — chunk discovery (directory + topological strategies)
- `newlyReady(planId, status, graph)` — what unblocks when a plan completes

### src/frontmatter.ts
- `parseFrontmatter(content)` — YAML frontmatter parsing
- `validateFrontmatter(planId, fm)` — frontmatter validation
- `readPlanFile(filePath)` — read and parse a plan file
- `updatePlanFile(filePath, updates, deleteFields?)` — in-place frontmatter update

### src/contracts.ts
- `parseInputs(markdown)` — input contract parsing
- `parseOutputs(markdown)` — output contract parsing

### src/utils.ts
- `filterPlans(plans, filters)` — tag/repo filtering
- `VALID_STATUSES` — status enum array

### src/commands/*.ts
- All command implementations (reference for behavior parity)
- CLI argument parsing patterns and `--json` output shapes

### build.mjs
- Existing esbuild CLI build configuration
