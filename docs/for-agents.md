# For Agents

Guide for AI agents working with trellis-managed plans.

## Setup

### 1. Add MCP Server

Trellis provides an MCP server so agents can manage plans programmatically. Add it to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "trellis": {
      "command": "trellis",
      "args": ["mcp"]
    }
  }
}
```

Or run `trellis init` — it creates this config automatically.

### 2. Install Hooks

Run `trellis setup-hooks` to install Claude Code hooks that prevent direct file edits to plan files. This ensures all plan modifications go through trellis, maintaining frontmatter integrity.

## Available MCP Tools

| Tool | Purpose |
|------|---------|
| `trellis_create` | Create a new plan |
| `trellis_read_section` | Read plan content (whole plan, file, or section) |
| `trellis_write_section` | Write content to a plan section |
| `trellis_set` | Update frontmatter fields (not status) |
| `trellis_update` | Change plan status |

See [mcp-reference.md](mcp-reference.md) for full schemas and examples.

## Recommended Workflow

### Starting Work

```
1. trellis status                             # CLI: see what's available (includes Next recommendation)
2. trellis_read_section(plan_id="my-plan")    # MCP: read the full plan
3. trellis_update(plan_id="my-plan",          # MCP: claim it
                  status="in_progress")
```

### Writing a Plan

```
1. trellis_create(id="new-feature", title="New Feature")

2. trellis_write_section(plan_id="new-feature",
                         file="readme", section="Problem",
                         content="...")

3. trellis_write_section(plan_id="new-feature",
                         file="readme", section="Approach",
                         content="...")

4. trellis_write_section(plan_id="new-feature",
                         file="implementation", section="Steps",
                         content="...")

5. trellis_write_section(plan_id="new-feature",
                         file="implementation", section="Testing",
                         content="...")

6. trellis_write_section(plan_id="new-feature",
                         file="implementation", section="Done-when",
                         content="...")

7. trellis_update(plan_id="new-feature", status="not_started")
```

### Completing Work

```
1. trellis_update(plan_id="my-plan", status="done")
```

If the plan has dependents, ensure `outputs.md` exists first:

```
1. trellis_write_section(plan_id="my-plan",
                         file="outputs", section="API Surface",
                         content="...")

2. trellis_update(plan_id="my-plan", status="done")
```

### Updating Metadata

```
trellis_set(plan_id="my-plan", field="tags", value=["v2"], mode="add")
trellis_set(plan_id="my-plan", field="assignee", value="agent-1")
trellis_set(plan_id="my-plan", field="description", value="Updated summary")
```

## CLI Commands for Agents

These CLI commands are useful for querying state (read-only):

| Command | Use For |
|---------|---------|
| `trellis status` | See all plans, their state, and next recommendation |
| `trellis show <id>` | Inspect a plan's details and dependencies |
| `trellis lint` | Check for structural issues |
| `trellis epic` | Epic completion status |
| `trellis chunks` | See plan groupings for review |
| `trellis metrics` | Cycle time data for done plans |
| `trellis graph --json` | Dependency graph as JSON |
| `trellis fetch` | Sync cross-repo plan state |

All support `--json` for structured output.

## Handling Gate Failures

When `trellis_update` rejects a status transition, the error lists what's missing:

```
Status gate failed for "not_started":
  Missing file: implementation.md
  Missing section in README.md: ## Approach
```

To recover, write the missing content and retry:

```
1. trellis_write_section(plan_id="my-plan",
                         file="readme", section="Approach",
                         content="...")

2. trellis_write_section(plan_id="my-plan",
                         file="implementation", section="Steps",
                         content="...")

3. trellis_update(plan_id="my-plan", status="not_started")  # retry
```

## Common Pitfalls

**Never edit plan files directly.** Always use MCP tools (`trellis_write_section`, `trellis_set`, `trellis_update`). Direct edits bypass frontmatter validation, can corrupt YAML, and are blocked by Claude Code hooks if installed.

**Use `trellis_update` for status, not `trellis_set`.** The `set` tool explicitly rejects the `status` field. Status transitions need `trellis_update` because it enforces gates, sets timestamps, and reports newly-ready plans.

**Use `--force` sparingly.** The `force` flag on `trellis_update` bypasses status gate validation. Gates exist to ensure plans are properly structured before advancing. Only use `force` when you know the gate check is wrong (e.g., during testing or migration).

**Section names are case-sensitive.** `"Problem"` works, `"problem"` does not. Match the exact heading text.

**`trellis_read_section` with `section` requires `file`.** You can't read a section across all files — specify which file the section is in.

**Plan IDs are directory names.** When creating plans, the `id` becomes the directory name under `plans/`. Use kebab-case: `my-feature`, not `My Feature`.

## Git Worktree Support

Trellis automatically detects when you're running from a git worktree. In project mode (multi-repo with manifest), if your CWD is a worktree of a manifest repo, trellis resolves plans against the worktree path instead of the canonical repo path. This means:

- `trellis_create` writes plans into the worktree, so they appear in `git status`
- `trellis status` reads plans from the worktree's branch
- No manual file moving or cherry-picking needed

This is transparent — no configuration required. Single-repo mode is unaffected (it already uses CWD directly).

## Plan Granularity

Plans should be implementable in roughly half a context session. Signs a plan is too big:

- More than ~15 implementation steps
- Touches more than 5-6 files
- Mixes unrelated concerns

If a plan feels too big, split it into smaller plans with `depends_on` edges.
