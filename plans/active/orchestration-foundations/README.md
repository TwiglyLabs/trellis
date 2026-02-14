---
title: Orchestration Foundations
status: not_started
tags: [orchestration, cli]
description: Make trellis machine-consumable with JSON output, smart selection, filtering, and epic tracking
---

# Orchestration Foundations

Make trellis usable as a building block for automated orchestration. An external agent or script should be able to call trellis commands, parse structured output, and make decisions.

## Phases

1. **[JSON Output](implementation/phase-1-json-output.md)** — `--json` flag on remaining commands (ready, show, update, lint, graph) plus schema alignment
2. **[Ready --next](implementation/phase-2-ready-next.md)** — Single highest-priority plan selection for "what should I work on?"
3. **[Status Filtering](implementation/phase-3-status-filtering.md)** — Hide done/archived by default, add `--all`/`--done`/`--archived`
4. **[Epic Tracking](implementation/phase-4-epic-tracking.md)** — Tag-based epic grouping with completion monitoring

## Exit Code & Error Contract

All commands follow these rules when `--json` is set:

| Stream | Content |
|--------|---------|
| **stdout** | Data: success responses, JSON arrays/objects |
| **stderr** | Errors: invalid input, missing plans — also JSON-serialized |

| Exit Code | Meaning |
|-----------|---------|
| **0** | Success |
| **1** | Error (invalid input, missing plan, lint failures, `--strict` warnings) |

Pretty-printed JSON (`null, 2` indent) for debuggability. Pipe through `jq -c` for compact output.
