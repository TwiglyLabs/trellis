
## Steps
1. **Add `SectionScore`, `CompletenessResult` types to `src/core/types.ts`.**
   ```ts
   interface SectionScore {
     score: 0 | 50 | 100;
     wordCount: number;
     reason: 'missing' | 'placeholder' | 'thin' | 'complete';
   }
   interface CompletenessResult {
     sections: Record<string, SectionScore>;
     aggregate: number; // 0–100
   }
   ```
   Add `completeness: CompletenessResult` to the `Plan` interface.

2. **Create `src/completeness.ts` with `computeCompleteness()`.**
   Pure function: `(plan: Plan, config: TrellisConfig, type?: string) => CompletenessResult`. Define `DEFAULT_THRESHOLDS` constant with low/high per section (Problem, Approach, Steps, Testing, Done-when). Check config for override keys (`completeness_problem_low`, `completeness_problem_high`, etc.). For each expected section at the plan's current status: detect placeholders (TBD, TODO, FIXME, placeholder, coming soon, whitespace-only), count words, assign score (0/50/100). Compute aggregate as mean of applicable section scores.

3. **Add completeness config keys to `loadConfig()` in scanner.**
   Parse optional flat keys: `completeness_problem_low`, `completeness_problem_high`, `completeness_approach_low`, `completeness_approach_high`, `completeness_steps_low`, `completeness_steps_high`, `completeness_testing_low`, `completeness_testing_high`, `completeness_done_when_low`, `completeness_done_when_high`. Add to `TrellisConfig` as `completenessThresholds?: Record<string, number>`.

4. **Call `computeCompleteness()` from `scanPlans()`.**
   After assembling each Plan object and reading its file contents, call `computeCompleteness()` and attach the result. The function needs the plan's body content and implementation.md content — both are already available at scan time.

5. **Include `completeness` in `show --json` output.**
   Add the `CompletenessResult` object to the show command's JSON output.

6. **Add `--completeness` flag to `trellis lint`.**
   When flag is present, run `computeCompleteness()` on each plan and emit warnings for sections scoring 0 ("stub") or 50 ("thin"). Follow existing lint warning pattern. Non-fatal unless `--strict` is also passed.

7. **Export from library entry point (`src/index.ts`).**
   Export `computeCompleteness`, `CompletenessResult`, `SectionScore` for Canopy consumption.

## Testing
- **computeCompleteness unit tests (`tests/completeness.test.ts`):** Test with plan containing full sections (all score 100), stub sections (score 0), thin sections (score 50). Test placeholder detection: `TBD`, `TODO`, `FIXME` all force score 0. Test whitespace-only section body scores 0. Test missing section scores 0.
- **Threshold tests:** Override thresholds via config, verify scores change accordingly. Default thresholds produce expected scores for known word counts.
- **Aggregate tests:** Plan with 3 sections scoring 100/50/0 has aggregate of 50. Plan at `draft` status only counts Problem section in aggregate (other sections not yet expected).
- **Scanner integration tests:** After `scanPlans()`, verify every `Plan` has a `completeness` field with valid `sections` and `aggregate`.
- **Lint tests:** `trellis lint --completeness` on a plan with stub Problem emits a warning. Without `--completeness`, no completeness warnings appear. With `--strict --completeness`, stub sections cause exit code 1.
- **Edge cases:** Plan with no implementation.md (draft) — only README sections scored. Empty plans directory — no errors. Config with partial threshold overrides — overridden values used, others default.

## Done-when
- Every `Plan` from `scanPlans()` has a `completeness` field with per-section scores and aggregate.
- Placeholder detection correctly identifies TBD/TODO/FIXME/whitespace stubs.
- Config keys allow overriding default thresholds.
- `trellis lint --completeness` surfaces thin/stub warnings.
- `show --json` includes completeness data.
- Library exports for Canopy consumption.
- All new and existing tests pass.
