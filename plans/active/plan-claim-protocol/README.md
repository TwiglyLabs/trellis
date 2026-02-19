---
title: Plan Claim Protocol
status: draft
depends_on:
  - active/plan-schema
tags: [cross-repo, workflow, agent, plan-management]
description: Reusable GitHub Actions workflow for agents to safely claim plans without PR bypass
---

# Plan Claim Protocol

A distributed locking mechanism for plan ownership. Agents claim plans by triggering a GitHub Action that commits the status change directly to the stable branch — no credentials exposed, no PR bypass needed.

## Problem

When agents work on plans, they need to signal "I'm working on this" so other agents (and humans) don't pick up the same plan. This status change needs to land on the stable branch (main or develop) because that's what `trellis ready` resolves against — both locally and across repos.

But stable branches have branch protection: PRs required, reviews required. An agent can't just push a status commit. And giving agents credentials to bypass protection is a security risk — the agent could use those credentials for unintended operations.

## Approach

### Reusable GitHub Actions workflow

A workflow maintained in the trellis repo that other repos reference. The workflow:

1. Accepts `plan_id`, `status` (restricted to `in_progress`), and `assignee` as inputs
2. Checks out the stable branch
3. Runs `trellis update <plan_id> in_progress` (which validates the transition via status gates)
4. Sets `assignee` in frontmatter
5. Commits and pushes to the stable branch
6. Uses the workflow's `GITHUB_TOKEN` — which has `contents: write` but never leaves the runner

```yaml
# In trellis repo: .github/workflows/trellis-claim.yml
name: Claim Plan
on:
  workflow_call:
    inputs:
      plan_id:
        required: true
        type: string
      assignee:
        required: true
        type: string
    outputs:
      previous_status:
        value: ${{ jobs.claim.outputs.previous_status }}

permissions:
  contents: write

jobs:
  claim:
    runs-on: ubuntu-latest
    outputs:
      previous_status: ${{ steps.claim.outputs.previous_status }}
    steps:
      - uses: actions/checkout@v4
      - name: Install trellis
        run: npm install -g @twiglylabs/trellis
      - name: Claim plan
        id: claim
        run: |
          previous=$(trellis show ${{ inputs.plan_id }} --json | jq -r '.status')
          trellis update ${{ inputs.plan_id }} in_progress
          trellis set ${{ inputs.plan_id }} assignee ${{ inputs.assignee }}
          echo "previous_status=$previous" >> "$GITHUB_OUTPUT"
      - name: Commit and push
        run: |
          git config user.name "trellis-bot"
          git config user.email "trellis-bot@twiglylabs.com"
          git add plans/
          git commit -m "claim: ${{ inputs.plan_id }} -> in_progress (${{ inputs.assignee }})"
          git push
```

### Consumer repos

Each repo that uses the claim protocol has a thin caller workflow:

```yaml
# .github/workflows/claim-plan.yml
name: Claim Plan
on:
  workflow_dispatch:
    inputs:
      plan_id:
        required: true
        type: string
      assignee:
        required: true
        type: string

jobs:
  claim:
    uses: twiglylabs/trellis/.github/workflows/trellis-claim.yml@main
    with:
      plan_id: ${{ inputs.plan_id }}
      assignee: ${{ inputs.assignee }}
```

### Agent workflow

An agent claims a plan via the GitHub CLI:

```bash
gh workflow run claim-plan --field plan_id=plan-schema --field assignee=agent-1
```

Then polls for completion:

```bash
gh run list --workflow=claim-plan --limit=1 --json status,conclusion
```

Once the claim succeeds, the agent creates a feature branch and begins work.

### Completion flow

Plan completion does NOT use the claim protocol. When an agent finishes work, the PR that merges the feature branch includes `status: done` in the frontmatter diff. This goes through normal review and branch protection. The PR merge is the "release" of the lock.

### Branch protection setup

GitHub Branch Rulesets must allow the GitHub Actions bot to push to the stable branch:

- Create a ruleset for the stable branch (main or develop)
- Require PRs for all pushes
- Add "GitHub Actions" as a bypass actor
- The claim workflow's `GITHUB_TOKEN` inherits this bypass

### Concurrency safety

Two agents claiming the same plan simultaneously: the second `git push` fails (non-fast-forward). The workflow retries once with a fresh pull. If it still fails (plan already claimed), it exits with an error and the agent sees a failed workflow run.

### Scope restriction

The claim workflow only accepts `in_progress` as the target status. It cannot set `done`, `archived`, or move backward. This limits the blast radius — even if an agent triggers claims aggressively, the worst case is plans marked in_progress, which is visible and reversible.
