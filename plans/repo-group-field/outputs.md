
## Types

- `RepoEntry.group?: string` — optional organizational group for the repo (e.g. `"tooling"`, `"product"`, `"infra"`)
- `ResolvedRepo.group?: string` — same field passed through after resolution

## Manifest YAML

New optional field on repo entries in `.trellis-project`:

```yaml
repos:
  canopy:
    path: tooling/canopy
    url: git@github.com:twiglylabs/canopy.git
    group: tooling  # optional string
```

## Validation

- `parseManifest()` validates `group` as optional string; rejects non-string values with `Invalid manifest: repo "{alias}" has non-string "group"`
- Fully backwards-compatible — manifests without `group` continue to work unchanged
