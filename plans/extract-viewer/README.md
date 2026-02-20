---
title: Remove DAG viewer from trellis
status: done
description: >-
  Remove the dagre HTML viewer from trellis — canopy handles visualization.
  trellis graph becomes text summary + JSON.
tags:
  - infrastructure
  - cleanup
not_started_at: '2026-02-20T04:55:10.374Z'
completed_at: '2026-02-20T05:11:10.689Z'
---

## Problem

The DAG viewer (dagre HTML template, esbuild injection plugin, HTTP server in the graph command) adds complexity and bundle size to trellis for a component that's being rebuilt in canopy with a richer UI.

The dagre dependency, the esbuild plugin that bundles it as IIFE into an HTML template, and the HTML-as-JS-string embedding all exist solely for `trellis graph` without `--json`. The viewer is tightly coupled to the build system and makes the bundle significantly larger.

The canopy viewer will consume `trellis graph --json` output directly. Keeping the old viewer in trellis means maintaining two visualization systems during the transition and carrying dead weight after.

## Approach

### Remove viewer infrastructure

Delete the entire `src/features/graph/viewer/` directory:
- `index.html` — the dagre HTML template (1,096 lines)
- `dagre-shim.ts` — re-exports `graphlib` and `layout` from `@dagrejs/dagre`
- `html.d.ts` — `declare module '*.html'` type declaration

Delete from `src/features/graph/command.ts`:
- `import viewerHtml from './viewer/index.html'`
- `import { createServer } from 'http'`
- `import { execFile } from 'child_process'`
- The HTTP server code (createServer, EADDRINUSE, listen, execFile/open-browser)
- The `--port` CLI option (only relevant for the server)

Delete from `src/features/graph/logic.ts`:
- `getGraphData()` — builds the rich viewer payload (body, outputs, inputs, filePath). Dead code after viewer removal.
- The `computeShow` import it uses

Delete from build:
- The `dagreInjectionPlugin` in `build.mjs` (lines 8-34)
- Remove the plugin from the CLI build's `plugins` array
- Library builds (`dist/index.mjs`, `dist/index.cjs`) are unaffected — they don't use the plugin

Remove `@dagrejs/dagre` from `package.json` dependencies.

### Graph command becomes text-summary + JSON

`trellis graph --json` works exactly as today — outputs `{ nodes, edges }` JSON. No change.

`trellis graph` (without `--json`) prints a compact text summary to stdout:
```
4 plans, 5 edges
Ready: auth, api-layer
Blocked: frontend (by: auth, core), payments (by: api-layer)
Critical path: core → auth → frontend (3 steps)
```

Blocked plans show *why* they're blocked — their unsatisfied dependencies. This is computed from the `dependencies` map in `GraphData`, filtering to deps whose status is not `done`.

Always exits 0. This is an informational read command, not a check.

Critical path: compute `computeCriticalPath()` for each leaf node (no dependents), display the longest chain.

### Build simplification

The dagre esbuild plugin is one of the more complex parts of the build. Removing it simplifies `build.mjs` and should noticeably reduce bundle size (`@dagrejs/dagre` + the HTML template string).

### Graph test cleanup

Graph tests currently need `vi.mock('./viewer/index.html', ...)` and `vi.mock('child_process', ...)` because of the viewer/server code. After removal:
- Delete the `vi.mock` calls
- Delete the server integration test ("serves viewer data with chunks and contracts via /api/data")
- Add tests for the new text summary format
- `--json` tests stay as-is
