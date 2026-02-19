# Implementation

## Steps

1. Define schema types — `PlanFile` enum (README, inputs, outputs, implementation), `SectionRequirement` mapping file → required headings, `StatusGate` mapping status → required files/sections. Add to `types.ts`.

2. Update scanner for directory-only plans — modify `scanPlans()` to only recognize directories with README.md as valid plans. Single `.md` files at the top level are ignored. Flatten plan ID derivation — directory name is the ID, no nested prefixes.

3. Add section detection — utility function `detectSections(content: string): string[]` that extracts `##` headings from markdown content. Used by lint and by status gate checks.

4. Implement status gate validation — `validateStatusGate(plan: Plan, targetStatus: PlanStatus): GateResult` that checks whether a plan meets the requirements for a given status transition. Returns pass/fail with list of specific missing requirements.

5. Integrate gates into `update` command — `trellis update <id> <status>` calls `validateStatusGate()` before writing. On failure, prints what's missing and exits with error. A `--force` flag bypasses gates.

6. Update config defaults — `plans_dir` defaults to `plans/` (flat). Remove any hardcoded `active/` assumptions in scanner and ID derivation.

## Testing

- Unit tests for `detectSections()` with various markdown formats (empty, nested headings, code blocks containing `##`)
- Unit tests for `validateStatusGate()` covering each transition and gate
- Integration tests: `trellis update` rejects transitions when gates aren't met
- Integration tests: `trellis update --force` bypasses gates
- Integration tests: scanner only picks up directory-format plans
- Fixture plans in directory format for all statuses

## Done-when

- `scanPlans()` only recognizes directory-format plans
- Section detection correctly identifies `##` headings in plan files
- Status transitions are gated — `trellis update` rejects transitions with missing requirements
- All existing tests updated to use directory-format fixtures
- Flat `plans/` layout is the default
