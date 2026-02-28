## Steps
### Chunk 1: Types + Parser + Resolution + Tests

Small enough for a single chunk.

1. Add `group?: string` to `RepoEntry` in `src/core/types.ts` (after `tags`)
2. Add `group?: string` to `ResolvedRepo` in `src/core/types.ts` (after `tags`)
3. In `parseManifest()` (`src/core/manifest.ts` ~line 55-71): add `group` to the optional metadata validation — validate it's a string if present, include it in the metadata spread
4. In `resolveProjectRepos()` (~line 282-292): map `group: entry.group` through to the `ResolvedRepo` output
5. In `resolveProjectReposAsync()` (~line 430-445): same mapping
6. Add tests in `src/core/manifest.test.ts`:
   - Repo with `group: "tooling"` parses correctly
   - Repo without `group` parses correctly (field is undefined)
   - Repo with `group: 123` (non-string) throws validation error
   - `resolveProjectRepos` includes `group` in resolved output
7. Run full test suite, typecheck
8. Publish to local Verdaccio registry
## Testing


## Done-when


## Design
### Manifest YAML shape

```yaml
repos:
  canopy:
    path: tooling/canopy
    url: git@github.com:twiglylabs/canopy.git
    branch: main
    visibility: private
    group: tooling        # <-- new optional field
```

### Type changes

```typescript
// types.ts
export interface RepoEntry {
  // ... existing fields ...
  group?: string;         // optional organizational group
}

export interface ResolvedRepo {
  // ... existing fields ...
  group?: string;
}
```

### Parser validation

Follows the same pattern as `name` and `description` — validated as optional string in the metadata block, spread into the entry object.

### What doesn't change

- Manifest structure (additive field)
- Plan parsing, graph resolution, cross-repo logic
- CLI commands
- MCP tools
