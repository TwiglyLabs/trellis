# Trellis

**Freshness:** 2026-02-19

Lightweight CLI for managing plans with dependencies. Plan files are the source of truth — no manifest.

## Stack

TypeScript, Node.js >= 20, single binary via esbuild bundle, zero runtime deps beyond Node.

## Development

```bash
npm install
npm run build        # esbuild bundle
npm test             # vitest
npm run dev          # watch mode
trellis              # use the installed binary (not node dist/trellis.cjs)
```

**Important:** Always use the `trellis` command (installed at `/opt/homebrew/bin/trellis`), not `node dist/trellis.cjs`.

## Plan Management (for agents)

**Never use Edit, Write, or Bash to modify plan files.** Plans are managed exclusively through trellis MCP tools. Claude Code hooks will block direct file edits.

| Operation | MCP Tool |
|---|---|
| Create a new plan | `trellis_create` |
| Read plan content or a section | `trellis_read_section` |
| Write/update plan content | `trellis_write_section` |
| Update metadata (title, tags, etc.) | `trellis_set` |
| Change plan status | `trellis_update` |

Plans should be implementable in roughly half a context session. If a plan feels too big, split it.

## Documentation

- [CLI Reference](docs/cli-reference.md) — every command, flag, and example
- [Plan Schema](docs/plan-schema.md) — plan structure, frontmatter fields, status gates
- [MCP Reference](docs/mcp-reference.md) — MCP tool schemas and examples
- [Architecture](docs/architecture.md) — codebase layout, build system, test patterns
- [For Agents](docs/for-agents.md) — agent-oriented setup and workflow guide

## Design Principles

- **File-first.** Plan files are the entire state. No hidden databases or config.
- **Frontmatter-driven.** Metadata lives in the plan file itself. No manifest to sync.
- **Project-local.** Each project owns its own plans directory.
- **Read-heavy.** Most usage is `status`, `show`, `graph`. Writes are `update`.
