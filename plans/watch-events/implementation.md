
## Steps
1. **Define event types in `src/features/watch/types.ts`.**
   ```ts
   type PlanFileKind = 'readme' | 'implementation' | 'inputs' | 'outputs';
   type PlanChangeEvent =
     | { type: 'plan-added'; planId: string; plan: Plan }
     | { type: 'plan-removed'; planId: string }
     | { type: 'plan-updated'; planId: string; file: PlanFileKind; plan: Plan };
   interface PlanChangeBatch { events: PlanChangeEvent[]; timestamp: Date; }
   interface WatchHandle { close(): void; }
   ```

2. **Add path-to-plan mapping utility.**
   Given a raw filesystem path from `fs.watch`, resolve it to a `{ planId: string, fileKind: PlanFileKind }` or null (if the path is outside plan directories or not a recognized plan file). Map filenames: `README.md` → `readme`, `implementation.md` → `implementation`, `inputs.md` → `inputs`, `outputs.md` → `outputs`.

3. **Add content hash map and comparison.**
   On watcher startup, hash all existing plan files (SHA-256, truncated to 16 hex chars) into a `Map<string, string>` keyed by absolute file path. On each filesystem event, re-read and hash the changed file. If hash matches the stored value, suppress the event. If hash differs (or file is new), update the map and emit. Reuse the same hashing approach as recency-metadata's `fileHashes`.

4. **Rewrite `watchPlans()` in `src/features/watch/logic.ts`.**
   Replace the current generic implementation. New signature: `watchPlans(plansDir: string, config: TrellisConfig, callback: (batch: PlanChangeBatch) => void, debounceMs?: number): WatchHandle`. Use `fs.watch(plansDir, { recursive: true })`. On each raw event: resolve path to plan ID + file kind, check content hash, classify as added/removed/updated, buffer into pending batch. After debounce window (default 100ms) with no new events, call `scanPlans()` for affected plan IDs only (not full directory), emit `PlanChangeBatch`.

5. **Detect plan-added and plan-removed.**
   Track known plan directories via a `Set<string>`. On filesystem event for a new directory with a README.md, classify as `plan-added`. On directory removal (or README.md deletion), classify as `plan-removed`. Use `existsSync()` checks to distinguish add from remove.

6. **Implement `watchMultiRepo()`.**
   Create one `watchPlans()` per repo. Qualify each event's `planId` with the repo alias before forwarding. Aggregate into a single `PlanChangeBatch` per debounce window across all repos. Return a `WatchHandle` that closes all sub-watchers.

7. **Update library exports in `src/index.ts`.**
   Export `watchPlans`, `watchMultiRepo`, `unwatchPlans`, and all event/batch types.

8. **Write tests.**
   Use temp directories. Write a plan file, verify `plan-added` event fires. Modify a file, verify `plan-updated` with correct `fileKind`. Delete a plan directory, verify `plan-removed`. Write same content twice, verify second write is suppressed (content hash match). Verify debounce batching: rapid writes produce one batch.

## Testing
- **Path mapping tests:** Verify `README.md` → `readme`, `implementation.md` → `implementation`, unrecognized files → null. Nested paths resolve to correct plan ID.
- **Content hash tests:** Hash a file, re-hash same content — same result. Modify content — different hash. Use this to verify phantom suppression.
- **plan-added event:** Create a new plan directory with README.md in watched directory. Verify callback receives `plan-added` event with correct planId and parsed Plan object.
- **plan-updated event:** Modify an existing plan's implementation.md. Verify `plan-updated` event with `file: 'implementation'` and updated Plan.
- **plan-removed event:** Delete a plan directory. Verify `plan-removed` event with correct planId.
- **Phantom suppression:** Write identical content to a file. Verify no event is emitted (hash unchanged).
- **Debounce batching:** Write 3 files in rapid succession (<100ms apart). Verify a single `PlanChangeBatch` with 3 events, not 3 separate callbacks.
- **watchMultiRepo:** Watch 2 fixture repos. Modify a plan in repo A. Verify event has qualified planId (`repo-a:plan-id`). Verify repo B produces no events.
- **WatchHandle.close():** After closing, file changes produce no events.
- **Edge cases:** Plan directory with no README.md — ignored. File change during debounce window followed by directory deletion — batch contains both events.

## Done-when
- `watchPlans()` emits typed `PlanChangeEvent` items (added, updated, removed) via debounced `PlanChangeBatch` callbacks.
- Content hashing suppresses phantom rebuilds from editor autosave / format-on-save.
- `watchMultiRepo()` qualifies events with repo aliases and aggregates across repos.
- Uses Node built-in `fs.watch()` — no new runtime dependencies.
- Existing `WatchableInstance` interface updated or replaced to use new event types.
- Library exports all event types and watch functions.
- All tests pass including debounce batching, phantom suppression, and multi-repo qualification.
