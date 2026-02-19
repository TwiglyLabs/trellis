# Outputs

## Plan contract convention
- Directory plan structure: `README.md` + `inputs.md` + `outputs.md`
- `inputs.md` format: "From plans" sections (reference plan IDs) and "From existing code" sections (reference file paths)
- `outputs.md` format: H2 headings for deliverables, bullet points for specifics
- Single-file plans without contracts remain valid (additive, no migration)

## Extended data model
- `Plan.inputs` and `Plan.outputs` fields with parsed contract structure
- `PlanContract` type: raw markdown, referenced plan IDs, referenced code paths, parsed sections
- `Chunk` gains aggregated `chunkInputs` and `chunkOutputs` in JSON output

## New lint checks
- Warning: plan has dependents but no `outputs.md`
- Error: `inputs.md` references plan ID not in `depends_on`
- Warning: `inputs.md` references plan with no `outputs.md`

## Improved chunk algorithm
- Initial grouping by topological depth instead of directory prefix
- Interface-width scoring: count contract items crossing a potential cut
- Groups exceeding line budget get split at narrowest interface
- Chunks that resist reduction are annotated with advisory message
- `chunk:name` tag overrides still take precedence

## Enhanced graph visualization
- Cross-chunk edges labeled with contract heading (H2 from `outputs.md`)
- Chunk bounding boxes color-coded by interface width (green=narrow, red=wide)
- Plan drawer expanded to ~40-50% viewport with three tabs: Plan, Outputs, Inputs
- Input tab links to upstream plan's output tab

## CLI extensions
- `trellis show <id> --contracts` prints parsed inputs/outputs inline
- `trellis chunks --json` includes `chunkInputs`/`chunkOutputs` fields
