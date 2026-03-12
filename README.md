# Trellis

Lightweight CLI for managing plans with dependencies.

## What it does

Trellis turns a directory of markdown files into a dependency-aware plan graph. Each plan is a directory containing a `README.md` with YAML frontmatter that declares its title, status, and dependencies. Trellis scans these files, builds a directed acyclic graph from `depends_on` edges, and answers the question "what can I work on right now?"

The core problem Trellis solves is execution order for multi-step work. When building software with AI agents, a session has a limited context window. Work needs to be decomposed into discrete plans, and those plans need to execute in the right order — foundations before features, interfaces before consumers. Trellis makes that dependency structure explicit and machine-readable, so both humans and agents always know what's ready, what's blocked, and what to work on next.

Trellis also exposes an MCP server so AI agents can read and update plans directly during a session, without touching files manually. Plans are the agent's work queue, and Trellis is the queue manager.

## Key concepts

**Plan** — A directory under `plans/` containing a `README.md` with YAML frontmatter. The directory name is the plan ID. Plans hold the problem statement, approach, implementation steps, and done criteria for a discrete piece of work.

**Dependency** — A `depends_on` edge in a plan's frontmatter. A plan is not ready until all plans it depends on have status `done`.

**DAG** — The directed acyclic graph Trellis builds from all `depends_on` edges. The graph determines execution order, identifies blocked plans, and computes the critical path.

**Status** — A plan's lifecycle stage: `draft`, `not_started`, `in_progress`, `done`, or `archived`. Status transitions are gated — Trellis enforces that required sections exist before a plan can advance.

**Epic** — A grouping of related plans via `epic:<name>` tags. `trellis epic` shows completion progress per epic.

## Quick start

```bash
# Install
npm install -g trellis

# Initialize Trellis in your project
trellis init

# Create a plan
trellis create my-feature --title "Build the thing"

# See what's ready to work on
trellis ready

# Start working on a plan
trellis update my-feature in_progress

# See the full dashboard
trellis status

# Mark it done
trellis update my-feature done

# Visualize the dependency graph
trellis graph
```

## How it works

Plans are markdown directories with YAML frontmatter defining their dependencies:

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

Trellis scans the `plans/` directory, parses frontmatter from each plan's `README.md`, and builds a DAG from the `depends_on` edges. It uses the graph to determine which plans are ready (all dependencies done), blocked (unfinished dependencies), or in progress.

Status transitions are gated: advancing a plan to `not_started` requires `implementation.md` with `Steps`, `Testing`, and `Done-when` sections. Advancing to `done` requires `outputs.md` if the plan has dependents. These gates ensure plans are properly specified before work begins.

The plan files themselves are the source of truth. There is no separate manifest or database.

## CLI reference

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
| `trellis create-batch <file>` | Create multiple plans from a YAML batch file |
| `trellis set <id> <field> [values]` | Update frontmatter fields |
| `trellis rename <old> <new>` | Rename plan and update references |
| `trellis archive <id>` | Archive a plan |
| `trellis fetch` | Fetch plan state from project repos |
| `trellis sync` | Fetch and cache remote plan state in parallel |
| `trellis recent` | Show recently modified plans |
| `trellis bottlenecks` | Show blocking factors, stuck plans, and queue pressure |
| `trellis metrics` | Cycle time and session data for done plans |
| `trellis setup-hooks` | Install Claude Code hooks and git pre-commit hook |
| `trellis mcp` | Start MCP server for Claude Code integration |

See [docs/cli-reference.md](docs/cli-reference.md) for full flag and usage details.

## MCP integration

Trellis exposes an MCP server for AI agent integration. Add it to your project's `.mcp.json`:

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

Agents can create plans, read and write plan sections, update status, and query the graph — all without touching files directly. Claude Code hooks block direct file edits to maintain frontmatter integrity.

See [docs/mcp-integration.md](docs/mcp-integration.md) for tool schemas, agent workflows, and common pitfalls.

## Documentation

- [Architecture](docs/architecture.md)
- [CLI Reference](docs/cli-reference.md)
- [MCP Integration](docs/mcp-integration.md)
- [Plan Schema](docs/plan-schema.md)
- [Development](docs/development.md)

## Part of the TwiglyLabs toolchain

Trellis is one of five tools built to enable AI-driven software development:

| Tool | Role |
|------|------|
| [Canopy](https://github.com/twiglylabs/canopy) | Workspace dashboard |
| [Trellis](https://github.com/twiglylabs/trellis) | Plan management |
| [Grove](https://github.com/twiglylabs/grove) | Local environments |
| [Bark](https://github.com/twiglylabs/bark) | Quality gates |
| [SAP](https://github.com/twiglylabs/sap) | Session analytics |

Each tool works independently but they compose into a complete workflow.
