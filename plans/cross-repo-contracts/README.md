---
title: Cross-Repo Contract System
status: archived
depends_on:
  - plan-schema
tags: [cross-repo, contracts, plan-management]
description: Enable plans to declare dependencies on external contracts (npm exports, OpenAPI specs, etc.) verified through a plugin system
---

# Cross-Repo Contract System

Enable trellis to track dependencies that cross repository boundaries by referencing real, verifiable contract artifacts rather than scanning other repos' internal plans.

## Problem

Trellis is single-project. When work spans multiple repos — an SDK exports types that an app consumes, an API defines endpoints that clients implement — trellis can't see those edges. `trellis ready` says a plan is ready even when it's blocked by unfinished work in another repo.

The naive solution (scan all repos, build one big DAG) has problems: assumes specific disk layout, tightly couples repos' internal plan structures, duplicates workspace management that already exists in grove, and doesn't match how repos actually interact — through published interfaces, not internal plans.

## Approach (needs refinement)

Plans are internal to a repo. The boundary between repos is **contracts** — package exports, API specs, documented protocols. A plan shouldn't depend on a plan in another repo. It should depend on an *interface* that another repo provides.

### Contract types as plugins

A contract type is a plugin that knows how to read a specific kind of artifact:

- **`npm`** — reads package.json exports, checks if types/modules exist
- **`openapi`** — reads a spec file, checks for endpoints/schemas
- **`typescript`** — reads .d.ts files, checks for type exports
- **`grpc`** — reads .proto files for service definitions
- **`custom`** — points to a markdown doc as the contract (fallback for things without machine-readable artifacts)

No duplication of existing sources of truth. Trellis reads the actual artifacts.

### Plan references

Plans declare external dependencies by contract type:

```yaml
# in inputs.md or similar
external_inputs:
  - type: npm
    package: "@acorn/core"
    needs: ["Person", "Claim", "AcornStore"]
  - type: openapi
    spec: "./specs/sync-protocol.yaml"
    needs: ["POST /sync/push"]
```

### Open design questions

- **How to reference artifacts in other repos?** Git remote + path? Published packages only? On-disk paths with some portability layer?
- **Plugin architecture** — how heavy? Simple function interface, or full plugin loading?
- **"Contract doesn't exist yet"** — how to handle dependencies on interfaces being built by other plans?
- **Boundary with grove** — grove manages workspace/repo concerns. Where does trellis stop and grove start?
- **Verification granularity** — checking "does @acorn/core export Person" is very different from checking "does the OpenAPI spec have POST /sync/push." How much do plugins need to understand about the artifact format?
