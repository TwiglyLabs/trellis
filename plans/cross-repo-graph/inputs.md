
## From plans

### cross-repo-manifest
- `ProjectManifest` type and `parseManifest()` — repo discovery and manifest format
- `fetchRepoPlans()` — git-based remote plan reader
- `ensureRemote()`, `gitShow()`, `gitListTree()` — git operations

### kill-trellis-class
- `createContext()` / `refreshContext()` — standalone context functions (replacing Trellis class)
- `TrellisContext` type

### trellis-directory-migration
- `.trellis/cache/` directory — storage location for cached remote plans and manifests
- `CacheEntry<T>`, `readCache()`, `writeCache()`, `isCacheStale()` — cache utilities

### extract-viewer
- `trellis graph` as text summary + JSON — clean command surface without HTTP server
