
## Exports

### Event types — `src/features/watch/types.ts`

```typescript
type PlanFileKind = 'readme' | 'implementation' | 'inputs' | 'outputs';

type PlanChangeEvent =
  | { type: 'plan-added';   planId: string; plan: Plan }
  | { type: 'plan-removed'; planId: string }
  | { type: 'plan-updated'; planId: string; file: PlanFileKind; plan: Plan };

interface PlanChangeBatch {
  events: PlanChangeEvent[];
  timestamp: Date;
}

interface WatchHandle { close(): void }
```

### `watchPlans(plansDir, callback, options?)` — `src/features/watch/logic.ts`

Watches plan directory with `fs.watch({ recursive: true })`. Content hashing suppresses phantom rebuilds. Debounced batch emission (default 100ms).

### `watchMultiRepo(repos, callback, options?)` — `src/features/watch/logic.ts`

One watcher per repo, qualifies event planIds with repo alias, aggregates batches.

### Library exports

`watchPlans`, `watchMultiRepo`, `unwatchPlans` functions and all types exported from `src/index.ts`.
