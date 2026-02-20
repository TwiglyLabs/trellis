---
title: Write layered documentation
status: not_started
depends_on:
  - kill-trellis-class
tags:
  - docs
not_started_at: '2026-02-20T00:16:06.560Z'
---

## Problem

Trellis currently has zero user-facing documentation—only CLAUDE.md for developers. New users (humans and agents) can't easily understand what trellis is, how to install it, or how to use its 17 commands. Developers don't have a clear guide to the codebase structure or how to extend it. Agents lack reference documentation for the MCP server, making it hard to write correct tool calls without trial-and-error.


## Approach

Create a layered documentation suite: (1) human-friendly README.md with install + quick-start workflow; (2) developer docs in `docs/` covering architecture, plan schema, CLI reference, and MCP reference; (3) agent guide explaining .mcp.json setup and MCP tool patterns. Focus on concrete examples and cross-links. Structure supports both sequential reading (new users) and lookup (experienced users searching for a specific flag or tool).

