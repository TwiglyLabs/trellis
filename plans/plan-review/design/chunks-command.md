# `trellis chunks` Command Design

## Purpose

Identify reviewable subgraphs (chunks) from the plan dependency graph. A chunk is a set of plans small enough to fit in a single review context and cohesive enough that reviewing them together catches internal inconsistencies.

## Chunk Discovery Algorithm

### Step 1: Initial grouping by directory

Group plans by the first path segment of their plan ID. Plans at the root level (no directory prefix) each form their own initial group.

Example: `contracts/core-types` and `contracts/auth` start in group `contracts`. `standalone-plan` starts alone.

### Step 2: Agglomerative merge

Repeatedly merge the two groups with the most dependency edges between them, as long as the merged result stays within the configured line budget (`chunk_max_lines`, default 8000 lines). Stop when:

- No merge is possible without exceeding the line budget, or
- All inter-group edge counts are ≤ 1 (remaining groups are only loosely connected)

This naturally clusters tightly-coupled plans regardless of directory structure, while using directory layout as a sensible starting point.

### Step 3: Apply manual overrides

Plans with `tags: [chunk:name]` are forced into the named chunk, creating it if necessary. Overrides run after automatic chunking so they always win.

### Step 4: Orphan assignment

Any plan displaced by an override (removed from its automatic chunk) gets reassigned to the chunk with which it shares the most dependency edges. Ties go to the smaller chunk.

### Step 5: Size check

Warn if any chunk exceeds the configured line limit.

**Line counting:** Lines = total lines in each member plan's file (frontmatter + body). For directory-style plans (those with `README.md`), count only the README. This is an approximation of context-window cost for review agents — not a token count, but close enough for budgeting purposes.

## CLI Interface

```
trellis chunks                    # list chunks with member plans
trellis chunks --json             # structured output for skill consumption
trellis chunks --verbose          # show cross-chunk edges and size details
```

## Human-Readable Output

```
Chunks (3 discovered, 0 manual overrides):

  core-data (6 plans, 5.8K lines)
    contracts/core-types
    implementation/core-extraction
    implementation/migration-infrastructure
    implementation/better-sqlite3-migration
    implementation/schema-v9
    implementation/store-refactor

  cloud-stack (7 plans, 6.2K lines)
    contracts/auth-system
    contracts/cloud-rest-api
    ...

  ui-desktop (4 plans, 4.1K lines)
    contracts/ui-design-system
    implementation/ui-foundations
    ...

Cross-chunk edges: 3
  store-refactor (core-data) -> http-store-adapter (cloud-stack)
  store-refactor (core-data) -> tauri-app (ui-desktop)
  cloud-api (cloud-stack) -> sync-client (cloud-stack)
```

## JSON Output Schema

```json
{
  "chunks": [
    {
      "id": "core-data",
      "plans": [
        {
          "id": "contracts/core-types",
          "filePath": "/absolute/path/to/plans/contracts/core-types.md",
          "lines": 180
        }
      ],
      "roots": ["contracts/core-types", "implementation/migration-infrastructure"],
      "leaves": ["implementation/store-refactor"],
      "planCount": 6,
      "totalLines": 5800,
      "internalEdges": [
        { "from": "contracts/core-types", "to": "implementation/core-extraction" },
        { "from": "contracts/core-types", "to": "implementation/schema-v9" }
      ]
    }
  ],
  "crossChunkEdges": [
    {
      "from": "implementation/store-refactor",
      "to": "implementation/http-store-adapter",
      "fromChunk": "core-data",
      "toChunk": "cloud-stack"
    }
  ],
  "config": {
    "maxLines": 8000,
    "overrides": 0
  }
}
```

Key additions vs human-readable output:

- `plans[].filePath` — absolute path so review agents can read files directly via the Read tool
- `plans[].lines` — per-plan line count for budget tracking
- `internalEdges` — dependency edges within the chunk, needed by review agents for coherence checks

## Implementation Notes

- Reuses `buildGraph()` from `src/graph.ts` for DAG construction
- **Needs both-direction traversal:** `buildGraph()` currently provides `dependents` (reverse edges) but the merge algorithm needs forward edges too. Add a `dependencies: Map<string, string[]>` field to `GraphData` (built from `plan.frontmatter.depends_on`). This is worth extending in `GraphData` since other future functions will likely need forward edges as well.
- New function in `src/graph.ts`: `computeChunks(plans: Plan[], options?: { maxLines?: number }): ChunkResult`
- `.trellis` config gets optional `chunk_max_lines` key (default: 8000)
- Cross-chunk edges: for each dependency edge, if source and target are in different chunks, it's a cross-chunk edge

## Chunk ID Generation

Automatic chunk IDs use the **common path prefix** of member plan IDs:

- All plans share prefix `contracts/` → chunk ID is `contracts`
- Mixed paths but a single root plan → use root plan's first path segment
- No common prefix → `chunk-N` (sequential numbering)

Manual chunks (from `chunk:name` tags) use the tag value directly.
