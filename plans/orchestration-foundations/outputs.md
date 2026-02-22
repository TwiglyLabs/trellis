
## Exports

### `--json` flag on all commands

Structured JSON output on stdout for `ready`, `show`, `update`, `lint`, `graph`, `status`. Pretty-printed with 2-space indent.

### `trellis ready --next` / `pickNext()`

Single highest-priority plan selection based on forward path depth in the dependency graph.

### Status filtering defaults

Done/archived plans hidden by default in `trellis status`. `--all`, `--done`, `--archived` flags for explicit inclusion.

### Epic tracking via tags

`trellis status --tag epic:name` filters by tag prefix. Epic completion derived from constituent plan statuses.

### Exit code contract

Exit 0 on success, exit 1 on error. Errors on stderr (JSON when `--json`).
