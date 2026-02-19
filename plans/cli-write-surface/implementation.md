# Implementation

## Steps

1. Add section read/write utilities — `readSection(filePath, section?)` returns section content. `writeSection(filePath, section, content)` replaces section content between `##` boundaries. `detectSections(content)` extracts `##` headings (skipping fenced code blocks). These are the core primitives shared by MCP tools and CLI commands.

2. Add `Trellis` API methods — `create(id, opts)`, `set(id, field, value, mode)`, `writeSection(planId, file, section, content)`, `readSection(planId, file?, section?)`, `rename(oldId, newId)`, `archive(id)`. Each method validates inputs and delegates to filesystem operations. `update()`, `status()`, `ready()`, `show()` already exist — extend `show()` to support file/section granularity.

3. Implement CLI commands — `trellis create`, `trellis set`, `trellis rename`, `trellis archive`. Each is a thin wrapper calling the corresponding `Trellis` method. Enhance `trellis show` with `--file`, `--section`, `--raw` flags. Deprecate `--contracts` (still works, hidden from help).

4. Build MCP server — `src/mcp.ts` using `@modelcontextprotocol/sdk`. Register five tools: `trellis_create`, `trellis_write_section`, `trellis_read_section`, `trellis_set`, `trellis_update`. Each tool handler instantiates `Trellis` for the current working directory and calls the corresponding API method. Define input schemas with Zod. Connect via `StdioServerTransport`.

5. Add `trellis mcp` subcommand — Commander action that starts the MCP server on stdio. All logging goes to stderr (stdout is the JSON-RPC channel). No other output on startup.

6. Extend `trellis init` — generate `.mcp.json` at project root with the trellis MCP server configuration. Respect existing `.mcp.json` (merge, don't overwrite). Add `trellis` entry to `mcpServers` if not present.

7. Bundle MCP dependencies — add `@modelcontextprotocol/sdk` and `zod` to dependencies. Ensure esbuild bundles them into `dist/trellis.cjs`. Verify the `trellis mcp` subcommand works from the bundled binary.

## Testing

- Section utilities: `detectSections()` skips `##` inside fenced code blocks, handles empty files, nested headings. `readSection()` returns correct content boundaries. `writeSection()` replaces section content, appends new sections, preserves surrounding content.
- `Trellis.create()`: generates correct directory structure, rejects duplicate IDs, validates title required
- `Trellis.set()`: updates frontmatter correctly, rejects `status` field, validates `depends_on` references exist, `add` mode appends to lists, `remove` mode removes from lists, errors on `add`/`remove` for scalar fields
- `Trellis.writeSection()`: content lands in correct section, section boundaries respected (subheadings preserved), rejects writes that break required sections, creates missing optional files, appends missing sections
- `Trellis.readSection()`: returns correct content at plan/file/section granularity
- `Trellis.rename()`: moves directory, updates all `depends_on` references across project, rejects existing target ID
- `Trellis.archive()`: blocks on active dependents with clear error message, moves to `.archive/` when clear
- MCP server: starts on stdio, responds to `tools/list`, each of the five tools returns correct results, input validation rejects bad params with useful errors
- CLI commands: `create`, `set`, `show --file/--section/--raw`, `rename`, `archive` all work
- `trellis init`: creates `.mcp.json` with correct content, merges into existing `.mcp.json` without clobbering
- Bundle: `trellis mcp` works from `dist/trellis.cjs`

## Done-when

- MCP server exposes five agent tools with Zod-validated input schemas
- `trellis mcp` starts cleanly from the bundled binary
- Section read/write works at the `(plan_id, file, section)` granularity
- All API methods tested independently of both CLI and MCP layers
- `trellis init` produces a `.mcp.json` that Claude Code reads on startup
- CLI commands work for human use (create, set, show, rename, archive)
- Existing `--json` output on all commands remains stable for canopy consumption
