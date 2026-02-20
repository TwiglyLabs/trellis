# Trellis

Lightweight CLI for managing plans with dependencies. Trellis scans a `plans/` directory, reads YAML frontmatter from markdown files, builds a dependency graph, and answers "what can I work on next?"

No manifest file. The plan files ARE the source of truth.

## Install

Requires Node.js >= 20.

```bash
npm install -g trellis
```

Or build from source:

```bash
git clone https://github.com/twiglylabs/trellis.git && cd trellis
npm install
npm run build
npm link
```

## Quick Start

```bash
# 1. Initialize trellis in your project
trellis init

# 2. Create a plan
trellis create my-feature --title "Build the thing"

# 3. Check what's ready to work on
trellis ready

# 4. Start working
trellis update my-feature in_progress

# 5. See the full dashboard
trellis status

# 6. Mark it done
trellis update my-feature done

# 7. Visualize the dependency graph
trellis graph
```

## How It Works

Each plan is a directory under `plans/` containing a `README.md` with YAML frontmatter:

```yaml
---
title: My Feature
status: not_started
depends_on:
  - core-types
tags: [foundation]
---

## Problem

What needs solving.

## Approach

How we'll solve it.
```

Trellis scans these files, builds a DAG from `depends_on` edges, and uses status + dependency state to determine what's ready, blocked, or in progress.

## Commands

| Command | Description |
|---------|-------------|
| `trellis init` | Scaffold `.trellis` config and `plans/` directory |
| `trellis status` | Dashboard: what's ready, blocked, in progress |
| `trellis ready` | List plans with all dependencies satisfied |
| `trellis update <id> <status>` | Transition a plan's status |
| `trellis show <id>` | Plan details and dependency chain |
| `trellis lint` | Find cycles, missing deps, bad frontmatter |
| `trellis graph` | Open DAG viewer in browser |
| `trellis epic [name]` | Epic completion status |
| `trellis chunks` | Identify reviewable subgraphs |
| `trellis create <id>` | Scaffold a new plan directory |
| `trellis set <id> <field> [values]` | Update frontmatter fields |
| `trellis rename <old> <new>` | Rename plan and update references |
| `trellis archive <id>` | Archive a plan |
| `trellis fetch` | Fetch plan state from project repos |
| `trellis metrics` | Cycle time and session data for done plans |
| `trellis setup-hooks` | Install Claude Code hooks + git pre-commit |
| `trellis mcp` | Start MCP server for Claude Code integration |

See [docs/cli-reference.md](docs/cli-reference.md) for full flag and usage details.

## MCP Integration

Trellis includes an MCP server for AI agent integration. Add it to your project's `.mcp.json`:

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

See [docs/mcp-reference.md](docs/mcp-reference.md) for tool schemas and [docs/for-agents.md](docs/for-agents.md) for agent workflows.

## Documentation

- [CLI Reference](docs/cli-reference.md) — every command, flag, and example
- [Plan Schema](docs/plan-schema.md) — plan structure, frontmatter fields, status gates
- [MCP Reference](docs/mcp-reference.md) — MCP tool schemas and examples
- [Architecture](docs/architecture.md) — codebase layout and development guide
- [For Agents](docs/for-agents.md) — agent-oriented setup and workflow guide

## License

MIT
