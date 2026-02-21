---
title: Recency Metadata on Plans
status: done
description: >-
  Add updatedAt (file mtime), content hashes, and what-changed queries to the
  Plan type
tags:
  - canopy
not_started_at: '2026-02-21T01:48:53.268Z'
completed_at: '2026-02-21T03:30:25.992Z'
---

## Problem
Trellis tracks plan lifecycle through status timestamps (`started_at`, `completed_at`, `not_started_at`), but these only record when a plan transitions between statuses — not when its content was last edited.

A plan can be actively refined day after day — problem statement sharpened, approach reworked, steps rewritten — yet show no timestamp change if its status remains `in_progress`. From the outside, it looks untouched.

This creates a gap in several workflows:

**No answer to "what changed recently?"** There is no field on `Plan` to answer "which plans were touched this week?" Today, answering that question requires running `git log` manually or inspecting file mtimes outside of trellis. Neither is available from the trellis API.

**Canopy dashboard is blind to content activity.** The Canopy dashboard wants to surface "3 plans updated since you last looked" and highlight recently-changed plans in a recency feed. With only status timestamps, it has no data to work with. A plan that was heavily edited but not transitioned looks identical to one that has been dormant for weeks.

**Attention management suffers.** For a user managing multiple plans across a project, knowing what changed since the last time they looked is critical. Without a content-edit timestamp, there is no way to prioritize review or detect active work. The user must manually hunt through files to find what moved.

The missing primitive is simple: when was this plan's content last modified?
## Approach
Add filesystem-based recency metadata to the `Plan` type, computed during `scanPlans()`. Keep it simple: use file mtimes, not git history. This is fast, has no external dependency, and captures uncommitted changes that git would miss.

**`updatedAt: Date` on Plan**

In `scanPlans()`, after collecting the plan's files (README.md, implementation.md, inputs.md, outputs.md), `stat()` each file that exists and take the maximum `mtime`. Store this as `updatedAt` on the `Plan` object. This becomes the canonical "when was this plan last touched?" field.

**`fileHashes: Record<string, string>` on Plan**

Alongside `updatedAt`, compute a content hash (SHA-256 truncated to hex) per plan file. Store as a map from filename to hash (e.g. `{ "README.md": "a3f9...", "implementation.md": "cc12..." }`). This enables callers to answer "did this plan actually change, or was it just touched (e.g. by a save-without-edit)?" — mtime alone cannot distinguish the two.

**`computeRecentActivity(plans, since: Date): RecentActivity`**

A new pure function in `src/graph.ts` or a dedicated `src/recency.ts`. Takes the full plan list and a cutoff date, returns a `RecentActivity` object:

```ts
interface RecentActivity {
  contentChanged: Plan[];   // updatedAt > since, body/files changed (hash differs from cache)
  statusChanged: Plan[];    // status timestamp > since
  newlyCreated: Plan[];     // not_started_at or created_at > since (no prior status)
}
```

Plans are sorted by `updatedAt` descending within each group. A plan can appear in multiple groups.

**CLI surface**

Add a `trellis recent` command (or `trellis status --recent`) that prints plans modified in the last N hours or days:

```
trellis recent          # last 24h (default)
trellis recent --days 7 # last week
trellis recent --json   # machine-readable RecentActivity
```

Output lists plan ID, title, `updatedAt`, and which group(s) it falls into.

**Library API**

Export `RecentActivity` type and `computeRecentActivity` from the trellis library entry point so Canopy and other consumers can call it directly. The key integration point for Canopy is: persist "last viewed at" locally, then call `computeRecentActivity(plans, lastViewedAt)` to get the diff.

**What this does not do**

- No git integration. Filesystem mtime is sufficient and avoids a `child_process` dependency.
- No persistent change log. This is a point-in-time query, not an event stream.
- No network calls. All computation is local and synchronous (or single-pass async with `Promise.all` on stat calls).
