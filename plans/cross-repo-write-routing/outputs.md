
## Exports
- `dequalifyDepsForWrite(deps, targetAlias)` function exported from `src/core/utils.ts` — strips same-repo qualification from deps before writing to disk
- Improved error messages in MCP create handler for missing repo alias and missing manifest
- Pattern: MCP write tools dequalify deps before passing to compute functions
