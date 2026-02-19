# Implementation

## Steps

1. Build the reusable claim workflow — `.github/workflows/trellis-claim.yml` with `workflow_call` trigger. Inputs: `plan_id`, `assignee`. Checkout, install trellis, validate transition, update frontmatter, commit, push. Handle push conflicts with one retry.

2. Build the consumer caller template — a minimal `workflow_dispatch` workflow that calls the reusable workflow. This is what agents trigger via `gh workflow run`. Document as a template in trellis README or a dedicated setup guide.

3. Add `trellis claim` CLI command — convenience wrapper that triggers the GitHub Action from the command line. Runs `gh workflow run claim-plan --field plan_id=<id> --field assignee=<name>`, then polls `gh run list` until the run completes. Reports success or failure. This is the primary interface for agents — they run `trellis claim <plan-id>` instead of raw `gh` commands.

4. Add concurrency handling to the workflow — if `git push` fails due to non-fast-forward (another claim landed first), pull and retry once. If the plan is already `in_progress` after pull, fail with a clear message: "Plan already claimed by <assignee>."

5. Document branch protection setup — step-by-step guide for configuring GitHub Branch Rulesets to allow the GitHub Actions bot to bypass PR requirements. Include screenshots or CLI commands (`gh api` calls to configure rulesets programmatically).

6. Add `trellis init` integration — when setting up a new repo, `trellis init` offers to install the consumer caller workflow and configure branch protection. Idempotent — safe to run on repos that already have the workflow.

## Testing

- Reusable workflow: claim succeeds for valid plan, rejects invalid plan ID, rejects non-`in_progress` status
- Consumer caller: `workflow_dispatch` triggers the reusable workflow correctly
- `trellis claim`: triggers workflow, polls for completion, reports result
- Concurrency: second simultaneous claim fails with clear message
- Push retry: handles non-fast-forward with one retry
- Status gates: claim rejected if plan doesn't meet gate requirements (e.g., draft plan without implementation.md can't go to in_progress)
- Idempotent: claiming an already-claimed plan (same assignee) is a no-op or clear message
- `trellis init`: installs consumer workflow, doesn't overwrite existing

## Done-when

- Reusable claim workflow in trellis repo, callable by consumer repos
- Consumer caller template documented and installable via `trellis init`
- `trellis claim <plan-id>` works as a CLI command (triggers GitHub Action, waits for result)
- Concurrent claims handled safely (no race conditions, clear error messages)
- Branch protection documentation covers GitHub Rulesets bypass setup
- An agent can run `trellis claim plan-schema` and see the plan marked in_progress on the stable branch within ~30 seconds
