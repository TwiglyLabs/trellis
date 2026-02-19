---
title: Chunk Reduction
status: archived
tags:
  - chunking
  - contracts
  - graph
depends_on: []
description: >-
  Plan contracts (inputs/outputs), interface-width chunk splitting, and graph
  visualization of contract flow
---

# Chunk Reduction

Enable smaller, reviewable chunks by giving plans explicit input/output contracts and teaching trellis to split chunks at narrow interfaces.

## Problem

The current chunking algorithm groups by directory prefix then merges agglomeratively. When many plans share a directory (e.g., 17 `implementation/` plans), they form one oversized chunk that can't be split — the algorithm only merges, never splits. The dependencies between plans are genuine, so removing edges isn't an option.

## Solution

Three connected changes:

1. **Plan contracts** — Plans declare what they produce (`outputs.md`) and consume (`inputs.md`). These are first-class artifacts written during plan development.
2. **Smarter chunking** — Replace directory-based initial grouping with topological layering. Add interface-width scoring to find optimal split points.
3. **Graph visualization** — Show contract flow on edges, chunk boundaries with interface-width coloring, expanded plan drawer with contract tabs.

## Contract Lifecycle

Contracts enable an inductive validation model for the entire plan DAG:

- **Plan development** (human + agent): Define the plan, its inputs, and its outputs collaboratively
- **Plan review** (agent): "Assuming inputs are satisfied, can this plan deliver its stated outputs?"
- **Implementation** (agent): Execute the plan; outputs contract is the acceptance criteria
- **Code review** (agent): "Did the implementation actually produce the stated outputs?" — the gate for unblocking downstream plans

Each node validates independently. If every node passes both plan review and code review, the system is sound.

## Components

### 1. Plan Folder Convention

See [design/plan-contracts.md](design/plan-contracts.md).

Every plan with dependents becomes a directory with:
- `README.md` — plan frontmatter and implementation details
- `outputs.md` — what this plan delivers (types, interfaces, invariants)
- `inputs.md` — what this plan needs, from upstream plans or existing code

### 2. Scanner & Data Model

See [design/data-model.md](design/data-model.md).

Extend the scanner to read `inputs.md`/`outputs.md`. Parse markdown lightly (H2/H3 headings + bullets) into structured data. New lint checks for contract mismatches.

### 3. Chunk Algorithm

See [design/chunk-algorithm.md](design/chunk-algorithm.md).

Replace directory grouping with topological layering. Add interface-width scoring for split decisions. Annotate chunks that resist reduction.

### 4. Graph Visualization

See [design/graph-visualization.md](design/graph-visualization.md).

Edge labels from contracts, chunk bounding boxes color-coded by interface width, expanded plan drawer with contract tabs.
