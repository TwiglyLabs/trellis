
## Exports

### MCP read-only tools — `src/mcp.ts`

Five new tools added to the trellis MCP server:

| Tool | Wraps | Input |
|---|---|---|
| `trellis_status` | `computeStatus()` | `{ tag?: string }` |
| `trellis_ready` | `computeReady()` + `pickNext()` | none |
| `trellis_show` | `computeShow()` | `{ plan_id: string }` |
| `trellis_graph` | `computeGraph()` | none |
| `trellis_lint` | `computeLint()` | `{ strict?: boolean }` |

Each tool creates a fresh context per call (stateless). Agents can query graph state without CLI shell access.
