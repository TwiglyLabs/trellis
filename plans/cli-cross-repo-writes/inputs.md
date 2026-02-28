
## From plans
### From: cross-repo-write-routing
- `dequalifyDepsForWrite()` function for stripping same-repo qualification
- Error message patterns for missing repo alias and missing manifest

## From existing code
- `createContext()` in `src/core/context.ts:158-169` — single-repo context builder
- `loadConfig()` — loads `.trellis/config`
- `loadProjectRepos()` in `src/core/manifest.ts` — resolves manifest repo specs
- `ContextStore` in `src/core/store.ts` — multi-repo state management
- CLI commands in `src/features/create/command.ts`, `src/features/set/command.ts`, `src/features/update/command.ts`
