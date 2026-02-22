
## Exports

### `Plan.updatedAt: Date`

Maximum mtime across all plan files (README.md, implementation.md, inputs.md, outputs.md), computed during `scanPlans()`.

### `Plan.fileHashes: Record<string, string>`

SHA-256 content hash (truncated hex) per plan file. Enables distinguishing real content changes from touch-without-edit.

### `computeRecentActivity(plans, since)` — `src/recency.ts`

Returns `RecentActivity { contentChanged, statusChanged, newlyCreated }` — plans modified after the cutoff date, sorted by `updatedAt` descending.

### `trellis recent` command

`trellis recent [--days N] [--json]` — lists plans modified in the last N days (default 1). Machine-readable output via `--json`.

### Library exports

`RecentActivity` type and `computeRecentActivity` exported from `src/index.ts`.
