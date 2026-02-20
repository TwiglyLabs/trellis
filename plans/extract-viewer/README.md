---
title: Remove DAG viewer from trellis
status: draft
description: >-
  Extract the dagre HTML viewer from this repo — it will live in the canopy
  repo. trellis graph becomes JSON-only.
tags:
  - infrastructure
  - cleanup
---

## Problem

The DAG viewer (dagre HTML template, esbuild injection plugin, HTTP server in the graph command) adds complexity and bundle size to trellis for a component that's being rebuilt in canopy with a richer UI.

The dagre dependency, the esbuild plugin that bundles it as IIFE into an HTML template, and the HTML-as-JS-string embedding all exist solely for `trellis graph` without `--json`. The viewer is tightly coupled to the build system and makes the bundle significantly larger.

The canopy viewer will consume `trellis graph --json` output directly. Keeping the old viewer in trellis means maintaining two visualization systems during the transition and carrying dead weight after.

## Approach

### Remove viewer infrastructure

Delete:
- `src/viewer/index.html` — the dagre HTML template
- The esbuild plugin that bundles dagre as IIFE and injects it into the HTML template
- The HTML-as-JS-string import in the graph command
- The HTTP server code in the graph command (listen, serve, open browser, Ctrl+C handling, EADDRINUSE)
- `dagre` from package.json dependencies

### Graph command becomes JSON-focused

`trellis graph --json` works exactly as today — outputs `{ nodes, edges }` JSON. No change.

`trellis graph` (without `--json`) prints a compact text summary to stdout:
```
4 plans, 5 edges
Ready: auth, api-layer
Blocked: frontend (blocked by: auth)
Critical path: core → auth → frontend (3 steps)
```

This gives humans a quick read without needing a browser. The canopy viewer handles rich visualization.

### Build simplification

The dagre esbuild plugin is one of the more complex parts of the build. Removing it simplifies `esbuild.config.ts` and should noticeably reduce bundle size (dagre + the HTML template string).

### Graph test cleanup

Graph command tests currently need `vi.mock('../../src/viewer/index.html', ...)` because Vitest can't parse HTML files without the esbuild plugin. After removal, this mock goes away and graph tests become straightforward.
