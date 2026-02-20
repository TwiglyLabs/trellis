---
title: 'Extract features batch 1: scaffolding + status/ready/show/update/lint/create'
status: not_started
depends_on:
  - core-extraction
tags:
  - refactor
  - vertical-slices
not_started_at: '2026-02-20T00:16:03.775Z'
---

## Problem

The Trellis API layer is monolithic: `src/api.ts` contains 17 methods (1156 lines) with their logic, types, and command handlers tangled together. This makes it hard to locate feature code, difficult to test individual commands in isolation, and blocks parallel work on different features. This is the first of three batches that decompose the monolith into vertical slices.

This batch handles infrastructure scaffolding and the first 6 features: status, ready, show, update, lint, and create.


## Approach

Set up the `src/features/` and `src/__tests__/` directories, update vitest config, move cross-cutting test files, then extract 6 features into vertical slices following a consistent pattern: `src/features/<name>/logic.ts` (standalone function + types), `command.ts` (CLI handler), and `<name>.test.ts` (co-located tests). Each extraction updates `Trellis` class methods to delegate to the new functions.
