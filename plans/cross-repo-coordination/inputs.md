# Inputs

## From plans

### chunk-reduction
- Plan contract convention (`inputs.md`/`outputs.md` format)
- `PlanContract` type with parsed sections, referenced plan IDs, referenced code paths
- Contract-aware lint checks (foundation to extend for cross-project validation)

## From existing code

### src/scanner.ts
- `scanPlans(plansDir)` — current single-directory scan logic
- `derivePlanId(filePath, plansDir)` — plan ID derivation from file path
- `loadConfig(cwd)` — `.trellis` config file parser
- Directory walk logic for `.md` + `README.md` discovery

### src/types.ts
- `Plan` interface with `id`, `frontmatter`, `inputs`, `outputs`
- `PlanFrontmatter` with `depends_on: string[]` — currently unqualified IDs
- `TrellisConfig` — currently single-project only
- `PlanContract` — contract parsing types

### src/graph.ts
- `buildGraph(plans)` — DAG construction from `depends_on` edges
- `topologicalSort`, `pickNext`, `newlyReady` — dependency resolution logic
- `computeChunks` — chunking algorithm (needs workspace awareness)

### src/commands/status.ts
- Status grouping and display logic (needs multi-project grouping)

### src/commands/ready.ts
- Ready calculation (needs cross-project dependency checking)

### src/commands/lint.ts
- Validation checks (needs cross-project reference validation)

### src/commands/graph.ts
- DAG visualization (needs project clusters and cross-project edge styling)

### src/api.ts
- `Trellis` class — high-level API (needs workspace mode)
