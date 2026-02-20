# CLI Reference

All commands support `-h, --help` for usage information.

**Exit codes:** 0 on success, 1 on error. When `--json` is used, errors are written to stderr and data to stdout.

---

## init

Scaffold a `.trellis` config file and `plans/` directory in the current project. Also creates/merges `.mcp.json` with the trellis MCP server config and installs Claude Code hooks via `setup-hooks`.

```
trellis init [options]
```

| Flag | Description |
|------|-------------|
| `-y, --yes` | Accept defaults without prompting |

```bash
trellis init
trellis init --yes
```

---

## status

Dashboard showing plans grouped by state: ready, blocked, in progress, done.

```
trellis status [options]
```

| Flag | Description |
|------|-------------|
| `--tag <tag>` | Filter by tag |
| `--repo <repo>` | Filter by repo |
| `--json` | Output as JSON |
| `--all` | Show all plans including done and archived |
| `--done` | Include done plans |
| `--archived` | Include archived plans |

Done and archived plans are hidden by default.

```bash
trellis status
trellis status --tag foundation
trellis status --json
trellis status --all
trellis status --done
```

---

## ready

List plans whose dependencies are all satisfied (status `done`).

```
trellis ready [options]
```

| Flag | Description |
|------|-------------|
| `--tag <tag>` | Filter by tag |
| `--repo <repo>` | Filter by repo |
| `--json` | Output as JSON |
| `--next` | Return only the highest-priority ready plan |

`--next` selects by forward path depth (plans that unblock the most work) with topological tiebreaking.

```bash
trellis ready
trellis ready --repo public
trellis ready --json
trellis ready --next
trellis ready --next --json
```

---

## update

Transition a plan to a new status. Enforces status gates (see [plan-schema.md](plan-schema.md#status-gates)) unless `--force` is used. Auto-sets timestamps (`started_at`, `completed_at`, etc.) on transitions.

```
trellis update [options] <plan-id> <status>
```

| Flag | Description |
|------|-------------|
| `--json` | Output as JSON |
| `--force` | Bypass status gate validation |
| `-y, --yes` | Skip retro prompts on done transition |

On `done` transitions, prompts for `sessions` and `deviation` unless `--yes` is passed. On backward transitions, clears timestamps that no longer apply.

```bash
trellis update core-types in_progress
trellis update impl/parser done
trellis update core-types done --json
trellis update core-types in_progress --force
```

---

## show

Display plan details: metadata, dependency chain, critical path, and optionally raw file content.

```
trellis show [options] <plan-id>
```

| Flag | Description |
|------|-------------|
| `--json` | Output as JSON |
| `--contracts` | Include input/output contracts |
| `--file <file>` | Read specific file (`readme`, `implementation`, `inputs`, `outputs`) |
| `--section <section>` | Read specific section (requires `--file`) |
| `--raw` | Output raw plan content |

```bash
trellis show core-types
trellis show core-types --json
trellis show core-types --file implementation --section Steps
trellis show core-types --raw
```

---

## lint

Validate all plans: check for cycles, missing dependencies, bad frontmatter, orphan plans, and structural issues.

```
trellis lint [options]
```

| Flag | Description |
|------|-------------|
| `--strict` | Exit with error on warnings too (not just errors) |
| `--json` | Output as JSON |
| `--fix` | Auto-scaffold missing files and sections |

```bash
trellis lint
trellis lint --strict
trellis lint --json
trellis lint --fix
```

---

## graph

Open an interactive DAG viewer in the browser showing the plan dependency graph.

```
trellis graph [options]
```

| Flag | Description |
|------|-------------|
| `--port <port>` | Port to serve on |
| `--json` | Output graph as JSON (nodes + edges) instead of opening browser |

The viewer supports grouping by directory, status, or tag. Nodes show plan title, status, and tags. Press Ctrl+C to stop the server.

```bash
trellis graph
trellis graph --port 8080
trellis graph --json
```

---

## epic

Show completion status for epics. Epics are defined by `epic:<name>` tags on plans.

```
trellis epic [options] [name]
```

| Flag | Description |
|------|-------------|
| `--json` | Output as JSON |

Without a name, shows all epics. With a name, shows details for that epic.

```bash
trellis epic
trellis epic v1
trellis epic --json
```

---

## chunks

Group plans into reviewable subgraphs based on directory structure or topological depth.

```
trellis chunks [options]
```

| Flag | Description |
|------|-------------|
| `--json` | Output as JSON |
| `--verbose` | Show cross-chunk edges and size details |
| `--tag <tag>` | Filter by tag |
| `--repo <repo>` | Filter by repo |
| `--strategy <strategy>` | Chunk strategy: `directory` or `topological` |

Chunks are merged when they share more than 1 cross-edge and combined size is within `chunk_max_lines` (default 8000).

```bash
trellis chunks
trellis chunks --json
trellis chunks --verbose
trellis chunks --tag foundation
trellis chunks --repo cloud
```

---

## create

Scaffold a new plan directory with a `README.md` containing frontmatter and section headings.

```
trellis create [options] <id>
```

| Flag | Description |
|------|-------------|
| `-t, --title <title>` | Plan title |
| `--depends-on <ids...>` | Plan IDs this depends on |
| `--tags <tags...>` | Freeform tags |
| `-d, --description <desc>` | One-line description |
| `--json` | Output as JSON |

```bash
trellis create my-plan --title "My Plan"
trellis create my-plan --title "Plan" --depends-on core-types --tags foundation
```

---

## set

Update a frontmatter field on a plan. Cannot set `status` — use `update` for status transitions.

```
trellis set [options] <plan-id> <field> [values...]
```

| Flag | Description |
|------|-------------|
| `--add` | Append to list field (tags, depends_on) |
| `--remove` | Remove from list field |
| `--json` | Output as JSON |

```bash
trellis set my-plan description "Updated desc"
trellis set my-plan tags new-tag --add
trellis set my-plan tags old-tag --remove
```

---

## rename

Rename a plan directory and update all `depends_on` references across other plans.

```
trellis rename [options] <old-id> <new-id>
```

| Flag | Description |
|------|-------------|
| `--json` | Output as JSON |

```bash
trellis rename old-name new-name
```

---

## archive

Set a plan's status to `archived`. Blocks if the plan has active (non-done, non-archived) dependents.

```
trellis archive [options] <plan-id>
```

| Flag | Description |
|------|-------------|
| `--json` | Output as JSON |

```bash
trellis archive completed-plan
```

---

## fetch

Fetch plan state from all repos defined in the project manifest.

```
trellis fetch [options]
```

| Flag | Description |
|------|-------------|
| `--json` | Output as JSON |

```bash
trellis fetch
trellis fetch --json
```

---

## metrics

Show cycle time, queue time, and session data for completed plans. Uses `not_started_at`, `started_at`, and `completed_at` timestamps.

```
trellis metrics [options]
```

| Flag | Description |
|------|-------------|
| `--json` | Output as JSON |
| `--since <date>` | Filter to plans completed after this date |

```bash
trellis metrics
trellis metrics --json
trellis metrics --since 2026-02-01
```

---

## setup-hooks

Install Claude Code hooks (to prevent direct plan file edits) and a git pre-commit hook.

```
trellis setup-hooks
```

```bash
trellis setup-hooks
```

---

## mcp

Start the MCP (Model Context Protocol) server on stdio for Claude Code integration. Not intended for direct human use.

```
trellis mcp
```

See [mcp-reference.md](mcp-reference.md) for tool documentation.
