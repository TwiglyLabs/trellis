---
title: Replace Trellis class with context + standalone functions
status: not_started
depends_on:
  - feature-slices-batch-3
tags:
  - refactor
  - vertical-slices
not_started_at: '2026-02-20T00:16:05.674Z'
---

## Problem

After phases 1-2 extracted shared modules and features into src/core/ and src/features/, the Trellis class in api.ts is now just a thin facade delegating to feature functions. The class adds unnecessary indirection and complicates the public API without providing value. Removing it simplifies the architecture and makes the modular structure explicit to consumers.


## Approach

Delete api.ts entirely, then update src/index.ts to export createContext() and individual feature functions (status, ready, update, show, etc.) directly. Update src/mcp.ts to instantiate context once and call feature functions instead of creating Trellis instances. Fix all remaining test imports and references. The public API becomes: `import { createContext, status, ready, update } from 'trellis'`. This is a breaking change, but acceptable since trellis is pre-1.0 and primarily consumed via MCP.

