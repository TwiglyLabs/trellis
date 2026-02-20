---
title: Fix writeSection race condition on parallel MCP writes to same file
status: draft
description: >-
  Parallel trellis_write_section calls to the same file corrupt content — each
  reads the same state, writes independently, last writer wins and others are
  lost
tags:
  - bug
  - mcp
---

## Problem
When an MCP client (e.g. Claude Code) sends multiple `trellis_write_section` calls targeting the **same file** in parallel, the writes race:

1. All calls read the same file state via `readFileSync`
2. Each applies its section replacement independently
3. Each writes back via `writeFileSync`
4. The last writer wins — all other section changes are lost

The lost writes produce corrupted files: `## Heading` markers get concatenated onto the end of previous content lines (no newline separator), creating headings that `findSectionBoundaries` can't detect. Subsequent writes can't recover because they can't find the mangled section boundaries.

**Observed in practice:** Writing Steps, Testing, and Done-when to `implementation.md` in a single parallel MCP call batch. Only one section's content survived; the other two were from the pre-write state, with section headings concatenated onto content lines.

**Scope:** Only affects parallel writes to the same file. Parallel writes to different files (e.g., readme + implementation) are fine. Sequential writes to the same file also work correctly — the `writeSection` function itself is sound (unit tests pass).
## Approach

