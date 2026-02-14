# Trellis

**Freshness:** 2026-02-11

## Purpose

Trellis is a lightweight CLI tool for managing plans with dependencies across twiglylabs projects. It scans a plans directory, reads YAML frontmatter from markdown files, builds a dependency graph, and answers "what can I work on next?"

No manifest file. The plan files ARE the source of truth.

## Stack

- TypeScript, Node.js
- Single binary via esbuild bundle
- Built-in web viewer (served locally by `trellis graph`)
- Zero runtime dependencies beyond Node

## How It Works

Each consuming project has a `plans/` directory with markdown files. Each plan file has YAML frontmatter with metadata (title, status, depends_on, tags). Trellis scans, parses frontmatter, and builds the DAG.

A plan is either:
- A single `.md` file with frontmatter
- A directory with a `README.md` (for complex multi-file plans)

Plan ID = relative path from plans dir, minus extension.

## Commands

```
trellis status                     # dashboard: what's ready, blocked, in progress
trellis graph                      # open DAG viewer in browser
trellis ready                      # list plans with all dependencies satisfied
trellis update <plan-id> <status>  # edit frontmatter in-place, show what unblocks
trellis lint                       # find cycles, missing deps, bad frontmatter
trellis init                       # scaffold .trellis config + plans/ directory
trellis show <plan-id>             # show plan details and dependency chain
```

## Frontmatter Schema

```yaml
---
title: Plan Title                  # required
status: not_started                # required: draft | not_started | in_progress | done | archived
depends_on:                        # optional: list of plan IDs
  - contracts/core-types
tags: [foundation, public]         # optional: freeform tags
repo: public                       # optional: target repo
description: One-line summary      # optional
assignee: agent-name               # optional
started_at: 2026-02-11T10:00:00Z  # optional, auto-set by trellis update
completed_at: 2026-02-12T15:30:00Z # optional, auto-set by trellis update
---
```

## Development

```bash
npm install
npm run build        # esbuild bundle
npm test             # vitest
npm run dev          # watch mode
node dist/trellis.js # run locally
```

## Design Principles

- **File-first.** Plan files are the entire state. No hidden databases or config.
- **Frontmatter-driven.** Metadata lives in the plan file itself. No manifest to sync.
- **Project-local.** Each project owns its own plans directory.
- **Read-heavy.** Most usage is `status`, `ready`, `graph`. Writes are `update`.
- **No opinions about plan content.** Trellis reads frontmatter only. Plan body can be any format.
