
## Exports
All async variants are exported from `src/index.ts` alongside their sync counterparts. Import path: `trellis` (the package).

| Function | Module | Returns | Sync counterpart |
|----------|--------|---------|-----------------|
| `scanPlansAsync(plansDir, options?)` | `core/scanner.ts` | `Promise<Plan[]>` | `scanPlans` |
| `loadConfigAsync(cwd)` | `core/scanner.ts` | `Promise<TrellisConfig>` | `loadConfig` |
| `createContextAsync(projectDir, options?)` | `core/context.ts` | `Promise<TrellisContext>` | `createContext` |
| `refreshContextAsync(ctx, options?)` | `core/context.ts` | `Promise<TrellisContext>` | `refreshContext` |
| `createMultiContextAsync(repos)` | `core/context.ts` | `Promise<MultiContext>` | `createMultiContext` |
| `resolveProjectReposAsync(manifestPath)` | `core/manifest.ts` | `Promise<ResolvedRepo[]>` | `resolveProjectRepos` |
| `discoverManifestAsync(url, cwd, git?)` | `core/manifest.ts` | `Promise<ProjectManifest \| null>` | `discoverManifest` |
| `computeMtimeHashAsync(plansDir)` | `core/store.ts` | `Promise<string \| null>` | `computeMtimeHash` |
| `createCachedContextAsync(projectDir, options?)` | `core/cached-context.ts` | `Promise<CachedContextResult>` | `createCachedContext` |

Additionally exported types:
- `AsyncGitExecutor` — `(args: string[], cwd: string) => Promise<string | null>`
- `defaultAsyncGit` — default `AsyncGitExecutor` using `child_process.execFile`
