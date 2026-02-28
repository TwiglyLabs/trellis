---
title: Convert MCP read tools to structured text responses
status: done
description: >-
  Replace JSON responses with compact structured text for all read-only MCP
  tools. Merge trellis_ready into trellis_status. Strip redundant data from
  trellis_show and trellis_graph. Target ~75% token reduction.
tags:
  - mcp
  - optimization
  - tokens
type: refactor
not_started_at: '2026-02-24T04:23:58.253Z'
started_at: '2026-02-24T23:45:37.900Z'
completed_at: '2026-02-25T00:21:13.942Z'
---

## Problem
MCP read tools return verbose JSON that scales linearly with plan count. A 139-plan project produces ~14.3k tokens for `trellis_status` alone. Key waste:

1. **Done/archived plans get full serialization** — 90+ done plans with descriptions, tags, types that agents never use
2. **`JSON.stringify(result, null, 2)`** — 2-space indentation + null fields add ~20% overhead
3. **`trellis_show` includes full plan body** — 60% of its response is markdown content agents fetch separately via `read_section`
4. **`trellis_graph` duplicates `trellis_status`** — nodes array carries title, status, tags, blocked, ready for every plan
5. **`trellis_ready` is redundant** — it's just a filtered view of status

This will get worse as the project grows. Every MCP call eats context window budget that could be used for reasoning.
## Approach
Replace JSON serialization with compact structured text for all 6 read-only MCP tools. Merge `trellis_ready` into `trellis_status`. Strip body from `trellis_show`. Remove nodes duplication from `trellis_graph`.

**Format:** Structured markdown/plain text optimized for LLM consumption. LLMs read natural language more efficiently than parsing JSON objects.

**Mutation tools unchanged:** `create`, `set`, `update`, `write_section`, `write_sections` already return small payloads and stay as JSON.

**Tool changes:**

| Tool | Change |
|------|--------|
| `trellis_status` | Absorbs `trellis_ready`. Compact text dashboard. Done collapsed to IDs. Archived omitted. |
| `trellis_ready` | **Removed** — merged into status |
| `trellis_show` | Strips body, fileHashes, completeness, contracts. Text format. |
| `trellis_graph` | Removes nodes array. Edges + chunks only. Text format. |
| `trellis_lint` | Text format, same data. |
| `trellis_bottlenecks` | Text format, same data. |

**Estimated impact:** ~75% token reduction across read tools.

## Steps

### 1. Add text formatter module

Create `src/core/format.ts` with one formatter function per read tool. Each takes the existing compute result and returns a plain string.

**Critical constraint:** No changes to compute functions or their return types. Formatters select and format the fields they need; unused fields are simply ignored. The compute layer is shared with CLI commands — modifying it would break CLI output.

### 2. Convert `trellis_status` to text + absorb `trellis_ready`

In `mcp.ts` status handler: call both `computeStatus()` and `computeReady()` (they share the same GraphData context), pass both results to `formatStatus()`.

Remove `trellis_ready` tool registration from MCP server. Update `trellis_status` tool description to mention the `Next` recommendation.

**Breaking change:** Any CLAUDE.md files, agent configs, or skill files referencing `trellis_ready` will need updating. At minimum update this project's CLAUDE.md, `docs/for-agents.md`, and `docs/mcp-reference.md`.

`formatStatus(status: StatusResult, ready: ReadyResult): string`

```
# my-project (15 plans)
Next: plan-auth-layer

## In Progress (2)
- api-redesign: Redesign API layer [alice]
- db-migration: Migrate to PostgreSQL

## Ready (3)
- plan-auth-layer: Add authentication layer
- plan-cache: Implement caching [bob]
- plan-logging: Structured logging

## Blocked (2)
- plan-deploy: Deploy pipeline (waiting on: api-redesign, db-migration)
- plan-monitoring: Add monitoring (waiting on: plan-logging)

## Draft (1)
- plan-v2: Version 2 planning

## Done (7)
plan-a, plan-b, plan-c, plan-d, plan-e, plan-f, plan-g
```

Format rules:
- Header: `# {project} ({total} plans)` — when tag filter active, append ` (tag: {tag})`
- `Next: {id}` from ReadyResult.next (omit line if null)
- Show `⚠ {overBudget} chunks over budget` only when overBudget > 0
- Sections in order: In Progress, Ready, Blocked, Draft, Done. **Omit empty sections.**
- Plan line: `- {id}: {title}` + ` [{assignee}]` if present
- Blocked plans append ` (waiting on: {ids})`
- Done section: IDs only, comma-separated
- Archived: omitted entirely

### 3. Convert `trellis_show` to text

`formatShow(result: ShowResult): string`

```
# Add authentication layer (plan-auth-layer)
Status: not_started (ready)
Type: feature
Tags: auth, security
Assignee: alice

Implement JWT-based authentication with refresh tokens

## Dependencies
✓ plan-db-schema (done)
○ plan-user-model (in_progress)

## Blocks
plan-deploy, plan-api-v2

## Critical Path
plan-user-model → plan-auth-layer → plan-deploy
```

Format rules:
- Header: `# {title} ({id})`
- Status with annotation: `(ready)`, `(blocked)`, or plain
- Type, Tags, Assignee, Repo: one per line, only when present
- Description as plain paragraph (if present)
- Dependencies: `✓` for satisfied (`DependencyInfo.satisfied`), `○` for unsatisfied, with status in parens. Omit section if no dependencies.
- Blocks: comma-separated IDs. Omit if empty.
- Critical path: `→`-separated chain. Omit if single node.
- **Ignored fields** (present in ShowResult, not formatted): body, fileHashes, completeness, inputs, outputs, updatedAt, startedAt, completedAt, filePath

**No changes to `computeShow()` or `ShowResult` type.**

### 4. Convert `trellis_graph` to text

`formatGraph(result: GraphResult): string`

```
# my-project dependency graph

## Edges
plan-a → plan-b
plan-a → plan-c
plan-b → plan-d

## Chunks
### chunk-1 (3 plans, 450 lines)
Plans: plan-a, plan-b, plan-d
Roots: plan-a | Leaves: plan-d

### chunk-2 (2 plans, 280 lines)
Plans: plan-c, plan-e
Roots: plan-c | Leaves: plan-e

## Cross-chunk Edges
plan-c (chunk-2) → plan-d (chunk-1)
```

Format rules:
- Header with project name
- Edges: one `from → to` per line. Omit section if no edges.
- Chunks: subheading with plan count and total lines, then plans/roots/leaves
- Cross-chunk edges with chunk annotations. Omit section if none.
- **Ignored:** `nodes` array — present in GraphResult, not formatted. No changes to `computeGraph()` or `GraphResult`.

### 5. Convert `trellis_lint` to text

`formatLint(result: LintResult): string`

```
# Lint (2 errors, 1 warning)

## Errors
- plan-orphan: Missing dependency "plan-deleted"
- plan-cycle: Dependency cycle detected

## Warnings
- plan-old: Stale frontmatter (no freshness date)

## Auto-fixed
- plan-fixed: Normalized status field

ok: false
```

Format rules:
- Header with error/warning counts
- Merge `structural.errors` into errors, `structural.warnings` into warnings
- Each issue: `- {planId}: {message}`
- Auto-fixed section: omit if empty
- Final `ok: true` or `ok: false` line

### 6. Convert `trellis_bottlenecks` to text

`formatBottlenecks(result: BottleneckResult): string`

```
# Bottlenecks

## High Blocking
- api-redesign: blocks 8 transitively (in_progress)
- db-migration: blocks 5 transitively (in_progress)

## Stuck
- plan-auth: 14 days in in_progress
- plan-cache: 9 days in not_started

## Stale
- plan-v1-compat: 30 days in draft

## Health
15 total, 8 active, 3 blocked, 2 stuck, parallelism: 3
```

Format rules:
- Sections: High Blocking, Stuck, Stale. Omit empty sections.
- LayerPressure: omit (low value-to-tokens ratio for agents)
- Health summary as single comma-separated line

### 7. Update tests

- Update MCP integration tests: replace `JSON.parse(result.content[0].text)` assertions with text content assertions (e.g., `expect(text).toContain('## Ready')`)
- Add formatter unit tests in `src/__tests__/format.test.ts` — one describe block per formatter
- Test edge cases: empty plan sets, single plan, no blocked plans, all done, tag filter active, null next

### 8. Update documentation + migration

- Update `docs/mcp-reference.md` with new response formats and example outputs
- Remove `trellis_ready` from `docs/mcp-reference.md`, `docs/for-agents.md`, and CLAUDE.md
- Update `trellis_status` description in CLAUDE.md to mention `Next` recommendation
- Error responses unchanged: `{ isError: true, content: [{ type: 'text', text: message }] }`
