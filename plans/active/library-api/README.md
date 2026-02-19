---
title: Library API for Electron Consumption
status: done
depends_on: []
tags: [foundation]
repo: trellis
description: Extract trellis core into a typed library API that Electron can consume directly
---

# Library API for Electron Consumption

## Summary

Trellis is currently a CLI-only tool. An Electron app is being built to replace the emacs UI client and the embedded web viewer (`trellis graph`). This plan extracts trellis's core logic into a library API that the Electron app can consume as a dependency.

## Approach

The existing source modules (`scanner.ts`, `graph.ts`, `frontmatter.ts`, `contracts.ts`, `types.ts`) already contain pure functions with no CLI concerns (no `process.cwd()`, no `chalk`, no `console.log`). The CLI commands in `src/commands/*.ts` are thin wrappers that call these functions and format output.

This plan:

1. **Phase 1** — Creates a barrel export (`src/index.ts`) and adds a library build target (ESM + CJS + `.d.ts`) alongside the existing CLI build
2. **Phase 2** — Builds a `Trellis` class that wraps the pure functions into a high-level, stateful API with typed return objects (the thing Electron actually calls)
3. **Phase 3** — Refactors the CLI commands to use the `Trellis` class internally, proving the API is sufficient and eliminating logic duplication
4. **Phase 4** — Adds `watch()` for reactive file monitoring, so Electron can subscribe to plan changes without polling

## Key Design Decisions

- **Trellis class as primary API** — Single entry point, lazy loading, cached graph, explicit `refresh()`
- **Structured return types** — Every method returns typed objects, not strings. The Electron app never parses CLI output.
- **CLI backward compatibility** — The `--json` output shapes are preserved. CLI commands become thin formatting layers.
- **EventEmitter for watch** — `Trellis` extends `EventEmitter`, emits `'change'` with full graph data on file changes
- **Dual build** — ESM + CJS library bundle alongside the existing CLI binary. Same source, two targets.
