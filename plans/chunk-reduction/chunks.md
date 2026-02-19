# Implementation Chunks

Five chunks, executed in order. Each is independently testable and committable.

## Chunk 1: Contract Types + Scanner + Config

**Goal:** Trellis can read `inputs.md`/`outputs.md` from directory plans and expose parsed contracts on `Plan` objects.

### Tasks

1. **Add contract types to `src/types.ts`**
   - `ContractSection`, `PlanContract` interfaces
   - Extend `Plan` with optional `inputs`/`outputs` fields
   - Add `chunk_strategy?: 'topological' | 'directory'` to `TrellisConfig`

2. **Write contract markdown parser** (`src/contracts.ts`, new file)
   - `parseOutputs(markdown: string): PlanContract` — H2 headings as deliverables, bullets as items
   - `parseInputs(markdown: string): PlanContract` — "From plans" / "From existing code" H2 sections, H3 headings as sources
   - Line-by-line parsing, no external library
   - Unit tests with inline markdown strings in `tests/contracts.test.ts`

3. **Extend scanner to load contracts** (`src/scanner.ts`)
   - In `walkDir`, when a directory plan (README.md) is found, check for sibling `inputs.md`/`outputs.md`
   - Read and parse with contract parser, attach to `Plan` object
   - Extend filesystem fixtures in `tests/scanner.test.ts`

4. **Extend config parser** (`src/scanner.ts`)
   - Add `chunk_strategy` key parsing in `loadConfig`
   - Test in `tests/scanner.test.ts`

### Test strategy
- `contracts.test.ts`: unit tests for parser with inline markdown (happy path, missing sections, malformed input)
- `scanner.test.ts`: filesystem fixtures with `inputs.md`/`outputs.md` alongside `README.md`

### Acceptance criteria
- `scanPlans()` returns `Plan` objects with populated `inputs`/`outputs` for directory plans that have contract files
- Single-file plans unaffected (no regression)
- Parser handles edge cases: empty files, missing H2s, no bullets

---

## Chunk 2: Chunk Algorithm Refactor (pure refactor)

**Goal:** `computeChunks` is decomposed into named functions with no behavior change. All existing tests pass unchanged.

### Tasks

1. **Extract named functions from `computeChunks` in `src/graph.ts`**
   - `groupByDirectory(plans): Map<string, Set<string>>`
   - `agglomerativeMerge(groups, graph, maxLines): Map<string, Set<string>>`
   - `applyOverrides(groups, plans): { groups, overrides }`
   - `assignOrphans(groups, plans, graph): void`
   - `buildChunkObjects(groups, plans, graph): { chunks, crossChunkEdges }`
   - `computeChunks` becomes an orchestrator calling these in sequence
   - All existing tests must pass unchanged (pure refactor)

### Test strategy
- Run all existing `graph.test.ts` tests — zero changes expected

### Acceptance criteria
- `computeChunks` output is byte-identical to before
- Each extracted function is independently callable (for chunk 3 to compose with)
- No new logic, no new code paths

---

## Chunk 3: Topological Strategy + Interface-Width Split

**Goal:** `computeChunks` gains a topological strategy that uses depth-based grouping and interface-width splitting.

### Tasks

1. **Add `computeDepths` function**
   - `computeDepths(plans, graph): Map<string, number>` — longest path from any root to each plan
   - Unit tests in `tests/graph.test.ts`

2. **Add `groupByTopologicalDepth` function**
   - `groupByTopologicalDepth(plans, graph): Map<string, Set<string>>` — groups plans by depth
   - Group key is `depth-N` (e.g., `depth-0`, `depth-1`)
   - Unit tests

3. **Add `interfaceWidthSplit` function**
   - `interfaceWidthSplit(groups, plans, graph, maxLines): Map<string, Set<string>>`
   - For each group over budget: enumerate binary cuts along topo ordering (ordered by depth, then alphabetically by plan ID), pick narrowest interface
   - With contracts: count bullet items crossing the cut
   - Without contracts: fall back to edge count
   - Single-pass only — annotate with `advisory` if still over budget after best split
   - Unit tests with and without contracts

4. **Add `chunkContractAggregation` function**
   - Computes `chunkInputs`/`chunkOutputs` for each chunk (cross-boundary contracts)
   - Populates `ChunkBoundaryItem[]` on `Chunk` objects

5. **Wire strategy selection in `computeChunks`**
   - Accept `strategy` option (`'topological' | 'directory'`), default `'directory'` for backwards compat
   - `'directory'`: groupByDirectory → merge → overrides → orphans → build
   - `'topological'`: groupByTopologicalDepth → merge → split → overrides → orphans → build → aggregate
   - Pass through from `chunksCommand` using `config.chunk_strategy`

### Test strategy
- Steps 1-4 get unit tests with `makePlan` helpers, including mock `inputs`/`outputs` on Plan objects
- Add integration test: same plan set produces different (better) chunks with topological vs directory strategy

### Acceptance criteria
- `chunk_strategy: directory` produces identical output to current algorithm
- `chunk_strategy: topological` (default) produces smaller chunks for graphs with many same-directory plans
- Oversized groups that can be split are split; those that can't get `advisory` field
- `chunkInputs`/`chunkOutputs` populated in JSON output

---

## Chunk 4: Lint Checks + CLI Extensions

**Goal:** New contract-aware lint checks and CLI display of contracts.

### Tasks

1. **Add contract lint checks to `src/commands/lint.ts`**
   - Warning: plan has dependents but no `outputs.md`
   - Error: `inputs.md` "From plans" references plan ID not in `depends_on`
   - Warning: `inputs.md` references plan with no `outputs.md`
   - Note: input-to-output content matching is agent-driven during review, not a lint check
   - Tests in `tests/commands/lint.test.ts`

2. **Add `--contracts` flag to `trellis show`** (`src/commands/show.ts`)
   - Print parsed inputs/outputs inline below existing metadata
   - Format: indented headings with bullet items
   - Show "(none)" for missing contracts
   - Test in `tests/commands/show.test.ts`

3. **Extend `trellis chunks --json` output** (`src/commands/chunks.ts`)
   - Include `chunkInputs`/`chunkOutputs` fields on each chunk (already computed in chunk 3)
   - Test in `tests/commands/chunks.test.ts`

### Test strategy
- Lint tests: create plan fixtures with and without contracts, verify correct errors/warnings
- Show tests: snapshot-style output comparison
- Chunks tests: verify JSON output shape includes new fields

### Acceptance criteria
- `trellis lint` catches contract mismatches
- `trellis show <id> --contracts` displays parsed contracts
- `trellis chunks --json` includes chunk-level contract aggregation

---

## Chunk 5: Graph Visualization

**Goal:** The web viewer shows chunk boundaries, contract flow on edges, and an expanded drawer with contract tabs.

### Tasks

1. **Extend `/api/data` endpoint** (`src/commands/graph.ts`)
   - Call `computeChunks` in `getGraphData`
   - Include `chunks` and `crossChunkEdges` in response
   - Include `inputs`/`outputs` raw markdown on plan objects

2. **Add chunk bounding boxes to SVG** (`src/viewer/index.html`)
   - Compute bounding box from member node positions
   - Render colored `<rect>` behind node layer
   - Color by max interface width (green/yellow/red thresholds)
   - Chunk ID label in top-left corner
   - Independent of tag/repo grouping (both can be active)
   - Toggle with `c` keyboard shortcut (on by default)

3. **Add edge labels to cross-chunk edges**
   - SVG `<text>` at edge midpoint
   - Comma-separated contract headings, truncated at ~60 chars
   - Hover tooltip with full contract items
   - Only on cross-chunk edges (internal edges stay clean)

4. **Expand drawer with contract tabs**
   - CSS: `--drawer-width: 45vw` with `min-width: 420px`
   - Tab bar: Plan | Outputs | Inputs
   - Plan tab: existing content (enhanced with line count)
   - Outputs tab: rendered `outputs.md`, shows consumers per H2 section
   - Inputs tab: rendered `inputs.md`, "From plans" entries are clickable links
   - Clicking a "From plans" link calls `selectPlan(upstreamId, 'outputs')`

5. **Add chunk interaction**
   - Clicking chunk bounding box highlights boundary edges, shows interface width
   - `selectPlan(id, tab)` variant for tab-aware navigation

### Test strategy
- Integration test for `/api/data` response shape: verify chunks, crossChunkEdges, and contract data are present
- Unit tests for drawer tab logic (pure JS functions: tab switching, `selectPlan(id, tab)` routing)
- Manual browser testing for SVG rendering (bounding boxes, edge labels, color thresholds)

### Acceptance criteria
- Chunk boundaries visible and color-coded in graph viewer
- Cross-chunk edges labeled with upstream output H2 headings
- Drawer shows three tabs with correct content
- Clicking between plans via contracts works

---

## Dependency Graph

```
Chunk 1 (types + scanner + config)
  └── Chunk 2 (algorithm refactor — pure refactor)
        └── Chunk 3 (topological strategy + interface-width split)
              └── Chunk 4 (lint + CLI)
              └── Chunk 5 (graph visualization)
```

Chunk 2 is a pure refactor with no behavior change — the safety gate before adding new algorithm code in chunk 3. Chunks 4 and 5 are independent of each other — both depend on chunks 1-3. Can be parallelized.
