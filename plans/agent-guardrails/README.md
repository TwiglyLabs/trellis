---
title: Agent Guardrails
status: draft
depends_on:
  - cli-write-surface
tags: [enforcement, agent, plan-management]
description: Prevent agents from directly editing plan files — enforce MCP-only interaction via hooks and instructions
---

# Agent Guardrails

Enforce that agents interact with plans exclusively through trellis MCP tools.

**Deferred.** The MCP tools (from cli-write-surface) are the primary enforcement — agents use structured tools instead of file operations. This plan adds mechanical enforcement (hooks that block direct edits) as a safety net. Build it after MCP tools are proven in practice and if agents still bypass them.

## Problem

Even with a full MCP write surface, nothing stops an agent from using `Edit`, `Write`, or `Bash` to directly modify plan files. An agent moved a plan from `active/` to `complete/` — breaking all dependency references — and didn't even update the status. Instructions alone ("please use trellis tools") are insufficient. The enforcement needs to be mechanical, not behavioral.

## Approach

Two enforcement layers plus instructions. The MCP server itself is the primary interface — agents shouldn't need filesystem access to plans at all. The hooks exist to catch the cases where an agent reaches for Edit/Write anyway.

### Claude Code hooks (enforcement)

Hooks on `Edit` and `Write` tool calls that check if the target path is inside `plans/`. If so, the tool call is blocked with a message:

> "Plan files are managed by trellis. Use the trellis MCP tools (trellis_create, trellis_write_section, trellis_set, trellis_update) instead of editing files directly."

This is a hard block — the write doesn't happen.

`Edit` and `Write` are the only tools that need hooks. Unlike the previous Bash-pattern-matching approach, we don't try to intercept shell commands. Agents using MCP tools have no reason to shell out to touch plan files, and the pre-commit hook catches anything that slips through.

The hooks are simple path checks, not fragile command parsing:
- `Edit` hook: check `file_path` argument starts with `<plans_dir>/`
- `Write` hook: check `file_path` argument starts with `<plans_dir>/`

### Pre-commit hook (safety net)

Runs `trellis lint` on staged files within `plans/`. Rejects commits with:
- Single-file plans (must be directories)
- Missing required sections for current status
- Broken dependency references
- Invalid frontmatter

This catches anything that bypasses the Claude Code hooks — manual edits, bash commands, scripts, other tools. It's the last line of defense before invalid plan state gets committed.

### Claude instructions (soft layer)

CLAUDE.md additions:
- "Interact with plans exclusively through trellis MCP tools — never use Edit, Write, or Bash to modify plan files"
- "Use `trellis_read_section` to read plan content, `trellis_write_section` to write it"
- "Use `trellis_create` to scaffold new plans, `trellis_set` for metadata, `trellis_update` for status changes"
- "Plans should be implementable in roughly half a context session — if a plan feels too big, split it"
- "When reviewing plans, check granularity — flag plans that should be decomposed"

### Installation

`trellis init` offers to install both hook types:
- Writes Claude Code hook configuration to `.claude/settings.local.json` (or project hooks config)
- Installs git pre-commit hook (or appends to existing)
- Adds CLAUDE.md plan management section
- `.mcp.json` is already created by the cli-write-surface plan's init changes
