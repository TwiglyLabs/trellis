---
title: Convert MCP read tools to structured text responses
status: in_progress
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

Create `src/core/format.ts` with formatter functions for each response type. Each takes the compute result and returns a plain string. This keeps formatting separate from business logic.

### 2. Convert `trellis_status` to text + absorb `trellis_ready`

- Modify `computeStatus()` result to include `next` recommendation (from `computeReady`)
- Write `formatStatus()` in format.ts:
  - Header line: `# {project} ({total} plans)`
  - `Next: {id}` line (the ready recommendation)
  - Sections: Ready, In Progress, Blocked (with `waiting on:` suffixes), Draft
  - Done section: IDs only, comma-separated
  - Archived: omitted entirely
  - Optional fields (assignee, description) only when present
- Update `mcp.ts` status handler to return `text` instead of `JSON.stringify`
- Remove `trellis_ready` tool registration from MCP server
- Update MCP tool descriptions

### 3. Convert `trellis_show` to text

- Write `formatShow()` in format.ts:
  - Plan title as heading
  - Description line
  - Status with ready/blocked annotation
  - Type, tags, assignee (only when present)
  - Dependencies with checkmarks (✓ done, ○ pending)
  - Blocks list + critical path
- Remove from ShowResult: `body`, `fileHashes`, `completeness`, `inputs`, `outputs`, `updatedAt`
- Update `computeShow()` in logic.ts to stop computing removed fields

### 4. Convert `trellis_graph` to text

- Write `formatGraph()` in format.ts:
  - Header line with project name
  - Edges section: `from → to` lines
  - Chunks section: plan lists with roots/leaves, line counts
  - Cross-chunk edges
- Remove `nodes` array from `computeGraph()` result
- Keep `edges` and `chunks` in compute result (just format differently)

### 5. Convert `trellis_lint` to text

- Write `formatLint()` in format.ts:
  - Header: `# Lint: {project} ({errors} errors, {warnings} warnings)`
  - Errors section with plan ID + message
  - Warnings section
  - Auto-fixed section
  - `ok` boolean becomes presence/absence of errors

### 6. Convert `trellis_bottlenecks` to text

- Write `formatBottlenecks()` in format.ts:
  - High blocking plans with transitive count
  - Stuck plans with days in status
  - Stale plans
  - Health summary line

### 7. Update tests

- Update MCP integration tests to expect text responses
- Add formatter unit tests for each format function
- Test edge cases: empty plan sets, single plan, no blocked plans

### 8. Update CLI text output (if shared)

- Check if CLI commands share formatting with MCP — if so, decide whether CLI should also use new formatters or keep existing format
- CLI and MCP may diverge here since CLI has color/terminal considerations

### 9. Update documentation

- Update `docs/mcp-reference.md` with new response formats
- Update CLAUDE.md if MCP tool descriptions changed
- Remove `trellis_ready` from docs
