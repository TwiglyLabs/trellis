# MCP Integration

Trellis exposes ten tools via the [Model Context Protocol](https://modelcontextprotocol.io/) for AI agent integration. The server runs on stdio transport — six write tools (JSON responses) and four read-only query tools (structured text responses).

## Setup

### Add MCP Server

Add the Trellis MCP server to your project's `.mcp.json`:

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

### Install Hooks

Run `trellis setup-hooks` to install Claude Code hooks that prevent direct file edits to plan files. This ensures all plan modifications go through trellis, maintaining frontmatter integrity.

### Starting the Server Manually

```bash
trellis mcp
```

All communication uses JSON-RPC over stdin/stdout.

---

## Write Tools

### trellis_create

Scaffold a new plan directory with `README.md` containing frontmatter and section headings.

**Input Schema:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | Plan ID (becomes directory name under plans/) |
| `title` | string | Yes | Plan title for frontmatter |
| `description` | string | No | One-line description |
| `depends_on` | string[] | No | Plan IDs this depends on |
| `tags` | string[] | No | Freeform tags |

**Example Request:**

```json
{
  "id": "auth-system",
  "title": "Authentication System",
  "description": "Add user login and session management",
  "depends_on": ["core-types", "database-schema"],
  "tags": ["foundation", "epic:v1"]
}
```

**Example Response:**

```json
{
  "id": "auth-system",
  "filePath": "plans/auth-system/README.md"
}
```

---

### trellis_write_section

Write prose content into a specific section of a plan file. Replaces everything between `##` headings.

**Input Schema:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `plan_id` | string | Yes | Plan ID |
| `file` | enum | Yes | `readme`, `implementation`, `inputs`, or `outputs` |
| `section` | string | Yes | Section name (e.g., `"Problem"`, `"Approach"`, `"Steps"`) |
| `content` | string | Yes | Markdown content to write into the section |

**Example Request:**

```json
{
  "plan_id": "auth-system",
  "file": "readme",
  "section": "Problem",
  "content": "\nUsers currently have no way to log in. The app serves all content anonymously,\nwhich prevents personalization and access control.\n"
}
```

**Example Response:**

```json
{
  "id": "auth-system",
  "file": "readme",
  "section": "Problem"
}
```

If the section doesn't exist in the file, it is appended at the end. If the file doesn't exist, it is created.

---

### trellis_write_sections

Write multiple sections to a plan in one atomic operation. Groups writes by file — each file gets a single read-modify-write cycle. Preferred over multiple `trellis_write_section` calls when writing several sections at once.

**Input Schema:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `plan_id` | string | Yes | Plan ID |
| `writes` | array | Yes | Array of section writes (min 1) |
| `writes[].file` | enum | Yes | `readme`, `implementation`, `inputs`, or `outputs` |
| `writes[].section` | string | Yes | Section name (e.g., `"Problem"`, `"Steps"`) |
| `writes[].content` | string | Yes | Markdown content for the section |

**Example Request:**

```json
{
  "plan_id": "auth-system",
  "writes": [
    { "file": "readme", "section": "Problem", "content": "Users cannot log in.\n" },
    { "file": "readme", "section": "Approach", "content": "Add OAuth2 with session tokens.\n" },
    { "file": "implementation", "section": "Steps", "content": "1. Add login endpoint\n2. Add session middleware\n" }
  ]
}
```

**Example Response:**

```json
{
  "id": "auth-system",
  "writes": [
    { "file": "readme", "section": "Problem" },
    { "file": "readme", "section": "Approach" },
    { "file": "implementation", "section": "Steps" }
  ]
}
```

This tool eliminates race conditions when writing multiple sections — all writes to the same file are applied to a single in-memory copy before writing back to disk.

---

### trellis_set

Update a frontmatter field on a plan. Cannot set `status` — use `trellis_update` for status transitions.

**Input Schema:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `plan_id` | string | Yes | Plan ID |
| `field` | string | Yes | Frontmatter field name (not `"status"`) |
| `value` | string or string[] | Yes | New value |
| `mode` | enum | No | `replace` (default), `add`, or `remove`. `add`/`remove` only for list fields. |

**Editable fields:** `title`, `description`, `depends_on`, `tags`, `repo`, `assignee`.

**List fields** (support `add`/`remove` mode): `depends_on`, `tags`.

**Example: Replace a field**

```json
{
  "plan_id": "auth-system",
  "field": "description",
  "value": "OAuth2 login with session tokens"
}
```

**Example: Add a tag**

```json
{
  "plan_id": "auth-system",
  "field": "tags",
  "value": ["security"],
  "mode": "add"
}
```

**Example Response:**

```json
{
  "id": "auth-system",
  "field": "tags",
  "value": ["foundation", "epic:v1", "security"],
  "previous_value": ["foundation", "epic:v1"]
}
```

---

### trellis_update

Transition a plan to a new status. Enforces [status gates](plan-schema.md#status-gates) unless `force` is true.

**Input Schema:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `plan_id` | string | Yes | Plan ID |
| `status` | enum | Yes | `draft`, `not_started`, `in_progress`, `done`, `archived` |
| `force` | boolean | No | Bypass status gate validation |

**Example Request:**

```json
{
  "plan_id": "auth-system",
  "status": "in_progress"
}
```

**Example Response:**

```json
{
  "id": "auth-system",
  "previous_status": "not_started",
  "status": "in_progress",
  "backward": false,
  "newly_ready": ["api-endpoints"]
}
```

The `newly_ready` array lists plans that became ready as a result of this status change.

---

### trellis_read_section

Read plan content at various granularities. Supports reading the whole plan, a specific file, or a specific section.

**Input Schema:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `plan_id` | string | Yes | Plan ID |
| `file` | enum | No | `readme`, `implementation`, `inputs`, or `outputs`. Omit for whole plan. |
| `section` | string | No | Section name. Requires `file`. |

**Example: Read whole plan**

```json
{
  "plan_id": "auth-system"
}
```

Returns concatenated content of all plan files.

**Example: Read specific file**

```json
{
  "plan_id": "auth-system",
  "file": "implementation"
}
```

Returns full content of `implementation.md`.

**Example: Read specific section**

```json
{
  "plan_id": "auth-system",
  "file": "readme",
  "section": "Problem"
}
```

Returns only the content under `## Problem`.

---

## Read Tools

Read tools return compact structured text (not JSON) optimized for LLM consumption.

### trellis_status

Get a summary of all plans grouped by status with next recommendation. Includes In Progress, Ready, Blocked, Draft, and Done sections. Done plans are shown as comma-separated IDs. Archived plans are omitted.

**Input Schema:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tag` | string | No | Filter plans by tag (e.g., `"epic:auth"`) |

**Example Response:**

```
# my-project (12 plans) (tag: epic:auth)
Next: login-page

## In Progress (1)
- api-redesign: Redesign API layer [alice]

## Ready (2)
- login-page: Login Page
- core-types: Core Types

## Blocked (1)
- user-profile: User Profile (waiting on: login-page)

## Draft (1)
- v2-planning: Version 2 Planning

## Done (7)
plan-a, plan-b, plan-c, plan-d, plan-e, plan-f, plan-g
```

Empty sections are omitted. The `Next` line shows the highest-priority plan by forward path depth.

---

### trellis_show

Get detail for a single plan: metadata, dependencies, dependents, and critical path. Body content is not included — use `trellis_read_section` for that.

**Input Schema:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `plan_id` | string | Yes | Plan ID to show |

**Example Response:**

```
# Authentication System (auth-system)
Status: not_started (ready)
Type: feature
Tags: epic:auth, security
Assignee: alice

Add user login and session management

## Dependencies
✓ core-types (done)
○ database-schema (in_progress)

## Blocks
user-profile, admin-panel

## Critical Path
database-schema → auth-system → user-profile
```

Returns an error (not exception) if the plan ID is not found.

---

### trellis_graph

Get the dependency graph as edges and chunks. Nodes are not included (use `trellis_status` for plan metadata).

**Input Schema:** None.

**Example Response:**

```
# my-project dependency graph

## Edges
core-types → auth-system
auth-system → user-profile

## Chunks
### chunk-1 (3 plans, 450 lines)
Plans: core-types, auth-system, user-profile
Roots: core-types | Leaves: user-profile

## Cross-chunk Edges
logging (chunk-2) → user-profile (chunk-1)
```

Edges point from dependency to dependent (`from` must complete before `to` can start). Empty sections are omitted.

---

### trellis_lint

Validate plans and return issues. Checks for cycles, missing dependencies, frontmatter errors, orphans, inconsistencies, and status gate violations.

**Input Schema:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `strict` | boolean | No | When true, warnings also cause `ok` to be false |

**Example Response:**

```
# Lint (1 errors, 1 warnings)

## Errors
- broken-plan: Unknown dependency: broken-plan depends on "nonexistent"

## Warnings
- orphan-plan: Orphaned plan: orphan-plan has no dependents and status is draft

ok: false
```

---

### trellis_bottlenecks

Analyze project bottlenecks: blocking factors, stuck plans, staleness, and health summary.

**Input Schema:** None.

**Example Response:**

```
# Bottlenecks

## High Blocking
- api-redesign: blocks 8 transitively (in_progress)

## Stuck
- plan-auth: 14 days in status

## Stale
- plan-v1-compat: 30 days in draft

## Health
15 total, 8 active, 3 blocked, 2 stuck, parallelism: 3
```

Empty sections are omitted. Health summary is always present.

---

## Error Handling

All tools return errors in this format:

```json
{
  "content": [{ "type": "text", "text": "Plan not found: nonexistent-plan" }],
  "isError": true
}
```

Common errors:
- Plan not found
- Status gate validation failed (lists missing requirements)
- `trellis_set` rejects `status` field (use `trellis_update`)
- `trellis_set` rejects unknown field names
- `trellis_read_section` rejects `section` without `file`

---

## Agent Workflows

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

---

## CLI Commands for Querying State

These CLI commands are useful for read-only queries from agent context:

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

---

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

---

## Common Pitfalls

**Never edit plan files directly.** Always use MCP tools (`trellis_write_section`, `trellis_set`, `trellis_update`). Direct edits bypass frontmatter validation, can corrupt YAML, and are blocked by Claude Code hooks if installed.

**Use `trellis_update` for status, not `trellis_set`.** The `set` tool explicitly rejects the `status` field. Status transitions need `trellis_update` because it enforces gates, sets timestamps, and reports newly-ready plans.

**Use `force` sparingly.** The `force` flag on `trellis_update` bypasses status gate validation. Gates exist to ensure plans are properly structured before advancing. Only use `force` when you know the gate check is wrong (e.g., during testing or migration).

**Section names are case-sensitive.** `"Problem"` works, `"problem"` does not. Match the exact heading text.

**`trellis_read_section` with `section` requires `file`.** You can't read a section across all files — specify which file the section is in.

**Plan IDs are directory names.** When creating plans, the `id` becomes the directory name under `plans/`. Use kebab-case: `my-feature`, not `My Feature`.

---

## Git Worktree Support

Trellis automatically detects when you're running from a git worktree. In project mode (multi-repo with manifest), if your CWD is a worktree of a manifest repo, trellis resolves plans against the worktree path instead of the canonical repo path. This means:

- `trellis_create` writes plans into the worktree, so they appear in `git status`
- `trellis status` reads plans from the worktree's branch
- No manual file moving or cherry-picking needed

This is transparent — no configuration required. Single-repo mode is unaffected (it already uses CWD directly).

---

## Plan Granularity

Plans should be implementable in roughly half a context session. Signs a plan is too big:

- More than ~15 implementation steps
- Touches more than 5-6 files
- Mixes unrelated concerns

If a plan feels too big, split it into smaller plans with `depends_on` edges.
