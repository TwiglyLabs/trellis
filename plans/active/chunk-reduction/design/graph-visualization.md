# Graph Visualization

## Current State

`trellis graph` renders a DAG using dagre layout + SVG in the browser. Nodes are plans, edges are `depends_on` relationships. Clicking a node opens a drawer with plan metadata (title, status, description, dependencies).

## Changes

### Edge Labels

Cross-chunk edges gain labels showing the contract heading (H2 from `outputs.md`) that flows along the edge.

- Only cross-chunk edges are labeled (internal edges stay clean to reduce noise)
- If multiple contract sections flow along one edge, show them comma-separated or stacked
- Labels are rendered as SVG text on the edge path, positioned at midpoint
- Truncate labels longer than ~40 characters with ellipsis

Example: an edge from `core-extraction` to `schema-v9` might be labeled `@acorn/core package, TreeStore interface`.

### Chunk Bounding Boxes

Render each chunk as a colored rectangle behind its member plan nodes.

- Light background fill, rounded corners
- Color-coded by **maximum interface width** to neighboring chunks:
  - Green: narrow interface (0-5 contract items crossing boundary)
  - Yellow: moderate (6-15 items)
  - Red: wide (16+ items) — signal that this boundary is strained
- Chunk ID label in the top-left corner of the bounding box
- Thresholds configurable via `.trellis` (stretch goal, not required for v1)

### Expanded Plan Drawer

The click-to-inspect drawer expands from a narrow sidebar to ~40-50% of the viewport width.

Three tabs:

**Plan tab** (existing, enhanced):
- Title, status, description
- Dependencies list
- Tags
- Line count

**Outputs tab** (new):
- Rendered `outputs.md` content
- Each H2 section shows which downstream plans consume it (derived from the graph)
- Missing outputs warning if plan has dependents but no `outputs.md`

**Inputs tab** (new):
- Rendered `inputs.md` content
- "From plans" entries are clickable — clicking navigates to that upstream plan's node and opens its Outputs tab
- "From existing code" entries shown as-is (no navigation, those are file paths)

### Interaction

- Clicking a chunk bounding box highlights all edges crossing that chunk's boundary and shows aggregate interface width
- Hovering an edge label shows a tooltip with the full contract section content (all bullet points)
- Keyboard shortcut `c` toggles chunk bounding boxes on/off

## Technical Approach

All rendering stays in the existing vanilla JS + SVG stack. No new dependencies.

- Edge labels: SVG `<text>` elements positioned via dagre edge path data
- Bounding boxes: SVG `<rect>` elements computed from the bounding box of member node positions, rendered behind the node layer
- Drawer: HTML panel (already exists), add tab navigation with CSS
- Contract data: sourced from the extended `trellis chunks --json` output, fetched on page load
