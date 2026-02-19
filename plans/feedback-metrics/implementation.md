# Implementation

## Steps

1. Add `not_started_at` timestamp to frontmatter handling — extend `PlanFrontmatter` type in `src/types.ts`, update `trellis update` in `src/api.ts` to auto-set `not_started_at` when transitioning to `not_started` (same pattern as `started_at`/`completed_at`). Clear on backward transitions.

2. Implement `trellis metrics` command — new file `src/commands/metrics.ts`. For each done plan, compute cycle time (`completed_at - started_at`), queue time (`started_at - not_started_at`), and collect plan lines, tags, epic. Output a summary table sorted by completion date. Add aggregate stats: median cycle time, total plans completed, plans per epic.

3. Add CLI flags — `--json` for structured output (canopy consumption), `--since <date>` to filter to a time range. Register command in `src/cli.ts`.

4. Add `sessions` and `deviation` frontmatter fields — extend `PlanFrontmatter` type. Add to `EDITABLE_FIELDS` in api.ts so `trellis set` can write them. `trellis metrics` reads these for aggregation.

5. Add retro.md convention — document the `retro.md` format in CLAUDE.md. `trellis metrics` reads `retro.md` if present and includes session count and deviation in the metrics table. No enforcement — just convention.

6. Wire into `trellis update <id> done` — when transitioning to done, prompt for session count and deviation (skip with `--yes`). Write values to frontmatter. This is the lightweight retro capture point.

## Testing

- `not_started_at` auto-set on transition to `not_started`, cleared on backward transition
- `trellis metrics` with zero done plans shows empty table
- `trellis metrics` computes correct cycle time and queue time from timestamps
- `--json` output matches expected schema (plan_id, cycle_time_hours, queue_time_hours, lines, tags, epic)
- `--since` filters plans by completion date
- `sessions` and `deviation` fields writable via `trellis set`, readable in metrics output
- Aggregate stats (median, totals) computed correctly

## Done-when

- `trellis metrics` command shows cycle time, queue time, and session data for completed plans
- `not_started_at` timestamp auto-managed by `trellis update`
- `--json` and `--since` flags work for machine consumption and filtering
- `sessions`/`deviation` fields captured at done transition and aggregated in metrics
- All existing tests still pass
