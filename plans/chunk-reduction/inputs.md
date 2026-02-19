# Inputs

## From existing code

### src/scanner.ts
- Current plan discovery: single-file `.md` and directory `README.md` plans
- Frontmatter parsing with YAML

### src/graph.ts
- `computeChunks` function (lines ~260-530): directory grouping, agglomerative merge, manual overrides, orphan assignment
- DAG construction from `depends_on` edges

### src/types.ts
- `Plan` interface: id, title, status, depends_on, tags, filePath, lines
- `Chunk` interface: id, plans, roots, leaves, internalEdges

### src/commands/chunks.ts
- JSON output structure: chunks array, crossChunkEdges, config

### src/commands/graph.ts
- Current dagre + SVG renderer
- Plan drawer (click-to-inspect) UI
