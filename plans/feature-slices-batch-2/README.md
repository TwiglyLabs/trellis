---
title: 'Extract features batch 2: set/rename/archive/sections/epic/chunks/metrics'
status: done
depends_on:
  - feature-slices-batch-1
tags:
  - refactor
  - vertical-slices
not_started_at: '2026-02-20T00:16:04.388Z'
started_at: '2026-02-20T00:51:26.999Z'
completed_at: '2026-02-20T01:57:35.135Z'
---

## Problem

After batch 1 extracted 6 features into vertical slices, 7 more features remain in the monolithic api.ts: set, rename, archive, sections (readSection/writeSection), epic, chunks, and metrics. These need the same treatment to complete the feature extraction before the Trellis class can be removed.


## Approach

Extract the remaining 7 features following the same pattern established in batch 1: each gets `src/features/<name>/logic.ts`, `command.ts`, and `<name>.test.ts`. Split across two phases — write-surface features (set/rename/archive/sections) first, then read-heavy analytics features (epic/chunks/metrics).
