# `plan-review` Skill Design

## Purpose

Orchestrate multi-agent review of a trellis plan set using chunks as the unit of work. Produces structured findings for consistency, correctness, dependency coherence, and scope/feasibility.

## Invocation

```
/plan-review              # review all chunks in current project
/plan-review core-data    # review a single chunk
/plan-review --recheck    # only re-review chunks with stale or failing reports
```

## Three-Phase Architecture

### Phase 1: Chunk Reviews (parallel)

For each chunk, dispatch a `sonnet-general-purpose` subagent via the Task tool. All chunk agents run in parallel.

**Each subagent receives:**

- The chunk's plan IDs and file paths (from `trellis chunks --json`)
- The chunk's internal dependency edges
- The cross-chunk edges touching this chunk (so the agent knows what external contracts it depends on or exposes)

**Subagents read plan files themselves** using the Read tool with the `filePath` values from the chunks JSON. This avoids bloating the Task prompt with inline file content and lets agents handle large plans gracefully within their own context windows.

**Each subagent runs four review passes:**

1. **Contract alignment** — Do implementation plans match their contract specs? Missing fields, wrong types, contradictory behavior?
2. **Dependency coherence** — Are `depends_on` edges correct? Missing dependencies? Unnecessary edges? Circular implicit dependencies?
3. **Internal consistency** — Do plans within the chunk agree on types, naming, APIs, assumptions? Are there contradictions?
4. **Scope & feasibility** — Is each plan reasonably sized? Is anything obviously missing? Are there plans that should be split or merged?

**Each subagent produces:**

```json
{
  "chunkId": "core-data",
  "generatedAt": "2026-02-14T10:30:00Z",
  "plansReviewed": ["contracts/core-types", "implementation/core-extraction"],
  "findings": [
    {
      "type": "inconsistency | missing_dep | unnecessary_dep | contract_gap | scope_issue | missing_plan",
      "severity": "error | warning | info",
      "plans": ["contracts/core-types", "implementation/core-extraction"],
      "description": "core-types defines PersonRecord but core-extraction references PersonEntity",
      "suggestion": "Align naming to PersonRecord in core-extraction",
      "category": "contract_alignment | dependency_coherence | internal_consistency | scope_feasibility"
    }
  ],
  "summary": "6 plans reviewed. 2 errors, 3 warnings. Main issue: naming divergence.",
  "boundaryNotes": [
    {
      "planId": "implementation/store-refactor",
      "direction": "exposes",
      "description": "Defines StoreInterface that downstream plans consume"
    }
  ]
}
```

`boundaryNotes` (optional) captures free-text observations about what the chunk provides to or requires from other chunks. These are prose notes — not structured interface names — because plan files are informal specs where interface names may be inconsistent, narrative, or absent. Phase 2 uses these notes as hints and falls back to reading actual plan text when they're insufficient.

### Phase 2: Cross-chunk Synthesis (orchestrator)

The orchestrator (running in the main context, using `opus-general-purpose` for the synthesis call if chunks > 3) reads:

- All chunk summaries and boundary notes
- The `crossChunkEdges` from `trellis chunks --json`

It checks:

- **Boundary compatibility:** For each cross-chunk edge, do the boundary notes from both sides agree on what's being exchanged? If notes are missing or ambiguous, the orchestrator reads the specific plan files at that boundary (just the plans on either side of the edge, not the whole chunk).
- **Summary consistency:** Are there contradictions between chunk summaries? (e.g., one chunk assumes auth is JWT-based, another assumes session-based)
- **Coverage gaps:** Are there boundary notes describing consumed interfaces that no other chunk exposes?

### Phase 3: Cleanup & Final Report

#### 3a: Clean stale artifacts

Before writing new reports, delete any cached chunk reports in `plans/.review/chunks/` whose chunk membership has changed (different plan IDs than the cached report's `plansReviewed`) or whose member plans have been modified since the report's `generatedAt` timestamp.

#### 3b: Deduplicate findings

Merge all findings from Phase 1 + Phase 2. Two findings are duplicates if they share the same `type`, same set of `plans` (order-independent), and same `category`. When duplicates exist (e.g., two chunks both flag the same cross-boundary issue), keep the finding with the higher severity and the more specific description.

Sort final findings by severity (error > warning > info), then alphabetically by first plan ID.

#### 3c: Write reports

Write the structured and human-readable reports (see Output Location).

## Output Location

```
plans/.review/
  latest.json             # full structured report
  latest.md               # human-readable summary
  chunks/
    core-data.json         # per-chunk report (cached for --recheck)
    cloud-stack.json
```

**Gitignore policy:** `plans/.review/` must be in `.gitignore`. Review artifacts are ephemeral — they reflect a point-in-time analysis and go stale as plans evolve. The `--recheck` optimization is local-only. On first run, the skill auto-adds `plans/.review/` to `.gitignore` if the entry is missing.

### Human-Readable Report Format (`latest.md`)

```markdown
# Plan Review Report
Generated: 2026-02-14T10:30:00Z
Chunks reviewed: 3 | Plans reviewed: 22

## Errors (4)

### contracts/core-types + implementation/core-extraction
- **[Contract Alignment]** core-types defines `PersonRecord` but core-extraction references `PersonEntity`
  Suggestion: Align naming to `PersonRecord`

### implementation/cloud-api
- **[Missing Dependency]** References auth middleware but doesn't depend on auth-service
  Suggestion: Add `depends_on: [implementation/auth-service]`

## Warnings (6)
...

## Info (2)
...

## Cross-Chunk Findings (1)
- **[Boundary Mismatch]** store-refactor (core-data) describes "StoreInterface" but http-store-adapter (cloud-stack) expects "StorageAdapter"
```

## --recheck Behavior

When `--recheck` is passed:

1. Read existing `plans/.review/chunks/*.json` reports
2. Determine staleness per chunk — a cached report is stale if:
   - Any member plan's file has been modified since the report's `generatedAt` timestamp
   - The chunk's membership has changed (plan IDs in the cached report don't match current `trellis chunks --json` output)
3. Re-dispatch agents for chunks that are stale OR had errors/warnings in their cached report
4. Skip Phase 2 if no cross-chunk findings changed and no boundary notes changed
5. Merge new results with valid cached clean-chunk results

## Error Handling

**Subagent failures:** If a chunk subagent fails (timeout, malformed output, context overflow):

1. Log the failure to stderr: `Review of chunk 'core-data' failed: <reason>`
2. Record it in the final report as a finding: `{ "type": "review_error", "severity": "error", "plans": [<chunk member IDs>], "description": "Chunk review failed: <reason>" }`
3. Do NOT block the rest of the review — other chunks proceed normally
4. Phase 2 treats the failed chunk as opaque: cross-chunk edges touching it get flagged as `"unable to verify — chunk review failed"`

**`trellis chunks` failure:** If `trellis chunks --json` fails (not installed, no plans, parse error), the skill exits immediately with a clear error message. No partial review.

## Skill File Location

`~/dotfiles/claude/skills/plan-review/` — lives in the dotfiles repo alongside other skills, symlinked to `~/.claude/skills/` via the user's dotfiles setup. Available computer-wide across all projects.

## Dependencies

- Requires `trellis chunks --json` to be available (the trellis feature from this plan)
- Uses Task tool with `sonnet-general-purpose` for chunk agents
- Uses Task tool with `opus-general-purpose` for cross-chunk synthesis (if chunks > 3)
- Falls back to main context for synthesis if only 2-3 chunks
