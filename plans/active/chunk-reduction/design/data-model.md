# Data Model & Scanner Changes

## Type Extensions

```typescript
// New types in src/types.ts

interface ContractSection {
  heading: string;       // H2 or H3 heading text
  items: string[];       // Bullet points under the heading
  source?: string;       // Plan ID (for "From plans") or file path (for "From existing code")
}

interface PlanContract {
  raw: string;                    // Full markdown content
  fromPlans: string[];            // Plan IDs referenced in "From plans" sections
  fromCode: string[];             // File paths referenced in "From existing code" sections
  sections: ContractSection[];    // Parsed heading/bullet structure
}

// Extended Plan interface
interface Plan {
  // ...existing fields...
  inputs?: PlanContract;
  outputs?: PlanContract;
}

// Extended Chunk interface (for JSON output)
interface Chunk {
  // ...existing fields...
  chunkInputs: ChunkContract[];   // Aggregated external inputs for this chunk
  chunkOutputs: ChunkContract[];  // Aggregated outputs consumed by other chunks
}

interface ChunkContract {
  planId: string;        // Which plan this contract belongs to
  heading: string;       // The H2 deliverable name
  consumedBy: string[];  // Plan IDs (or chunk IDs) that depend on this
}
```

## Scanner Changes

In `src/scanner.ts`, when scanning a directory plan:

1. Check for `inputs.md` alongside `README.md`
2. Check for `outputs.md` alongside `README.md`
3. If found, read and parse with the markdown parser below
4. Attach to the `Plan` object as `inputs`/`outputs`

### Markdown Parser

Light parsing — no AST, just line-by-line:

1. Split into lines
2. Track current H2 (`## `) and H3 (`### `) headings
3. Collect bullet points (`- `) under each heading
4. For `inputs.md`: detect "From plans" vs "From existing code" H2 sections; H3 headings under "From plans" are plan IDs, H3 headings under "From existing code" are file paths
5. For `outputs.md`: H2 headings are deliverable names, bullets are specifics

No external markdown parsing library needed. The format is constrained enough for regex/string matching.

## Lint Checks

Add to `src/commands/lint.ts`:

| Check | Severity | Condition |
|-------|----------|-----------|
| Missing outputs | warning | Plan has dependents (other plans list it in `depends_on`) but no `outputs.md` |
| Orphaned input ref | error | `inputs.md` "From plans" references a plan ID not in `depends_on` |
| Missing upstream outputs | warning | `inputs.md` references a plan that has no `outputs.md` |
| Input/output mismatch | warning | `inputs.md` references a heading from upstream plan that doesn't appear in that plan's `outputs.md` |

## CLI Changes

### `trellis show <id> --contracts`

Print the plan's parsed contracts inline:

```
core-extraction — Extract types from db/types.ts...

  Inputs: (none — root plan)

  Outputs:
    @acorn/core package
      - Exports: Person, Family, Tree, SourceCitation, Event
      - All types are pure data...
    TreeStore interface
      - get(id): Promise<Entity | null>
      ...
```

### `trellis chunks --json`

Add `chunkInputs` and `chunkOutputs` to each chunk object. These are the aggregated contracts that cross chunk boundaries — the "interface" of the chunk.
