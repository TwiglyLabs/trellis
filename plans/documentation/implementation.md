## Steps

1. Write `README.md` — one-paragraph description of trellis, install instructions (`npm install -g trellis` or local build), and a quick start workflow showing `trellis status → trellis ready → trellis update`. Link to `docs/` for deeper reference.

2. Write `docs/architecture.md` — describe the codebase layout after the vertical-slice refactor: `core/` vs `features/`, how commands are structured (`logic.ts` / `command.ts` / `*.test.ts`), test patterns (co-located tests, `createFixture` helper, mocking `process.cwd` and `console.log`), and the build system (esbuild, dagre injection plugin, CJS output rationale).

3. Write `docs/plan-schema.md` — canonical spec for plan files: directory structure (`README.md`, `implementation.md`, `inputs.md`, `outputs.md`), full frontmatter field reference with types and defaults, status lifecycle diagram, status gates table (transition → required files/sections), and section requirements per file.

4. Write `docs/cli-reference.md` — one section per command (`init`, `status`, `ready`, `update`, `show`, `lint`, `graph`, `epic`, `chunks`, `metrics`, `create`, `set`, `rename`, `archive`, `fetch`, `mcp`, `setup-hooks`) covering synopsis, flags, examples, and exit codes. Cross-check each entry against `trellis <cmd> --help` output.

5. Write `docs/mcp-reference.md` — one section per MCP tool (`trellis_create`, `trellis_write_section`, `trellis_read_section`, `trellis_set`, `trellis_update`) with the full Zod input schema, a JSON example request, an example response, and common usage patterns.

6. Write `docs/for-agents.md` — agent-oriented guide: adding trellis to a project via `.mcp.json`, the recommended MCP workflow (`create → write sections → set fields → update status`), how to read existing plans, and common pitfalls (never edit plan files directly, use `--force` sparingly, `status` is set via `trellis_update` not `trellis_set`).

7. Slim down `CLAUDE.md` — keep only: one-line purpose, one-line stack, development commands block, the "never edit plan files directly" rule + MCP tool table, and a "Documentation" section linking to `docs/plan-schema.md`, `docs/cli-reference.md`, `docs/architecture.md`, `docs/mcp-reference.md`, `docs/for-agents.md`. Remove the frontmatter schema, full command list, plan structure, status gates, "How It Works" section, and plan granularity notes. Update the freshness date. Target: under ~60 lines.

## Testing

- Run `trellis lint` in the trellis repo — no errors or warnings.
- Read through each doc file and verify every command/tool name matches what `trellis --help` and `trellis mcp` actually expose.
- Confirm `docs/plan-schema.md` status gates table matches `STATUS_GATES` in `src/schema.ts`.
- Confirm `docs/mcp-reference.md` input schemas match the Zod schemas in `src/mcp.ts`.
- Follow the `docs/for-agents.md` workflow end-to-end in a scratch project to verify it works as written.

## Done-when

- All six doc files exist and are populated.
- README.md quick start is accurate against the current binary.
- Each CLI command in `docs/cli-reference.md` is documented with at least one example.
- Each MCP tool in `docs/mcp-reference.md` has a working example request/response pair.
- `docs/for-agents.md` walkthrough is verified end-to-end.
- No broken internal links between docs.
- CLAUDE.md is under ~60 lines with links to docs/ for detailed content
