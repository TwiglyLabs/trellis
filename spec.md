# Trellis Specification

**Freshness:** 2026-02-11

## Overview

Trellis is a CLI tool for managing plan dependencies across projects. It scans a plans directory, reads YAML frontmatter from markdown files, and builds a dependency graph. No manifest file to keep in sync — the plan files ARE the source of truth.

## Plan Discovery

Trellis scans the plans directory for plan files. A plan is either:

1. **Single-file plan:** Any `.md` file with trellis frontmatter
2. **Directory plan:** A directory containing a `README.md` with trellis frontmatter (for complex plans with sub-files)

```
plans/
├── contracts/
│   ├── core-types.md              ← single-file plan (ID: contracts/core-types)
│   ├── auth-system.md             ← single-file plan (ID: contracts/auth-system)
│   └── cloud-rest-api.md          ← single-file plan (ID: contracts/cloud-rest-api)
├── implementation/
│   ├── gedcom-parser.md           ← single-file plan (ID: implementation/gedcom-parser)
│   └── core-extraction/           ← directory plan  (ID: implementation/core-extraction)
│       ├── README.md              ← frontmatter lives here
│       ├── type-extraction.md     ← sub-file (not a separate plan)
│       ├── date-model.md          ← sub-file
│       └── package-setup.md       ← sub-file
```

### Plan ID

Derived from the file path relative to the plans directory, minus extension:
- `plans/contracts/core-types.md` → `contracts/core-types`
- `plans/implementation/core-extraction/README.md` → `implementation/core-extraction`

### Discovery Rules

1. Scan `plans_dir` recursively for `.md` files
2. A `.md` file is a plan if it has a `---` frontmatter block with at least a `title` field
3. For directories: only `README.md` is treated as a plan root. Other `.md` files in the same directory are sub-files (ignored by trellis).
4. Files without trellis frontmatter are ignored (allows non-plan docs to coexist)

## Frontmatter Schema

```yaml
---
title: Core Types Contract                    # required — human-readable title
status: draft                                 # required — see status values below
depends_on:                                   # optional — list of plan IDs
  - contracts/auth-system
  - contracts/core-types
tags: [contract, cloud]                       # optional — freeform tags for filtering
repo: cloud                                   # optional — target repo
description: One-line summary of the plan     # optional — shown in status/ready output
assignee: agent-name                          # optional — who's working on this
started_at: 2026-02-11T10:00:00Z             # optional — set when status → in_progress
completed_at: 2026-02-12T15:30:00Z           # optional — set when status → done
---
```

### Status Values

- `draft` — plan is being written, not ready for implementation
- `not_started` — plan is written and reviewed, ready when dependencies are met
- `in_progress` — actively being worked on
- `done` — completed
- `archived` — abandoned or superseded

### Computed Properties (derived at runtime, never stored)

- **blocked**: status is `not_started` and any `depends_on` entry has status != `done`
- **ready**: status is `not_started` and all `depends_on` are `done`
- **blocks**: inverse of `depends_on` — which plans list this plan as a dependency?
- **critical_path**: longest dependency chain from this plan to a root (no dependencies)

## Project Configuration

Minimal config file at project root. Only needed to tell trellis where to find plans (if not the default `plans/` directory).

```
# .trellis (optional — defaults shown)
# Simple key: value format (not full YAML). Inline comments are stripped.
project: acorn
plans_dir: plans
```

If no `.trellis` file exists, trellis looks for a `plans/` directory in the current working directory. If that exists, it uses it with the directory name as the project name.

## CLI Commands

### `trellis init`

Create a `.trellis` config and a `plans/` directory.

```
$ trellis init
Project name [acorn]: acorn
Plans directory [plans]: plans
Created .trellis and plans/
```

### `trellis status`

Scan plans directory, read frontmatter, show dashboard grouped by status.

```
$ trellis status

acorn — 20 plans

  READY (4)
    core-extraction         Extract @acorn/core package           [public]
    gedcom-parser           GEDCOM 5.5.1/7.0 parser              [public]
    auth-service            OIDC server from rithmly              [cloud]
    ui-foundations          @acorn/ui package + design tokens     [cloud]

  BLOCKED (8)
    schema-v6               ← waiting on: core-extraction
    store-refactor          ← waiting on: core-extraction, schema-v6
    engine-extraction       ← waiting on: store-refactor
    mcp-refactor            ← waiting on: engine-extraction
    cloud-api               ← waiting on: auth-service, core-extraction
    http-store-adapter      ← waiting on: cloud-api
    hosted-mcp              ← waiting on: cloud-api, mcp-refactor
    web-app                 ← waiting on: cloud-api, ui-foundations

  IN PROGRESS (2)
    core-types              Core types contract                   [planning]
    auth-system             Auth system contract                  [planning]

  DRAFT (2)
    ...

  DONE (4)
    ...
```

Options:
- `--tag <tag>` — filter by tag
- `--repo <repo>` — filter by repo
- `--json` — output as JSON (for scripting)

### `trellis ready`

List only the plans that are ready to start (all dependencies satisfied, status is `not_started`).

```
$ trellis ready
contracts/core-extraction     Extract @acorn/core package           [public]
contracts/gedcom-parser       GEDCOM 5.5.1/7.0 parser              [public]
implementation/auth-service   OIDC server from rithmly              [cloud]
implementation/ui-foundations @acorn/ui package + design tokens     [cloud]
```

Options:
- `--tag <tag>` — filter
- `--repo <repo>` — filter

### `trellis update <plan-id> <status>`

Update a plan's frontmatter status in-place. Shows what the change unblocks.

```
$ trellis update implementation/core-extraction done
✓ implementation/core-extraction → done

  Now ready:
    implementation/schema-v6          Schema v6 migration
```

Trellis edits the frontmatter in the plan file directly — no separate state file. It also auto-sets `started_at` when status → `in_progress` and `completed_at` when status → `done`.

### `trellis show <plan-id>`

Show details for a single plan including dependency chain.

```
$ trellis show implementation/schema-v6

  Schema v6 Migration
  Path:       plans/implementation/schema-v6.md
  Status:     not_started (blocked)
  Tags:       foundation, public
  Repo:       public

  Depends on:
    ✓ contracts/core-types              done
    ✗ implementation/core-extraction    in_progress    ← blocking

  Blocks:
    implementation/store-refactor
    implementation/engine-extraction (transitive)
    implementation/mcp-refactor (transitive)
```

### `trellis graph`

Open an interactive DAG visualization in the default browser. Serves a local HTML page on a random port.

```
$ trellis graph
Serving DAG viewer at http://localhost:3847
```

The viewer shows:
- Nodes as cards with plan title, status badge, tags
- Edges showing dependencies (arrows from dependency → dependent)
- Color coding by status (grey=not started, blue=in progress, green=done, yellow=draft, red=blocked)
- Grouping by tag or repo (toggleable)
- Click a node to see details panel with full dependency chain
- Filter by tag/repo/status

The HTML + JS is bundled into the CLI (embedded as a string). No CDN, no build step at view time. Uses dagre for layout, SVG for rendering.

### `trellis lint`

Validate plans directory for structural issues.

```
$ trellis lint

  ✗ Cycle detected: schema-v6 → store-refactor → schema-v6
  ✗ Unknown dependency: cloud-api depends on "auth-servce" (typo?)
  ⚠ Orphaned plan: old-migration-plan has no dependents and status is draft
  ✓ 18 of 20 plans OK
```

Checks:
- Dependency cycles
- References to non-existent plan IDs
- Frontmatter validation (required fields present, valid status values)
- Plans with status `done` that still have incomplete dependencies (inconsistent)
- Plans with status `in_progress` that have incomplete dependencies (flagged, not error)

## Web Viewer

The graph viewer is a self-contained HTML page served by the CLI. Plan data is injected as an inline JSON blob at serve time (scanned from frontmatter on each request so it's always fresh).

### Layout

```
┌─────────────────────────────────────────────────────┐
│  Trellis — acorn                    [Filter ▾] [⟳]  │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌─────────┐     ┌─────────────┐                    │
│  │core-types│────→│core-extract │                    │
│  │  ✓ done  │     │ ● progress  │                    │
│  └─────────┘     └──────┬──────┘                    │
│                    ┌────┴────┐                       │
│              ┌─────▼──┐  ┌──▼────────┐              │
│              │schema-v6│  │store-refac│              │
│              │ ○ blocked│  │ ○ blocked │              │
│              └────┬────┘  └─────┬─────┘              │
│                   └──────┬──────┘                    │
│                    ┌─────▼─────┐                     │
│                    │engine-ext │                     │
│                    │ ○ blocked │                     │
│                    └───────────┘                     │
│                                                     │
├─────────────────────────────────────────────────────┤
│  Selected: implementation/core-extraction            │
│  Status: in_progress | Tags: foundation, public     │
│  Depends on: contracts/core-types (✓)               │
│  Blocks: schema-v6, store-refactor                  │
│  Path: plans/implementation/core-extraction.md      │
└─────────────────────────────────────────────────────┘
```

### Tech

- @dagrejs/dagre for DAG layout (bundled, ~50KB)
- SVG rendering (no canvas)
- Vanilla JS (no framework — it's one page)
- Dark mode by default, respects prefers-color-scheme
- Responsive — works in a half-screen window

## Frontmatter Parsing

Trellis uses a YAML frontmatter parser (gray-matter or similar). Only the frontmatter block is read — the rest of the markdown is ignored by trellis.

For `trellis update`, the frontmatter is modified in-place and the file is rewritten. The markdown body is preserved exactly as-is (no reformatting, no reordering).

## Project Structure

```
trellis/
├── src/
│   ├── cli.ts              # command parsing (commander or similar)
│   ├── scanner.ts          # scan plans dir, read frontmatter, build plan map
│   ├── graph.ts            # DAG computation (topo sort, cycle detection, blocked/ready)
│   ├── frontmatter.ts      # read/write YAML frontmatter in .md files
│   ├── commands/
│   │   ├── init.ts
│   │   ├── status.ts
│   │   ├── ready.ts
│   │   ├── update.ts
│   │   ├── show.ts
│   │   ├── graph.ts        # serve viewer
│   │   └── lint.ts
│   └── viewer/
│       └── index.html      # self-contained viewer page
├── tests/
│   ├── scanner.test.ts
│   ├── graph.test.ts
│   ├── frontmatter.test.ts
│   └── commands/
│       └── ...
├── package.json
├── tsconfig.json
├── CLAUDE.md
└── spec.md                 # this file
```

## Build & Distribution

- esbuild bundles everything into `dist/trellis.cjs` (single file, ~100KB + viewer HTML)
- `npx trellis` via npm publish, or `node dist/trellis.cjs` locally
- No native dependencies — pure JS/TS
- Target: Node 20+

## Non-Goals

- **No plan content parsing.** Trellis reads frontmatter only. It does not parse, validate, or render plan markdown.
- **No remote state.** No server, no database, no cloud sync. Plan files are the state.
- **No CI integration.** Not a task runner. It tracks status, not executes work.
- **No cross-project aggregation (v1).** Each project has its own plans directory.

## Future Considerations (not v1)

- `trellis watch` — file watcher that auto-refreshes the graph viewer
- Multi-project aggregation — `trellis status --projects ~/repos/twiglylabs/*/plans`
- Gantt chart view in the web viewer
- `trellis assign <plan-id> <name>` — shorthand for updating assignee in frontmatter
- GitHub issue integration — create/link issues from plans
- Hooks — run commands when plan status changes
