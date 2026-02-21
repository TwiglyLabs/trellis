
## Steps
1. **Define result types in `src/core/types.ts`.**
   ```ts
   interface BlockingPlan { id: string; title: string; status: PlanStatus; blockingFactor: number; }
   interface StuckPlan { id: string; title: string; daysInStatus: number; lastContentUpdate?: Date; }
   interface LayerPressure { depth: number; blocked: number; inProgress: number; ratio: number; }
   interface HealthSummary {
     totalPlans: number; activePlans: number; blockedPlans: number;
     stuckPlans: number; highBlockingPlans: number; estimatedParallelism: number;
   }
   interface BottleneckResult {
     highBlockingPlans: BlockingPlan[];
     stuckPlans: StuckPlan[];
     stalePlans: Array<{ id: string; title: string; status: PlanStatus; daysInStatus: number }>;
     layerPressure: LayerPressure[];
     healthSummary: HealthSummary;
   }
   ```

2. **Add staleness config keys to `loadConfig()`.**
   Parse `stale_in_progress_days` (default 14) and `stale_not_started_days` (default 30) as integers. Add to `TrellisConfig`.

3. **Implement `computeBottlenecks()` in `src/bottlenecks.ts`.**
   Pure function: `(graph: GraphData, plans: Plan[], config: TrellisConfig) => BottleneckResult`.
   - **Blocking factor:** For each non-done/non-archived plan, BFS through `dependents` edges to count all transitively reachable plans. Sort by blocking factor descending, take top 10.
   - **Staleness:** For `in_progress` plans, compute days since `started_at`. For `not_started` plans, days since `not_started_at`. Flag as stale if past threshold.
   - **Stuck detection:** Subset of stale `in_progress` plans. If plan has `updatedAt` (from recency-metadata), only mark stuck if BOTH `started_at` and `updatedAt` are past threshold. If `updatedAt` is absent, use `started_at` alone.
   - **Layer pressure:** Assign plans to layers by topological depth from graph data. Per layer: count blocked and in_progress plans, compute ratio (blocked / max(inProgress, 1)). Sort by ratio descending.
   - **Health summary:** Aggregate counts from the computed data.

4. **Add `trellis bottlenecks` command (`src/features/bottlenecks/command.ts`).**
   Human-readable output: stuck plans with age, top blockers with fan-out count, layers under pressure. `--json` flag for full `BottleneckResult`.

5. **Export from library entry point.**
   Export `computeBottlenecks`, `BottleneckResult`, `HealthSummary` for Canopy.

## Testing
- **Blocking factor tests:** Single plan blocking a chain of 5 — blocking factor is 5. Two parallel chains of 3 from the same root — blocking factor is 6. Plan with no dependents — blocking factor is 0.
- **Staleness tests:** `in_progress` plan with `started_at` 15 days ago and threshold 14 — flagged stale. Same plan at 13 days — not stale. `not_started` plan at 31 days with threshold 30 — flagged. Config override: `stale_in_progress_days = 7` changes the threshold.
- **Stuck detection tests:** `in_progress` plan with old `started_at` but recent `updatedAt` — NOT stuck (active content edits). Same plan with old `updatedAt` — stuck. Plan without `updatedAt` field — falls back to `started_at` alone.
- **Layer pressure tests:** Layer with 4 blocked plans and 1 in_progress — ratio 4.0. Layer with 0 in_progress and 3 blocked — ratio 3.0 (uses max(inProgress, 1)). Layer with all plans done — ratio 0.
- **Health summary:** Verify all counts are correct against known plan set.
- **Empty graph:** No plans — all fields are zero/empty arrays.
- **Pure function verification:** Same inputs always produce same outputs. No filesystem or process access.

## Done-when
- `computeBottlenecks()` returns correct blocking factors, staleness flags, stuck detection, layer pressure, and health summary.
- Stuck detection uses `updatedAt` when available, falls back to `started_at` when not.
- Config keys `stale_in_progress_days` and `stale_not_started_days` are parsed and applied.
- `trellis bottlenecks` prints human-readable summary with `--json` option.
- Library exports for Canopy consumption.
- All computation is pure — tests use synthetic data with no filesystem access.
