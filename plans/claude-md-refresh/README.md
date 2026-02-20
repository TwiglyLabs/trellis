---
title: Slim down CLAUDE.md to point at docs/
status: archived
depends_on:
  - documentation
tags:
  - docs
---

## Problem

CLAUDE.md duplicates content that now lives in proper docs/ files (plan schema, CLI commands, architecture details, status gates). This makes the file harder to maintain and creates ambiguity about whether CLAUDE.md or docs/ is the source of truth. Agents should get a quick reference in CLAUDE.md plus links to detailed docs elsewhere.


## Approach

Keep CLAUDE.md minimal: one-line purpose and stack, dev commands, and the MCP tool table with "never edit plans directly" rule. Link to docs/ (plan-schema.md, cli-reference.md, architecture.md) for frontmatter schema, full command list, plan structure, status gates, and how trellis works. Update the freshness date to 2026-02-18.

