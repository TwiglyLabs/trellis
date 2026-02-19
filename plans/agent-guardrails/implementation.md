# Implementation

## Steps

1. Build Claude Code hook for Edit/Write — a hook script that reads the tool call's `file_path` argument and checks if it resolves to a path inside the configured `plans_dir`. If so, exits non-zero with a message pointing to the correct MCP tools. The script reads `.trellis` to find `plans_dir` (defaulting to `plans/`). Two hooks, one for each tool, both using the same path-check logic.

2. Build pre-commit hook — shell script that identifies staged files in `plans/`, runs `trellis lint` scoped to those plans, rejects commit if errors found. Only lints plans that have staged changes, not the full scan. Fast path: if no staged files are in `plans/`, exit 0 immediately.

3. Write CLAUDE.md plan management section — instructions for agents covering: use trellis MCP tools exclusively, which tool for which operation, plan granularity guidance ("implementable in half a context session"), review checklist for plan size. Include concrete examples of the MCP tool workflow.

4. Extend `trellis init` — add prompts to install Claude Code hooks (writes hook configuration), install git pre-commit hook, and add CLAUDE.md plan management section. Each optional, respects existing configuration. Idempotent — safe to run on a project that already has hooks.

5. Add `trellis setup-hooks` — standalone command for adding hooks to existing projects. Does the same hook installation as init, without the project scaffolding. Useful for projects that already have `.trellis` but were set up before hooks existed.

## Testing

- Edit hook blocks writes to files inside `plans/` with instructive MCP tool suggestions
- Edit hook allows writes to files outside `plans/`
- Write hook blocks writes to files inside `plans/` with instructive MCP tool suggestions
- Write hook allows writes to files outside `plans/`
- Hooks correctly resolve `plans_dir` from `.trellis` config (not hardcoded)
- Pre-commit hook catches lint errors in staged plan files
- Pre-commit hook passes when plans are valid
- Pre-commit hook is fast when no plan files are staged
- `trellis init` with hook installation produces working hook configuration
- `trellis setup-hooks` is idempotent — running twice doesn't duplicate hooks
- CLAUDE.md section includes correct MCP tool names and usage examples

## Done-when

- Claude Code hooks block `Edit` and `Write` on plan files with messages pointing to MCP tools
- Pre-commit hook rejects commits with invalid plan structure
- `trellis init` offers hook installation
- `trellis setup-hooks` works on existing projects
- CLAUDE.md includes plan management instructions referencing MCP tools
- An agent attempting to Edit a plan file gets blocked and told which MCP tool to use instead
