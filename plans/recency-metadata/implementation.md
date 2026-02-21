
## Steps
1. **Add `updatedAt` and `fileHashes` to `Plan` in `src/core/types.ts`.**
   `updatedAt: Date` and `fileHashes: Record<string, string>`. Both are always present after scanning (not optional).

2. **Compute recency metadata in `scanPlans()` (`src/core/scanner.ts`).**
   After assembling each plan's file list, `statSync()` each existing file to get `mtime`. Take the maximum as `updatedAt`. For `fileHashes`, read each file's content and compute `createHash('sha256').update(content).digest('hex').slice(0, 16)` (truncated to 16 hex chars). Store as `{ "README.md": "a3f9...", "implementation.md": "cc12..." }`.

3. **Create `src/recency.ts` with `computeRecentActivity()`.**
   Pure function: `(plans: Plan[], since: Date) => RecentActivity`. Group plans into `contentChanged` (updatedAt > since), `statusChanged` (any status timestamp > since), and `newlyCreated` (plan has no prior status timestamps and `updatedAt` > since). Sort each group by `updatedAt` descending. A plan can appear in multiple groups.

4. **Add `RecentActivity` type to `src/core/types.ts`.**
   ```ts
   interface RecentActivity {
     contentChanged: Plan[];
     statusChanged: Plan[];
     newlyCreated: Plan[];
   }
   ```

5. **Add `trellis recent` command (`src/features/recent/command.ts`).**
   Default: last 24 hours. `--days N` flag for custom window. `--json` flag for machine-readable output. Output format: table with plan ID, title, updatedAt, and change type(s). Follow existing command patterns (mock `process.cwd` for testing).

6. **Include `updatedAt` and `fileHashes` in `show --json` output.**
   Update the show command's JSON serializer to include both fields. `updatedAt` serialized as ISO 8601 string.

7. **Export from library entry point (`src/index.ts`).**
   Export `computeRecentActivity`, `RecentActivity` type, and ensure `Plan` type changes are visible to consumers.

## Testing
- **Scanner tests (`src/core/scanner.test.ts`):** Create fixture plans, verify `updatedAt` is a Date, `fileHashes` has entries for each existing file, hash is a 16-char hex string. Modify a file's content and re-scan — verify hash changes. Touch a file without changing content — verify hash stays the same (mtime changes but hash doesn't).
- **computeRecentActivity tests (`tests/recency.test.ts`):** Create plan arrays with various `updatedAt` and status timestamps. Test: plan modified yesterday appears in `contentChanged` for `since = 2 days ago` but not for `since = 12 hours ago`. Plan with `started_at` in range appears in `statusChanged`. New plan appears in `newlyCreated`. Plan in multiple groups appears in all applicable groups. Sort order is `updatedAt` descending.
- **CLI tests (`tests/commands/recent.test.ts`):** Mock `process.cwd`, verify default 24h window, verify `--days 7` expands window, verify `--json` outputs valid JSON matching `RecentActivity` shape.
- **Edge cases:** Plan directory with only README.md — `fileHashes` has one entry. Empty plans directory — `computeRecentActivity` returns empty arrays. Plan with no status timestamps — only appears in `contentChanged` or `newlyCreated`.

## Done-when
- Every `Plan` object from `scanPlans()` has `updatedAt` (Date) and `fileHashes` (Record<string, string>).
- `computeRecentActivity()` correctly groups plans by content change, status change, and newly created.
- `trellis recent` displays recently modified plans with `--days` and `--json` flags.
- `show --json` includes `updatedAt` and `fileHashes`.
- Library exports `computeRecentActivity` and `RecentActivity` for Canopy consumption.
- All new and existing scanner tests pass.
