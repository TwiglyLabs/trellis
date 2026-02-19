# Implementation

## Steps

1. Add section detection utility — `detectSections(content: string): string[]` returning `##` heading texts. Likely already exists from plan-schema implementation. Import and reuse.

2. Implement file layout lint checks — check each plan is a directory with README.md. Check for inputs.md when depends_on is non-empty, outputs.md when plan has dependents.

3. Implement section lint checks — for each plan file that exists, verify required sections are present based on plan status. Use the schema's section requirements mapping.

4. Implement status gate compliance check — for each plan, verify its current status satisfies all gates. This catches retroactive violations from manual edits.

5. Remove existing contract checks — the current contract-related lint checks (missing outputs.md, inputs.md reference validation, `contract_coverage` metric) are superseded by the structural checks. Remove them to avoid duplicate warnings.

6. Implement `--fix` — for each fixable structural error: create missing implementation.md with `## Steps` / `## Testing` / `## Done-when` headings, add missing `## Problem` / `## Approach` headings to README.md, create missing inputs.md / outputs.md with template headings. Report what was fixed. Do not overwrite existing content.

7. Integrate into lint command — add "Structure" check category alongside existing cycle/dependency/frontmatter checks. Update `--json` schema to include `structural` key. Drop `contract_coverage` from JSON output. Update exit code logic.

## Testing

- File layout checks: missing README.md, single-file plan, missing inputs/outputs when expected
- Section checks: each required section missing for each applicable status
- Gate compliance: plan at `not_started` without implementation.md, plan at `done` without outputs.md when it has dependents
- `--fix`: creates missing files with correct headings, adds missing sections, leaves existing content intact
- Reconciliation: verify old contract checks are gone, no duplicate warnings
- Integration: `trellis lint` output includes structural issues, `--json` includes them, exit codes correct

## Done-when

- `trellis lint` catches all structural violations defined in the plan schema
- Existing lint checks (cycles, deps, frontmatter) still work unchanged
- Old contract checks fully replaced by structural checks — no duplicates
- `--fix` scaffolds missing files and sections without overwriting existing content
- `--json` output includes structural violations under `structural` key
- No false positives on well-formed plans
