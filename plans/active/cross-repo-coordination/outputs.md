# Outputs

## Workspace discovery
- `.trellis-workspace` file format: `projects:` section mapping alias → relative path
- `loadWorkspace(cwd)` function: walks up from cwd to find workspace root, returns parsed config or null
- `WorkspaceConfig` type: `root: string`, `projects: Map<string, ProjectRef>`
- `ProjectRef` type: `alias: string`, `path: string`, `config: TrellisConfig`
- Backward compatible: all existing behavior unchanged when no workspace file exists

## Qualified plan references
- `project:plan-id` syntax in `depends_on` frontmatter field
- `parseQualifiedId(ref)` function returning `{ project?: string, planId: string }`
- Unqualified IDs resolve within current project (backward compatible)
- Same syntax works in `inputs.md` "From plans" section headings

## Multi-project scanner
- `scanWorkspace(config)` function returning `Map<string, Plan[]>` (alias → plans)
- Plans gain a `project` field indicating which project they belong to
- Unified graph construction: `buildWorkspaceGraph(allPlans)` merging plans from all projects
- Qualified IDs in the graph: `sdk:active/core-extraction` for cross-project, `active/core-extraction` for local

## Cross-project dependency resolution
- `trellis ready` checks cross-project dependencies even in project-local mode
- `trellis show <project:plan-id>` resolves qualified IDs across projects
- `trellis status --workspace` aggregates all projects with per-project grouping
- `trellis ready --project <alias>` filters to one project while respecting cross-project blockers

## Cross-project contract validation (lint)
- Error: `depends_on` references qualified ID that doesn't exist in target project
- Error: `inputs.md` references plan in another project that has no `outputs.md`
- Warning: `inputs.md` references contract heading not found in target's `outputs.md`
- Warning: plan has cross-project dependents but no `outputs.md`
- All checks run in both project-local and workspace modes

## Workspace graph visualization
- Project clusters as colored bounding boxes in DAG view
- Cross-project edges with distinct styling (dashed or different color)
- Click project cluster to expand/collapse
- Legend showing project colors and aliases

## Extended types
- `WorkspaceConfig` added to types.ts
- `Plan.project?: string` field added
- `PlanFrontmatter.depends_on` accepts qualified `project:id` strings
- `TrellisConfig` unchanged (workspace config is separate)
