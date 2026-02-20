---
title: Extract features into vertical slices
status: archived
depends_on:
  - core-extraction
tags:
  - refactor
  - vertical-slices
---

## Problem

The Trellis API layer is monolithic: `src/api.ts` contains 17 methods (1156 lines) with their logic, types, and command handlers tangled together. This makes it hard to locate feature code, difficult to test individual commands in isolation, and blocks parallel work on different features. Each feature (status, ready, show, etc.) spans multiple files (api.ts, commands/, tests/) with no clear ownership boundary.


## Approach

Organize each of the 17 features into its own vertical slice under `src/features/<name>/`, containing `logic.ts` (standalone function + feature-specific types), `command.ts` (CLI handler), and `<name>.test.ts` (co-located tests). Move cross-cutting test files to `src/__tests__/`. Update all imports in src/commands/ to re-export from the new locations. Move viewer/ into `src/features/graph/viewer/`. This creates clear ownership, enables parallel work, and improves testability without changing external behavior.

