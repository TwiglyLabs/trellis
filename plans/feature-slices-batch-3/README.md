---
title: 'Extract features batch 3: graph/init/fetch/setup-hooks/watch + cleanup'
status: done
depends_on:
  - feature-slices-batch-2
tags:
  - refactor
  - vertical-slices
not_started_at: '2026-02-20T00:16:05.005Z'
completed_at: '2026-02-20T02:22:52.435Z'
---

## Problem

After batches 1 and 2 extracted 13 features, 5 remain: graph, init, fetch, setup-hooks, and watch. Additionally, core module tests still live in `tests/` instead of co-located with their modules in `src/core/`, the old `src/commands/` directory needs to be deleted, and several cross-cutting test files (build, integration, mcp, hooks) need final placement. The esbuild config and cli.ts command registration also need updating for the new structure.


## Approach

Extract the final 5 features, move core tests to `src/core/`, move remaining cross-cutting tests to `src/__tests__/`, delete the old `src/commands/` and empty `tests/` directories, and update cli.ts to import command handlers from `src/features/*/command.ts` via a barrel pattern. Update esbuild config to exclude co-located test files from the bundle.
