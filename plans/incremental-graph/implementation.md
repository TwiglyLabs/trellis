
## Steps
1. **Add `patchGraph()` to `src/core/graph.ts`.**
   Signature: `(graph: GraphData, plans: Plan[], events: PlanChangeEvent[]) => GraphData`. The `plans` array is the already-updated full plan list (caller is responsible for adding/removing plans before calling). Returns a new `GraphData` object (immutable — spread existing, replace only changed parts).

2. **Implement plan-updated handling.**
   Find the node in `graph.nodes` by planId, replace its data with the updated plan's data (title, status, tags). Check if `depends_on` changed by comparing old and new frontmatter. If unchanged, only recompute `ready`/`blocked` for the plan itself. If changed, remove old edges, add new edges, then recompute `ready`/`blocked` for the plan AND all its immediate dependents (one hop).

3. **Implement plan-added handling.**
   Insert a new node from the Plan. Add edges for its `depends_on`. Walk all existing nodes to check if any have a dangling `depends_on` reference matching the new plan's ID — if so, add those edges. Recompute `ready`/`blocked` for the new node and all nodes that reference it (newly resolved deps may unblock them).

4. **Implement plan-removed handling.**
   Remove the node and all edges involving it (both as source and target). For each former dependent, recompute `ready`/`blocked` — they may now be blocked (lost a dependency) or the dangling dep may be ignored depending on graph policy.

5. **Handle batch of mixed events.**
   Process all events in order: removes first (to avoid stale references), then adds, then updates. After all mutations, do a single pass recomputing `ready`/`blocked` for all affected nodes (union of all touched node IDs and their one-hop neighbors).

6. **Preserve referential equality for unchanged nodes.**
   Only replace node objects that were actually affected. This lets consumers use `===` checks to skip re-rendering unchanged nodes.

7. **Export from `src/index.ts`.**
   Export `patchGraph` from the library entry point.

8. **Write tests.**
   All tests use synthetic `GraphData` and `Plan[]` arrays. No filesystem access.

## Testing
- **plan-updated, no dep change:** Update a plan's title. Verify node data changes, neighbors are untouched (referential equality), ready/blocked unchanged.
- **plan-updated, dep change:** Plan originally depends on A, updated to depend on B. Verify edge A→plan removed, edge B→plan added. A's dependents recomputed. B's dependents recomputed.
- **plan-added, unblocks existing:** Add plan X that was a dangling dependency for plan Y. Verify Y becomes unblocked (transitions from blocked to ready if X was its only missing dep).
- **plan-added, new leaf:** Add plan with no dependents and no dependencies. Verify it appears as a ready node. No other nodes affected.
- **plan-removed, blocks dependents:** Remove plan that plan Z depends on. Verify Z becomes blocked.
- **plan-removed, no dependents:** Remove a leaf plan. Verify clean removal, no other nodes affected.
- **Mixed batch:** Remove plan A, add plan B, update plan C in one batch. Verify all three mutations applied correctly and affected neighbors recomputed.
- **Empty batch:** Pass empty events array. Verify returned graph is the same reference (`===`).
- **Referential equality:** After updating one plan, verify all unaffected node objects are `===` to originals.
- **Pure function:** Same inputs produce same outputs. No side effects.

## Done-when
- `patchGraph()` correctly handles plan-added, plan-removed, and plan-updated events.
- Ready/blocked status recomputed only for affected nodes and their one-hop neighbors.
- Unchanged nodes preserve referential equality.
- Mixed-event batches processed correctly (removes before adds before updates).
- Empty batch returns same graph reference.
- Critical path and topological order are NOT recomputed (left for full `buildGraph()`).
- Library exports `patchGraph`.
- All tests pass using synthetic graph data — no filesystem access.
