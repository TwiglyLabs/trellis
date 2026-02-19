# Implementation

## Steps

1. Add qualified ID parser — `parseQualifiedId(ref: string): { repo?: string; planId: string }`. Splits on first `:`. Add to `utils.ts`. Add lint rule: plan IDs must not contain colons.

2. Extend `Plan` type — add optional `repo?: string` field to `Plan` in `types.ts`. Local plans have `repo: undefined`. Remote plans carry their repo alias.

3. Extend `buildGraph` for qualified IDs — when resolving `depends_on` edges, use `parseQualifiedId` to determine if the dependency is local or cross-repo. Cross-repo deps resolve against the full plan set (local + remote). Unresolved cross-repo refs are recorded for lint.

4. Update `Trellis` class — when `project` is configured, the `plans` getter merges local plans (from filesystem) with remote plans (from git reader). The `graphData` getter builds the unified graph. Add `projectPlans` property that returns the full cross-repo plan map.

5. Implement `--project` flag — add to `status`, `ready`, `graph`, `lint`, `show` commands. Controls display scope: `--project` shows all repos, without it shows current repo only. Resolution scope always includes cross-repo deps regardless of flag.

6. Update `trellis ready` — cross-repo blocking is always checked. A plan with an unsatisfied qualified dep is blocked even in single-repo mode. Requires a fetch (or cached data) on first invocation.

7. Update `trellis graph` visualization — add repo clusters (colored bounding boxes) to the DAG viewer. Cross-repo edges get distinct styling (dashed lines or different color). Legend shows repo aliases and colors.

8. Update `trellis lint` — add cross-repo reference validation. Error: qualified ID references non-existent plan. Error: qualified ID references non-existent repo alias. Warning: cross-repo dep plan has no `outputs.md`.

9. Update `trellis show` — accept qualified IDs as arguments (`trellis show trellis:plan-schema`). Display cross-repo dependents and dependencies.

## Testing

- Qualified ID parsing: local refs, qualified refs, edge cases (no colon, multiple colons, empty segments)
- Lint: colons rejected in plan IDs
- Graph construction: mixed local and cross-repo edges, unresolved cross-repo refs detected
- Ready: plan blocked by unsatisfied cross-repo dep not shown as ready, even without `--project`
- Status `--project`: groups by repo, shows cross-repo blockers
- Ready `--project`: lists ready plans across all repos
- Graph `--project`: unified DAG with repo clusters and cross-repo edge styling
- Lint `--project`: validates cross-repo references across all repos
- Show: qualified IDs resolve correctly, cross-repo context displayed
- Backward compatibility: everything works without `project` configured (no cross-repo resolution)

## Done-when

- Qualified `repo:plan-id` syntax works in `depends_on`
- Unified graph built from local + remote plans
- `trellis ready` checks cross-repo deps even in single-repo mode
- All commands support `--project` for full project view
- Graph viewer shows repo clusters and cross-repo edges
- Lint catches broken cross-repo references
- All existing single-repo behavior unchanged
