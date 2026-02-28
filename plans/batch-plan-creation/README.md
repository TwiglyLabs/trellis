---
title: Batch Plan Creation with Topo-Sort and Union Validation
status: done
description: >-
  Batch create plans across repos with topological sort, cycle detection, and
  cross-batch dependency validation
depends_on:
  - 'trellis:cross-repo-write-routing'
tags:
  - cross-repo
  - cli
  - mcp
type: feature
not_started_at: '2026-02-28T22:19:29.544Z'
started_at: '2026-02-28T22:32:35.175Z'
completed_at: '2026-02-28T22:44:28.338Z'
---

## Problem
Creating a DAG of 100+ plans across 7 repos one-by-one is slow, error-prone, and risks partial state if something fails mid-way. An agent decomposing interface specs into implementation plans needs to produce a batch and create all plans in one shot.

The core problem: dependency validation must work against the union of existing plans + plans being created in the batch. A plan created later in the batch may depend on a plan created earlier. Without union validation, you'd need a two-pass approach (create all plans without deps, then add deps) which risks inconsistency.

With the write routing from `cross-repo-write-routing` in place, each individual create already works cross-repo. Batch creation layers on top: parse a structured manifest, topo-sort, cycle-detect, and create in dependency order.
## Approach
1. Define a batch input format — YAML file (CLI) or JSON array (MCP) of plan specs. Each spec has `id` (qualified), `title`, `type`, `depends_on`, `tags`, `description`.

2. Create `computeCreateBatch()` that:
   - Builds a "universe" = existing graph plans + batch plan IDs
   - Validates all deps exist in the universe
   - Detects cycles in the batch (using the dep edges)
   - Topologically sorts plans so deps are created before dependents
   - Creates each plan using the existing `resolveWriteTarget` → `dequalifyDepsForWrite` → `computeCreate` pipeline
   - Tracks results: created, skipped (already exists), errors
   - Stops on first error (fail-fast) or continues (configurable)

3. Expose as `trellis create-batch <file>` (CLI) and `trellis_create_batch` (MCP tool).

4. Support `--dry-run` that validates everything without writing files.
