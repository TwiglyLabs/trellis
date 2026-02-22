
## From plans

### cross-repo-graph
- Qualified plan IDs (`repo:plan-id`), `parseQualifiedId()`
- `createContext()` with unified cross-repo graph
- Write guard for remote plans (`plan.repoAlias != null`)

### cross-repo-manifest
- `ProjectManifest` type and `parseManifest()`
- `buildReposArray()` for constructing `RepoSpec[]` from manifest

### mcp-read-tools
- MCP read tools (`trellis_status`, `trellis_ready`, `trellis_show`, `trellis_graph`, `trellis_lint`) — the tool surface to extend with multi-repo support
