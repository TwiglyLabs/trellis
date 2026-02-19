# Outputs

## Library package (`trellis` npm package)

- `dist/index.mjs` — ESM library bundle
- `dist/index.cjs` — CJS library bundle
- `dist/index.d.ts` — TypeScript declarations
- `package.json` with `exports`, `main`, `module`, `types` fields

## Trellis class (high-level API)

- `new Trellis(projectDir)` — constructor, loads config
- `trellis.refresh()` — force rescan from disk
- `trellis.status(filters?)` — returns `StatusResult` with plans categorized by status
- `trellis.ready(filters?)` — returns `ReadyResult` with ready plans and `next` pick
- `trellis.show(planId)` — returns `ShowResult` with full plan details, dependencies, critical path, contracts
- `trellis.update(planId, status)` — returns `UpdateResult`, writes to disk, auto-refreshes
- `trellis.lint(options?)` — returns `LintResult` with errors, warnings, contract coverage
- `trellis.graph()` — returns `GraphResult` with nodes, edges, chunks, cross-chunk edges (data for DAG rendering)
- `trellis.epic(name?)` — returns `EpicResult[]` with progress tracking
- `trellis.chunks(filters?)` — returns `ChunkResult` with chunk analysis
- `trellis.watch()` / `trellis.unwatch()` — reactive file monitoring, emits `'change'` events

## Low-level function exports

- `scanPlans(plansDir)`, `loadConfig(cwd)`, `derivePlanId(filePath, plansDir)`
- `buildGraph(plans)`, `detectCycles(plans)`, `topologicalSort(plans)`
- `transitiveDependents(planId, graph)`, `computeCriticalPath(planId, graph)`, `pickNext(graph)`
- `computeChunks(plans, graph, options?)`, `newlyReady(planId, status, graph)`
- `parseFrontmatter(content)`, `validateFrontmatter(planId, fm)`, `readPlanFile(path)`, `updatePlanFile(path, updates)`
- `parseInputs(markdown)`, `parseOutputs(markdown)`
- `filterPlans(plans, filters)`, `VALID_STATUSES`

## TypeScript types

- `Plan`, `PlanFrontmatter`, `PlanStatus`, `PlanContract`, `ContractSection`, `TrellisConfig`, `ValidationError`
- `GraphData`, `Cycle`, `Chunk`, `ChunkPlan`, `ChunkEdge`, `CrossChunkEdge`, `ChunkBoundaryItem`, `ChunkResult`
- `StatusResult`, `PlanSummary`, `BlockedPlanSummary`, `ReadyResult`, `ShowResult`, `DependencyInfo`
- `UpdateResult`, `LintResult`, `LintIssue`, `GraphResult`, `GraphNode`, `GraphEdge`, `EpicResult`

## Integration test suite

- `tests/dist-integration.test.ts` — built artifact tests (ESM + CJS bundles work end-to-end)
- `tests/api-integration.test.ts` — consumer workflow tests (directory plans, contracts, concurrent instances, error paths)
- `tests/json-contracts.test.ts` — JSON backward-compatibility contract tests (every field, every command)
- `tests/api-cli-consistency.test.ts` — cross-layer tests proving CLI JSON output matches API return values
- `npm run test:dist` — separate script for built artifact validation
