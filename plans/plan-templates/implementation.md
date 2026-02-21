
## Steps
1. **Define built-in template content in `src/templates.ts`.**
   Export a `BUILT_IN_TEMPLATES: Record<string, TemplateFiles>` constant where each key is a type name (`feature`, `bugfix`, `refactor`, `investigation`) and the value is a map of filenames to markdown content with `<!-- hint: ... -->` comments. This is the source of truth for `trellis init` to write into `.trellis/templates/`.

2. **Write templates to disk during `trellis init`.**
   In the init command, after creating `.trellis/config`, create `.trellis/templates/<type>/` directories and write the template files from the built-in constant. Skip if templates already exist (don't overwrite user customizations).

3. **Add template loading in `src/templates.ts`.**
   `loadTemplate(projectDir: string, type: string): TemplateFiles | null`. Reads from `.trellis/templates/<type>/` if it exists, falls back to built-in constant. Returns null if type is unknown and no custom template exists.

4. **Update `create()` in `src/api.ts` to accept `type` parameter.**
   `create(options: CreateOptions & { type?: string })`. When type is provided, load the template and use it for scaffolding instead of the generic scaffold. Substitute `{{ title }}` and `{{ id }}` placeholders in template content. Strip `<!-- hint: ... -->` comments from the written files.

5. **Add `--type` flag to `trellis create` CLI command.**
   Optional flag, defaults to `feature` or `default_plan_type` from config if set. Validate against available templates (built-in + custom). Pass through to `create()` API.

6. **Add `type` parameter to `trellis_create` MCP tool.**
   Optional Zod field: `type: z.string().optional()`. Pass through to `create()`.

7. **Add `type` to `PlanFrontmatter` in `src/core/types.ts`.**
   Optional field: `type?: string`. The create flow sets it in frontmatter when a type is specified. Add `type` to `EDITABLE_FIELDS` in `set()` so users can retroactively tag plans.

8. **Include `type` in JSON outputs.**
   Add `type` to `PlanSummary` in types.ts. Ensure `status --json`, `show --json`, and `ready --json` include the field when present.

9. **Add `default_plan_type` config key.**
   Parse in `loadConfig()`, add to `TrellisConfig`. Used as fallback when `--type` is not specified on `create`.

## Testing
- **Template content tests (`tests/templates.test.ts`):** Verify each built-in template has the expected files and sections. Feature/bugfix/refactor templates produce README.md + implementation.md. Investigation template produces README.md only (no implementation.md).
- **Init tests:** After `trellis init --yes`, verify `.trellis/templates/` contains all 4 type directories with correct files. Run init again — verify templates are not overwritten.
- **Create with type tests:** `create({ title: 'test', type: 'bugfix' })` produces a plan with bugfix-specific sections. `create({ title: 'test', type: 'investigation' })` produces README.md only, no implementation.md. `create({ title: 'test' })` without type uses feature template (or generic fallback).
- **Custom template tests:** Write a custom template to `.trellis/templates/custom-type/`, call `create({ type: 'custom-type' })`, verify it uses the custom template. Modify a built-in template in `.trellis/templates/feature/`, verify create uses the modified version.
- **CLI tests:** `trellis create --type refactor my-plan` creates plan with refactor scaffold. Invalid type produces an error message listing available types.
- **MCP tests:** `trellis_create` with `type` param works. Without `type` param, uses default.
- **set() tests:** `trellis set type investigation my-plan` updates the frontmatter. `type` appears in `show --json` output.
- **Config tests:** `default_plan_type = bugfix` in config causes `create` without `--type` to use bugfix template.

## Done-when
- Four built-in templates (feature, bugfix, refactor, investigation) ship with `trellis init`.
- `trellis create --type <type>` scaffolds plans using the appropriate template.
- `trellis_create` MCP tool accepts optional `type` parameter.
- Investigation template produces README.md only (no implementation.md).
- Custom templates in `.trellis/templates/` override built-ins.
- `type` frontmatter field is editable via `set()` and visible in JSON outputs.
- `default_plan_type` config key works as fallback.
- All new and existing create/init tests pass.
