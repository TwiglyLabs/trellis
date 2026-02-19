┌──────────────────────────┬─────────────┬─────────────────────────┐
│           Plan           │   Status    │       Depends on        │
├──────────────────────────┼─────────────┼─────────────────────────┤
│ plan-schema              │ not_started │ —                       │
├──────────────────────────┼─────────────┼─────────────────────────┤
│ cli-write-surface        │ not_started │ plan-schema             │
├──────────────────────────┼─────────────┼─────────────────────────┤
│ lint-schema-checks       │ not_started │ plan-schema             │
├──────────────────────────┼─────────────┼─────────────────────────┤
│ cross-repo-manifest      │ draft       │ plan-schema             │
├──────────────────────────┼─────────────┼─────────────────────────┤
│ plan-claim-protocol      │ draft       │ plan-schema             │
├──────────────────────────┼─────────────┼─────────────────────────┤
│ cross-repo-graph         │ draft       │ cross-repo-manifest     │
├──────────────────────────┼─────────────┼─────────────────────────┤
│ agent-guardrails         │ draft       │ cli-write-surface       │
├──────────────────────────┼─────────────┼─────────────────────────┤
│ feedback-metrics         │ draft       │ —                       │
└──────────────────────────┴─────────────┴─────────────────────────┘

Build order:
1. plan-schema (foundation — directory format, sections, status gates)
2. cli-write-surface + lint-schema-checks + cross-repo-manifest + plan-claim-protocol
   (parallel — all depend only on plan-schema)
3. cross-repo-graph (needs manifest and git reader in place)
4. agent-guardrails (deferred — build after MCP tools proven in practice)

Independent (no blockers):
- feedback-metrics (can build anytime — uses existing data + new timestamp + retro convention)

Archived/superseded:
- cross-repo-contracts → superseded by cross-repo-manifest + cross-repo-graph
- graph-headless → not needed (canopy uses library API, not CLI)
- library-api → done (Trellis class, barrel exports, watch(), CLI refactored)
- cross-repo-coordination → archived (scope absorbed into new cross-repo plans)
