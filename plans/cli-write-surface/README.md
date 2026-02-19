---
title: CLI Write Surface & MCP Server
status: not_started
depends_on:
  - plan-schema
tags: [cli, mcp, plan-management]
description: Add trellis CLI commands and an MCP server — the data layer API for plan management
---

# CLI Write Surface & MCP Server

Build the plan management API — CLI commands for humans, MCP tools for agents, structured JSON output for canopy (the UI layer in a sibling repo).

## Problem

Trellis has a solid read layer (`status`, `ready`, `show`, `graph` all support `--json`) but no controlled write layer. Agents edit plan files directly, causing breakage — wrong status enum values, moved files breaking dependency IDs, malformed frontmatter, missing sections.

CLI commands route through Bash, which means multi-line prose requires heredocs or temp files — janky for agent workflows. The agent interface should be structured tool calls with typed parameters.

## Approach

Two interfaces to the same underlying API:

1. **CLI commands** — for humans in the terminal, and `--json` output for canopy
2. **MCP server** — for agents via structured tool calls

Both call the same `Trellis` class methods. The `Trellis` class is the real API — CLI and MCP are thin layers over it.

### MCP Server (`trellis mcp`)

A stdio-based MCP server using `@modelcontextprotocol/sdk`. Started as a subprocess by Claude Code, configured via `.mcp.json` at the project root.

Tools exposed:

#### `trellis_create`

Scaffolds a new plan directory.

| Param | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Plan ID (becomes directory name under `plans/`) |
| `title` | string | yes | Plan title for frontmatter |
| `description` | string | no | One-line description |
| `depends_on` | string[] | no | Plan IDs this depends on |
| `tags` | string[] | no | Freeform tags |

Creates `plans/<id>/` with README.md (frontmatter + `## Problem` / `## Approach` headings). Sets initial status to `draft`. Fails if plan already exists.

#### `trellis_write_section`

Writes prose content into a specific section of a plan file. This is the core editing primitive for agents.

| Param | Type | Required | Description |
|---|---|---|---|
| `plan_id` | string | yes | Plan ID |
| `file` | enum | yes | `readme`, `implementation`, `inputs`, `outputs` |
| `section` | string | yes | Section name (e.g. `problem`, `approach`, `steps`) |
| `content` | string | yes | Markdown content to write into the section |

Section boundaries: a section spans from its `##` heading to the next `##` heading (or EOF). Subheadings (`###`, `####`) within the content are preserved as part of the section.

Behavior:
- Replaces the section's content (everything between the `##` heading and the next `##` heading)
- If the section doesn't exist, appends it to the file
- If the file doesn't exist, creates it with the section (only for optional files: inputs, outputs)
- Validates that required sections aren't deleted by the write
- Returns the updated section content for confirmation

#### `trellis_read_section`

Reads plan content at various granularities.

| Param | Type | Required | Description |
|---|---|---|---|
| `plan_id` | string | yes | Plan ID |
| `file` | enum | no | Specific file to read. Omit for whole plan. |
| `section` | string | no | Specific section. Requires `file`. |

Returns markdown content. Without `file`, returns all plan files concatenated with file headers. Without `section`, returns the full file. With both, returns just that section's content.

#### `trellis_set`

Updates frontmatter fields.

| Param | Type | Required | Description |
|---|---|---|---|
| `plan_id` | string | yes | Plan ID |
| `field` | string | yes | Frontmatter field name (not `status` — use `trellis_update`) |
| `value` | string \| string[] | yes | New value |
| `mode` | enum | no | `replace` (default), `add`, `remove`. `add`/`remove` only for list fields. |

Validates field names against known frontmatter schema. Validates `depends_on` references exist. Rejects `status` (use `trellis_update` for status transitions with gates).

#### `trellis_update`

Status transition with gates. Wraps existing `update` logic.

| Param | Type | Required | Description |
|---|---|---|---|
| `plan_id` | string | yes | Plan ID |
| `status` | enum | yes | Target status |
| `force` | boolean | no | Bypass gates |

Returns previous status, new status, whether it was a backward transition, and newly unblocked plans.

### CLI commands

New CLI commands for humans (and `--json` output for canopy):

- **`trellis create <id> --title "..." [--depends-on ...] [--tags ...]`** — scaffolds plan directory
- **`trellis set <id> <field> [values...] [--add | --remove]`** — updates frontmatter
- **`trellis show <id> [--file <name>] [--section <name>] [--raw] [--json]`** — reads plan content
- **`trellis rename <old-id> <new-id>`** — renames with reference updates
- **`trellis archive <id>`** — archives plan
- **`trellis update`** — status transitions (already exists)

`trellis show` gains `--file` and `--section` flags for granular reads, and `--raw` for unformatted output. `--contracts` is deprecated in favor of `--file inputs` / `--file outputs`.

`rename` and `archive` are CLI-only for now — they're infrequent operations run by humans, not agents.

### Installation

`trellis init` creates `.mcp.json` at the project root:

```json
{
  "mcpServers": {
    "trellis": {
      "type": "stdio",
      "command": "trellis",
      "args": ["mcp"]
    }
  }
}
```

Claude Code reads this on startup, spawns `trellis mcp`, and the tools appear natively in the session. User approves once on first use.

### Shared internals

Both interfaces call the same `Trellis` class methods:

| Method | CLI command | MCP tool |
|---|---|---|
| `create()` | `trellis create` | `trellis_create` |
| `writeSection()` | — | `trellis_write_section` |
| `readSection()` | `trellis show --file --section` | `trellis_read_section` |
| `set()` | `trellis set` | `trellis_set` |
| `update()` | `trellis update` | `trellis_update` |
| `rename()` | `trellis rename` | — |
| `archive()` | `trellis archive` | — |
| `status()` | `trellis status` | — |
| `ready()` | `trellis ready` | — |
