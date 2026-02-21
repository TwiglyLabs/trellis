---
title: MCP Read Tools for Agent Self-Sufficiency
status: not_started
description: >-
  Add trellis_status, trellis_ready, trellis_show, trellis_graph to MCP so
  agents can query graph state without CLI
tags:
  - mcp
  - agents
not_started_at: '2026-02-21T01:48:51.321Z'
---

## Problem
The Trellis MCP server is write-heavy. Agents can create plans, update content, and transition status — but they cannot query the graph. There are no read tools.

This creates a blind spot in agent workflows:

- An agent refining a plan cannot ask "what depends on this?" or "is this plan blocking anything?" without shelling out to the CLI.
- An agent choosing what to work on next cannot ask "what is ready?" or "what does the graph look like right now?" through MCP.
- A review agent cannot ask "are there any lint warnings on this plan?" without a subprocess call.

Shelling out to `trellis ready --json` or `trellis show plan-id --json` from inside an agent is fragile: it assumes the binary is on PATH, it adds subprocess latency, and it breaks in sandboxed environments where shell access is restricted.

The MCP server already has everything it needs. `createContext()` is called on startup and can be refreshed — the plan graph is resident in memory. The compute functions (`computeStatus`, `computeReady`, `computeShow`, `computeGraph`, `computeLint`) already implement all the query logic. The data is there. The logic is there. There are just no tool wrappers exposing them.

For Canopy's agent orchestration, this gap is concrete: agents need graph awareness to make good decisions. Which plan is the critical-path bottleneck? What is the next recommended plan to work on? What plans are in a bad state? Without MCP read tools, agents must either shell out (fragile) or operate blind (poor decisions).
## Approach
Add read-only query tools to the existing MCP server in `src/mcp.ts`. Each tool wraps an existing compute function — no new logic, just new MCP-facing interfaces.

### New tools

**`trellis_status`**
Returns a summary of all plans grouped by status: counts per status, and a flat list of plans with their key fields (id, title, status, tags, assignee). Optional filters: `tag` (string) to filter by tag prefix, so callers can scope to a single epic.

**`trellis_ready`**
Returns the list of plans that are ready to work on (not blocked, not done/archived). Includes the `next` recommendation from `pickNext()` — the highest-priority plan by forward path depth. This is the primary tool an orchestrator uses to decide what to delegate next.

**`trellis_show`**
Takes a required `plan_id`. Returns the full plan detail: title, status, tags, assignee, description summary, dependencies (what it depends on), dependents (what depends on it), blocking status, and position on the critical path. Wraps `computeShow()`. This is what an agent uses to understand its own context before starting work.

**`trellis_graph`**
Returns the full graph as nodes and edges: each node has id, title, status, tags; each edge is a `[from, to]` dependency pair. Intended for visualization pipelines or agents doing their own graph analysis (e.g., finding clusters, computing depth).

**`trellis_lint`**
Returns validation results: a list of issues (plan id, severity, message) and a summary count. Wraps `computeLint()`. Useful for a review agent that wants to check plan health before promoting status.

### Context freshness

The MCP server is stateless: each tool call creates a fresh context via `createContext()`. This keeps the implementation simple, avoids cache staleness bugs, and is fast enough for typical plan counts (scanning 20-50 plans is sub-100ms). If performance becomes a concern at scale, caching with explicit invalidation can be added as a follow-up.

### Implementation steps

1. Add `trellis_status` tool wrapping `computeStatus()` output.
2. Add `trellis_ready` tool wrapping `computeReady()` + `pickNext()`.
3. Add `trellis_show` tool wrapping `computeShow()`, requiring `plan_id` in input schema.
4. Add `trellis_graph` tool wrapping `computeGraph()`, returning nodes + edges arrays.
5. Add `trellis_lint` tool wrapping `computeLint()`, returning issues array + summary.
6. Write MCP integration tests for each tool using the existing `server._registeredTools[name].handler(args, {})` pattern.
7. Update `docs/mcp-reference.md` with schemas and examples for all new tools.

### Input schemas (Zod)

- `trellis_status`: `{ tag: z.string().optional() }`
- `trellis_ready`: no inputs
- `trellis_show`: `{ plan_id: z.string() }`
- `trellis_graph`: no inputs
- `trellis_lint`: `{ strict: z.boolean().optional() }`
