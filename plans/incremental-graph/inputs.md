
## From plans

### watch-events
- `PlanChangeEvent` discriminated union (`plan-added`, `plan-removed`, `plan-updated`)
- `PlanChangeBatch` with debounced event batching
- `watchPlans()` with content hashing to suppress phantom rebuilds
