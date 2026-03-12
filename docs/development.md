# Development

## Stack

TypeScript, Node.js >= 20, single binary via esbuild bundle, zero runtime dependencies beyond Node.

**Libraries:** Commander (CLI framework), gray-matter (YAML frontmatter), Vitest (tests), esbuild (bundler).

## Prerequisites

- Node.js >= 20
- npm

## Build

```bash
npm install
npm run build        # esbuild bundle → dist/
npm run dev          # watch mode (vitest + rebuild on change)
```

The build script (`build.mjs`) produces three outputs:

| Output | Format | Purpose |
|--------|--------|---------|
| `dist/trellis.cjs` | CJS with shebang | CLI binary |
| `dist/index.mjs` | ESM | Library export |
| `dist/index.cjs` | CJS | Library export |

TypeScript declarations (`dist/index.d.ts`) are generated separately via `tsc -p tsconfig.lib.json`.

**Important:** Always use the `trellis` command (installed at `/opt/homebrew/bin/trellis`), not `node dist/trellis.cjs`.

### Why CJS for the CLI binary

The CLI binary uses CJS (not ESM) because Commander and gray-matter use `require()` for Node built-ins. esbuild's ESM format doesn't generate proper shims for these. The `.cjs` extension sidesteps the `"type": "module"` declared in `package.json`.

### Dagre Injection Plugin

The graph viewer needs the dagre layout library in the browser. A custom esbuild plugin:

1. Bundles dagre as an IIFE
2. Injects the bundle into the HTML template (replacing a `/* __DAGRE_BUNDLE__ */` placeholder)
3. Exports the complete HTML as a JS string in the CLI bundle

## Install from Source

```bash
git clone https://github.com/twiglylabs/trellis.git && cd trellis
npm install
npm run build
npm link
```

## Testing

```bash
npm test              # vitest run (all tests)
npm run dev           # vitest watch mode
npm run test:dist     # build + integration test of dist output
```

### Test Conventions

- **Co-located:** Tests live next to their feature code (`features/status/status.test.ts`)
- **Fixture helper:** `createFixture()` in test helpers creates temp directories with plan structures
- **Process mocking:** Tests mock `process.cwd()` to point at fixture directories
- **Console capture:** Tests spy on `console.log` / `console.error` to assert CLI output
- **Force flag:** Most tests use `{ force: true }` on `update()` to bypass status gates (dedicated gate tests in `schema.test.ts`)

## Adding a Command

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

After creating the feature module, import and register it in `src/cli.ts`.

## Design Principles

- **File-first.** Plan files are the entire state. No hidden databases or config.
- **Frontmatter-driven.** Metadata lives in the plan file itself. No manifest to sync.
- **Project-local.** Each project owns its own plans directory.
- **Read-heavy.** Most usage is `status`, `show`, `graph`. Writes are `update`.
- **Pure compute functions.** Logic is separated from I/O. `command.ts` handles I/O; `logic.ts` is pure.

## Library API

Trellis exports a programmatic API for embedding in other tools:

```typescript
import { createContext, computeStatus, computeReady } from 'trellis';

const ctx = createContext(process.cwd());
const status = computeStatus({ graph: ctx.graph });
const ready = computeReady({ graph: ctx.graph });
```

See `src/index.ts` for the full list of exported types and functions.

## Plan Management During Development

**Never use Edit, Write, or Bash to modify plan files.** Plans are managed exclusively through trellis MCP tools. Claude Code hooks will block direct file edits.

| Operation | MCP Tool |
|-----------|----------|
| Create a new plan | `trellis_create` |
| Read plan content or a section | `trellis_read_section` |
| Write/update plan content | `trellis_write_section` |
| Update metadata (title, tags, etc.) | `trellis_set` |
| Change plan status | `trellis_update` |
