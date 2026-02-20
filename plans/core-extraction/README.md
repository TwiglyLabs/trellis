---
title: Extract shared modules into src/core/
status: not_started
tags:
  - refactor
  - vertical-slices
not_started_at: '2026-02-20T00:16:03.227Z'
---

## Problem

Trellis currently has shared modules (types.ts, scanner.ts, graph.ts, frontmatter.ts, schema.ts, contracts.ts, manifest.ts, utils.ts) scattered at the src/ root alongside feature-specific files like api.ts, cli.ts, and mcp.ts. This flat structure conflates core domain logic with CLI and MCP runtime concerns, making it harder to extract reusable components and reason about layering. Moving shared modules into src/core/ establishes a clear boundary between domain logic and integration points, enabling a vertical-slice architecture where each feature sits in its own slice.


## Approach

Create src/core/ directory and migrate all shared modules there, preserving their public API. Extract TrellisContext as an interface and create createContext() and refreshContext() helpers to encapsulate config, plans, graph, and plansDir into a single immutable context object. Update all import paths in api.ts, cli.ts, mcp.ts, and commands/ to reference src/core/, then verify all 606 tests pass without functional changes.
