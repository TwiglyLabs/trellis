# Implementation

## Steps

1. **Add `--project` option to Commander commands** — add `.option('--project', 'Show plans from all repos')` to `status`, `ready`, `graph`, `lint`. Accepted but no-op on `show` (already handles qualified IDs).

2. **Update `trellis status`** — when `--project`: group plans by `plan.repoAlias ?? '(local)'`, display repo header before each group, show per-repo and total counts. JSON output adds `repos` field.

3. **Update `trellis ready`** — when `--project`: list ready plans from all repos, prefix each with repo alias. `--next` still local-only. JSON output includes `repo` field per plan.

4. **Update `trellis graph`** — when `--project`: JSON output adds `repo` field per node, annotates cross-repo edges. Text output summarizes cross-repo relationships.

5. **Update `trellis lint`** — when `--project`: run lint rules across all repos' plans, group errors/warnings by repo. Include cross-repo-specific checks (e.g., remote plan references deleted local plan).

6. **Update JSON schemas** — add `repo: string | null` field to plan objects in all `--json` outputs. Add top-level `repos` summary field when `--project` is used.

## Testing

- **Status `--project`**: groups by repo, shows per-repo counts, cross-repo blockers visible
- **Ready `--project`**: lists ready plans across repos with alias prefix, `--next` local-only
- **Graph `--project`**: JSON has `repo` field per node, cross-repo edges annotated
- **Lint `--project`**: errors/warnings grouped by repo
- **JSON schemas**: all `--json` outputs include `repo` field, `--project` adds `repos` summary
- **Without `--project`**: all commands behave as before (no regression)
- **No manifest configured**: `--project` warns and falls back to local-only display

## Done-when

- `--project` flag accepted on `status`, `ready`, `graph`, `lint`
- Status groups plans by repo with per-repo counts
- Ready lists cross-repo ready plans with alias prefix
- Graph JSON includes `repo` field and annotated cross-repo edges
- Lint groups errors/warnings by repo when `--project` set
- All `--json` outputs include `repo` field on plan objects
- Without `--project`, all commands behave identically to pre-change (no regression)
- No manifest configured + `--project` warns and shows local-only
