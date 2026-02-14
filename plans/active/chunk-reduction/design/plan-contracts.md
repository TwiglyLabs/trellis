# Plan Contracts Convention

## Folder Structure

```
plans/active/my-plan/
  README.md      # Plan frontmatter + implementation details
  inputs.md      # What this plan needs to start
  outputs.md     # What this plan delivers when done
```

Single-file plans (a bare `.md` with frontmatter) remain valid. The convention is additive — only plans that participate in contract-based review need the folder structure.

## outputs.md

Freeform markdown with light structure. H2 headings name each deliverable. Bullet points describe specifics — types, interfaces, invariants, file locations.

```markdown
# Outputs

## @acorn/core package
- Exports: `Person`, `Family`, `Tree`, `SourceCitation`, `Event`
- All types are pure data — no DB refs, no store methods
- Canonical ID format: `@I{n}@` for individuals, `@F{n}@` for families

## TreeStore interface
- `get(id): Promise<Entity | null>`
- `query(filter): Promise<Entity[]>`
- `put(entity): Promise<void>`
- No batch/transaction methods (deferred to store-refactor)
```

Guidelines:
- One H2 per logical deliverable (a package, an interface, a schema, a service)
- Bullets should be specific enough that code review can verify them
- Keep it compact — this is a contract, not documentation. 20-50 lines typical.

## inputs.md

Two sections: things that come from upstream plans (don't exist yet) and things that come from existing code (exist now, can be verified).

```markdown
# Inputs

## From plans
### migration-infrastructure
- Migration runner accepting numbered `.sql` files
- CLI: `acorn migrate up`, `acorn migrate status`

## From existing code
### src/db/schema.sql
- Current v8 schema structure
- Column types needed for migration generation
```

Guidelines:
- "From plans" subsections use H3 with the plan ID as heading
- "From existing code" subsections use H3 with the file/directory path
- Each bullet describes what specifically is needed, not the full output
- Inputs from plans should be a subset of that plan's outputs
- Root plans (no dependencies) can omit `inputs.md` or have only "From existing code"

## Lifecycle

1. **Planning**: Human and agent collaboratively define inputs/outputs as part of plan development. A plan isn't ready until contracts are defined.
2. **Plan review**: Agent validates "given these inputs, can this plan deliver these outputs?" — the feasibility check.
3. **Implementation**: Agent builds to the outputs contract as acceptance criteria.
4. **Code review**: Agent verifies outputs were actually delivered. This is the gate — downstream plans stay blocked until confirmed.

## Relationship to depends_on

`depends_on` in frontmatter declares the dependency edge. `inputs.md` describes what flows along that edge. They must be consistent:
- Every plan ID in `inputs.md` "From plans" must appear in `depends_on`
- Not every `depends_on` entry needs an `inputs.md` section (ordering-only dependencies are valid)
