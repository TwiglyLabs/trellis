# Implementation

## Steps

1. Implement `computeChunks()` in `src/graph.ts` — 5-step algorithm: directory grouping, agglomerative merge (>1 cross-edge AND combined lines <= maxLines), chunk:name tag overrides, orphan reassignment, size check. Returns `ChunkResult` with chunks array, cross-chunk edges, and config.

2. Add `dependencies` (forward edges) to `GraphData` — `buildGraph()` currently only provides `dependents` (reverse edges). Add `dependencies: Map<string, string[]>` built from `plan.frontmatter.depends_on`. Needed by chunk merge algorithm and useful for future functions.

3. Add `chunk_max_lines` config — optional key in `.trellis`, parsed as int, default 8000. Read by `loadConfig()` in scanner.ts.

4. Implement `trellis chunks` CLI command — `--json` for structured output (chunks, crossChunkEdges, config), `--verbose` for cross-chunk edge details in human output. Follows epic command pattern. Register in `src/cli.ts`.

5. Create `plan-review` skill files — 3 files in `~/.claude/skills/plan-review/`: SKILL.md (invocation, phases, error handling), chunk-reviewer-prompt.md (subagent instructions for the 4 review passes), synthesis-prompt.md (cross-chunk synthesis instructions). Skill uses `trellis chunks --json` as input.

6. Implement Phase 1 dispatch — skill reads `trellis chunks --json`, dispatches `sonnet-general-purpose` subagents in parallel via Task tool. Each agent receives chunk plan IDs, file paths, internal edges, and cross-chunk edges touching the chunk.

7. Implement Phase 2 synthesis — orchestrator reads all chunk summaries and boundary notes, checks boundary compatibility across cross-chunk edges, flags contradictions and coverage gaps. Uses `opus-general-purpose` if chunks > 3.

8. Implement Phase 3 cleanup — stale artifact deletion, finding deduplication (same type + plans + category), report writing to `plans/.review/`. Auto-add `.review/` to `.gitignore`.

9. Implement `--recheck` — compare cached reports against current chunk membership and plan modification timestamps. Only re-dispatch stale or failing chunks. Merge with valid cached results.

## Testing

- `computeChunks()` groups by directory prefix correctly
- Agglomerative merge combines groups with >1 cross-edge
- `chunk:name` tag overrides force plans into named chunks
- Orphan plans reassigned to chunk with most shared edges
- Size warning emitted when chunk exceeds `chunk_max_lines`
- `trellis chunks --json` schema matches design spec (chunks, crossChunkEdges, config)
- Cross-chunk edges correctly identified (source and target in different chunks)
- Skill dispatches subagents and collects structured findings
- `--recheck` skips unchanged clean chunks, re-reviews stale ones
- Deduplication merges findings with matching type/plans/category

## Done-when

- `trellis chunks` command discovers and displays reviewable subgraphs
- `trellis chunks --json` provides structured output for skill consumption
- `plan-review` skill orchestrates parallel chunk reviews and cross-chunk synthesis
- Review artifacts written to `plans/.review/` (gitignored)
- `--recheck` leverages cached results for incremental reviews
- Subagent failures handled gracefully without blocking other chunks
