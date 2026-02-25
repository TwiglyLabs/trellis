# Architecture

## Overview

Trellis is a TypeScript CLI bundled into a single Node.js binary via esbuild. It has zero runtime dependencies beyond Node — all libraries are bundled at build time.

**Stack:** TypeScript, Node.js >= 20, esbuild (bundler), Vitest (tests), Commander (CLI framework), gray-matter (YAML frontmatter).

## Source Layout

```
src/
├── cli.ts                  # Commander program — registers all commands
├── index.ts                # Library barrel export (types + compute functions)
├── mcp.ts                  # MCP server definition (5 tools, Zod schemas)
│
├── core/                   # Shared domain logic
│   ├── context.ts          # createContext() — loads config, scans plans, builds graph
│   ├── contracts.ts        # parseInputs(), parseOutputs() for plan contracts
│   ├── frontmatter.ts      # parseFrontmatter(), updatePlanFile() — YAML read/write
│   ├── graph.ts            # buildGraph(), detectCycles(), topologicalSort(), pickNext(), computeChunks()
│   ├── manifest.ts         # Git operations for cross-repo plan fetching
│   ├── worktree.ts         # Git worktree detection and path override
│   ├── scanner.ts          # scanPlans(), loadConfig() — filesystem scanning
│   ├── schema.ts           # detectSections(), readSection(), writeSection(), validateStatusGate()
│   ├── types.ts            # All type definitions, PlanFile enum, STATUS_GATES
│   ├── utils.ts            # VALID_STATUSES, filterPlans(), padRight(), pluralize()
│   └── index.ts            # Barrel re-export of all core modules
│
├── features/               # Vertical feature slices (one dir per command)
│   ├── archive/
│   ├── chunks/
│   ├── create/
│   ├── epic/
│   ├── fetch/
│   ├── graph/              # Includes viewer/ subdirectory with HTML + dagre shim
│   ├── init/
│   ├── lint/
│   ├── metrics/
│   ├── ready/
│   ├── rename/
│   ├── sections/           # Read/write section logic (no CLI command — used by MCP and show)
│   ├── set/
│   ├── setup-hooks/
│   ├── show/
│   ├── status/
│   ├── update/
│   └── watch/              # File watcher logic (no CLI command yet)
```

## Feature Slice Pattern

Every feature follows the same structure:

```
features/<name>/
  command.ts      # register(program: Command) — CLI registration
  logic.ts        # computeX() — pure compute function, returns Result type
  *.test.ts       # Co-located tests
```

**`command.ts`** registers the CLI command with Commander. It calls the compute function from `logic.ts`, then formats and prints the result.

**`logic.ts`** exports a `computeX()` function that takes a context/params object and returns a typed `XResult` interface. Compute functions are pure — they take graph data as input and return structured results. Side effects (file writes) happen through a `refresh` callback.

**`*.test.ts`** files are co-located with their feature. Tests mock `process.cwd()` and `console.log/error` for command testing.

Example from `features/status/command.ts`:

```typescript
export function register(program: Command): void {
  program
    .command('status')
    .description('Dashboard: what\'s ready, blocked, in progress')
    .option('--json', 'Output as JSON')
    .action((options) => statusCommand(options));
}
```

## Core Modules

### context.ts

`createContext(cwd)` is the entry point for all commands. It loads the trellis config (from `.trellis/config` if directory format, or `.trellis` if legacy file format), scans the plans directory, and builds the dependency graph. Returns a `TrellisContext` with `config`, `plansDir`, `graph` (containing `plans`, `dependents`, `dependencies`).

### graph.ts

Builds the DAG from scanned plans. Key functions:

- `buildGraph()` — creates adjacency lists (dependents + dependencies)
- `detectCycles()` — finds circular dependencies
- `topologicalSort()` — orders plans respecting dependencies
- `computeCriticalPath()` — longest dependency chain
- `pickNext()` — selects highest-priority ready plan (forward path depth + topo tiebreak)
- `computeChunks()` — groups plans into reviewable subgraphs

### schema.ts

Handles plan file structure:

- `detectSections()` — extracts `##` headings, ignoring fenced code blocks
- `readSection()` / `writeSection()` — offset-based section manipulation
- `validateStatusGate()` — checks file/section requirements for status transitions

### worktree.ts

Detects git worktrees and overrides manifest repo paths when CWD is a worktree. Key functions:

- `detectWorktree(dir)` — checks if `dir` has a `.git` file (worktree marker), follows `gitdir:` pointer and `commondir` to find the main repo root
- `applyWorktreeOverride(repos, cwd)` — if CWD is a worktree of a manifest repo, substitutes the worktree path for that repo's canonical path

Both have async variants (`detectWorktreeAsync`, `applyWorktreeOverrideAsync`). Used in `cached-context.ts` and `mcp.ts` after `resolveProjectRepos()` to ensure plans resolve to the worktree path.

### frontmatter.ts

- `parseFrontmatter()` — parses YAML frontmatter via gray-matter, returns null on corrupt YAML
- `updatePlanFile()` — writes frontmatter changes back to file (spreads to avoid gray-matter caching bugs)

## Build System

The build script (`build.mjs`) produces three outputs:

1. **`dist/trellis.cjs`** — CLI binary with shebang, CJS format
2. **`dist/index.mjs`** — Library ESM export
3. **`dist/index.cjs`** — Library CJS export

TypeScript declarations (`dist/index.d.ts`) are generated separately via `tsc -p tsconfig.lib.json`.

### CJS Output Format

The CLI binary uses CJS (not ESM) because Commander and gray-matter use `require()` for Node built-ins. esbuild's ESM format doesn't generate proper shims for these. The `.cjs` extension sidesteps the `"type": "module"` declared in `package.json`.

### Dagre Injection Plugin

The graph viewer needs the dagre layout library in the browser. A custom esbuild plugin:

1. Bundles dagre as an IIFE
2. Injects the bundle into the HTML template (replacing a `/* __DAGRE_BUNDLE__ */` placeholder)
3. Exports the complete HTML as a JS string in the CLI bundle

## Test Patterns

Tests use Vitest and follow these conventions:

- **Co-located:** Tests live next to their feature code (`features/status/status.test.ts`)
- **Fixture helper:** `createFixture()` in test helpers creates temp directories with plan structures
- **Process mocking:** Tests mock `process.cwd()` to point at fixture directories
- **Console capture:** Tests spy on `console.log` / `console.error` to assert CLI output
- **Force flag:** Most tests use `{ force: true }` on `update()` to bypass status gates (dedicated gate tests in `schema.test.ts`)

Run tests:

```bash
npm test              # vitest run (all tests)
npm run dev           # vitest watch mode
npm run test:dist     # build + integration test of dist output
```

## Library API

Trellis also exports a programmatic API for embedding in other tools. Import from the package:

```typescript
import { createContext, computeStatus, computeReady } from 'trellis';

const ctx = createContext(process.cwd());
const status = computeStatus({ graph: ctx.graph });
const ready = computeReady({ graph: ctx.graph });
```

See `src/index.ts` for the full list of exported types and functions.
