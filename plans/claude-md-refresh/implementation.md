## Steps

1. Audit current CLAUDE.md — identify every section and categorize as "keep" (purpose, stack, dev commands, never-edit rule, MCP table) or "remove" (frontmatter schema, command list, plan structure, status gates, How It Works, plan granularity). Verify each "remove" item has a corresponding docs/ file from the documentation plan.

2. Rewrite CLAUDE.md — slim version with: one-line purpose, one-line stack, development commands block, the "never edit plan files directly" rule + MCP tool table, and a "Documentation" section linking to docs/plan-schema.md, docs/cli-reference.md, docs/architecture.md, docs/mcp-reference.md, docs/for-agents.md.

3. Update the freshness date to today's date.

4. Review the rewritten file — confirm nothing was lost (every removed section has a docs/ counterpart) and nothing was added that doesn't belong.

## Testing

- Read the new CLAUDE.md and confirm it contains only the allowed sections
- Confirm CLAUDE.md no longer contains the frontmatter schema block, full command list, status gates table, "How It Works" section, or plan granularity notes
- Spot-check that each link in the "Documentation" section points to a file that exists and covers the removed content
- Confirm freshness date is current

## Done-when

- CLAUDE.md is under ~60 lines (currently ~120)
- All detailed content is accessible via docs/ links
- No information gap — an agent reading CLAUDE.md + following links gets the same knowledge as before
- Freshness date reflects today
