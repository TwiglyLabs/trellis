# Chunk Algorithm

## Current Algorithm (for reference)

1. Group by first directory segment of plan ID
2. Agglomerative merge: repeatedly merge the two groups with most edges, if merged size fits budget
3. Manual `chunk:name` tag overrides
4. Orphan reassignment
5. Size warning

Problem: Step 1 puts all `implementation/*` plans in one group. The algorithm can only merge, never split.

## New Algorithm

### Step 1: Topological Layering (replaces directory grouping)

Assign each plan a **depth** — the length of the longest path from any root to this plan in the DAG.

```
Depth 0: core-extraction, migration-infra, scaffold-cloud
Depth 1: schema-v9, better-sqlite3, auth-service, ui-foundations
Depth 2: store-refactor, cloud-api
Depth 3: engine-extraction, http-store-adapter, sync-client, tauri-app, web-app
Depth 4: mcp-refactor
Depth 5: gedcom-parser, hosted-mcp
```

Plans at the same depth form initial groups. This produces many small groups instead of one directory-sized blob.

### Step 2: Agglomerative Merge (unchanged)

Same as current: repeatedly merge the two groups with the most inter-group edges, subject to line budget. Adjacent depth layers that are small and tightly coupled will naturally merge.

### Step 3: Interface-Width Split (new)

After merging, check each group against the line budget. For oversized groups:

1. Enumerate possible binary splits (try each plan as a cut point along topological ordering)
2. For each split, compute **interface width**: count the total contract items (bullet points from `outputs.md` sections) that flow across the cut
3. Choose the split with the **narrowest interface** that produces two groups both under the budget
4. If no valid split exists, keep the oversized group and annotate: `"advisory": "chunk resists reduction — consider decomposing plans"`

Interface width requires `outputs.md` data. If contracts aren't present, fall back to edge count (current behavior).

### Step 4: Manual Overrides (unchanged)

`chunk:name` tags still override after automatic chunking.

### Step 5: Orphan Assignment (unchanged)

Displaced plans reassigned to the chunk with most shared edges.

### Step 6: Chunk Contract Aggregation (new)

For each chunk, compute:
- **chunkOutputs**: all `outputs.md` sections from member plans that are consumed by plans in *other* chunks
- **chunkInputs**: all `inputs.md` "From plans" sections that reference plans in *other* chunks

These represent the chunk's external interface — what it provides to and expects from the rest of the graph.

## Configuration

```
# .trellis
chunk_max_lines: 8000              # existing
chunk_strategy: topological        # new, default "topological", alt "directory" for backwards compat
```

## Edge Cases

- **Flat DAGs** (no dependencies): topological layering puts everything at depth 0, same as current directory grouping. Agglomerative merge handles it.
- **Deep chains** (A→B→C→D→E): each plan gets its own depth, producing many small groups. Merge combines adjacent layers.
- **Wide fan-out** (A→{B,C,D,E,F}): all dependents at depth 1. If they exceed budget, interface-width splitting separates independent subgraphs.
- **No contracts**: algorithm degrades gracefully — uses edge count instead of interface width for split scoring.
