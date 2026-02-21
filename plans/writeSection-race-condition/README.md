---
title: Fix writeSection race condition on parallel MCP writes to same file
status: done
description: >-
  Parallel trellis_write_section calls to the same file corrupt content — each
  reads the same state, writes independently, last writer wins and others are
  lost
tags:
  - bug
  - mcp
not_started_at: '2026-02-21T00:46:09.333Z'
started_at: '2026-02-21T00:47:59.887Z'
completed_at: '2026-02-21T00:57:46.799Z'
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
Two complementary fixes, both in the MCP server layer (CLI is unaffected — it's sequential by nature):

**1. Per-plan mutex.** A lightweight async lock keyed by plan ID serializes all concurrent writes (section writes, field sets, status updates) to the same plan. The lock lives inside `createMcpServer()` so each server instance is independent (important for test isolation). Writes to different plans proceed in parallel. The lock is a simple promise chain: each operation awaits the previous operation on the same key before proceeding.

**2. Batch write tool.** A new `trellis_write_sections` MCP tool accepts an array of `{file, section, content}` writes for a single plan. Writes are grouped by file — each file gets a single read-modify-write cycle applying all section changes sequentially to the in-memory string. This eliminates the race by design (one read-modify-write per file, not N) and is more efficient (fewer filesystem calls).

The mutex is the safety net (prevents data loss from any parallel write pattern). The batch tool is the efficient API (eliminates the need for parallel calls in the first place).
