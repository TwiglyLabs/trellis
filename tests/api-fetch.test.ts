import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { Trellis } from '../src/api.ts';
import { createFixture } from './helpers.ts';
import type { GitExecutor } from '../src/core/manifest.ts';

describe('Trellis.fetch()', () => {
  const manifestYaml = `
name: twiglylabs
repos:
  trellis:
    url: git@github.com:twiglylabs/trellis.git
    branch: main
    visibility: public
  canopy:
    url: git@github.com:twiglylabs/canopy.git
    branch: main
    visibility: public
  acorn:
    url: git@github.com:twiglylabs/acorn.git
    branch: develop
    visibility: private
`;

  const remotePlanReadme = `---
title: Remote Plan
status: not_started
tags: [foundation]
---

# Remote Plan

## Problem
Something to do.
`;

  it('throws when no manifest configured', () => {
    const { root } = createFixture([]);
    const t = new Trellis(root);
    expect(() => t.fetch()).toThrow('No manifest configured');
  });

  it('fetches remote plans from all sibling repos', () => {
    const { root } = createFixture([
      { id: 'local-plan', title: 'Local Plan', status: 'not_started' },
    ]);
    // Add manifest to config
    writeFileSync(join(root, '.trellis'), 'project: trellis\nplans_dir: plans\nmanifest: git@github.com:twiglylabs/twiglylabs.git\n');

    const t = new Trellis(root);
    const git = vi.fn<GitExecutor>();

    // discoverManifest: ensureRemote (get-url, add), fetch, gitShow
    git.mockReturnValueOnce(null);           // remote get-url __manifest
    git.mockReturnValueOnce('');             // remote add __manifest
    git.mockReturnValueOnce('');             // fetch __manifest
    git.mockReturnValueOnce(manifestYaml);   // git show .trellis-project

    // fetchProjectPlans: canopy
    git.mockReturnValueOnce(null);           // remote get-url canopy
    git.mockReturnValueOnce('');             // remote add canopy
    git.mockReturnValueOnce('');             // fetch canopy
    git.mockReturnValueOnce('plan-c1\n');    // ls-tree canopy plans
    git.mockReturnValueOnce(remotePlanReadme); // git show canopy plan-c1

    // fetchProjectPlans: acorn
    git.mockReturnValueOnce(null);           // remote get-url acorn
    git.mockReturnValueOnce('');             // remote add acorn
    git.mockReturnValueOnce('');             // fetch acorn
    git.mockReturnValueOnce('plan-a1\nplan-a2\n'); // ls-tree acorn plans
    git.mockReturnValueOnce(remotePlanReadme);     // git show acorn plan-a1
    git.mockReturnValueOnce(remotePlanReadme);     // git show acorn plan-a2

    const result = t.fetch(git);
    expect(result.project).toBe('twiglylabs');
    expect(result.totalPlans).toBe(3);
    expect(result.repos).toHaveLength(2); // canopy + acorn (trellis skipped)
    expect(result.repos.find(r => r.alias === 'canopy')?.planCount).toBe(1);
    expect(result.repos.find(r => r.alias === 'acorn')?.planCount).toBe(2);
  });

  it('reports failed repos without crashing', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { root } = createFixture([]);
    writeFileSync(join(root, '.trellis'), 'project: trellis\nplans_dir: plans\nmanifest: git@github.com:twiglylabs/twiglylabs.git\n');

    const t = new Trellis(root);
    const git = vi.fn<GitExecutor>();

    // discoverManifest succeeds
    git.mockReturnValueOnce(null);
    git.mockReturnValueOnce('');
    git.mockReturnValueOnce('');
    git.mockReturnValueOnce(manifestYaml);

    // canopy fetch fails
    git.mockReturnValueOnce(null);  // remote get-url
    git.mockReturnValueOnce('');    // remote add
    git.mockReturnValueOnce(null);  // fetch fails

    // acorn fetch succeeds
    git.mockReturnValueOnce(null);
    git.mockReturnValueOnce('');
    git.mockReturnValueOnce('');
    git.mockReturnValueOnce('plan-a\n');
    git.mockReturnValueOnce(remotePlanReadme);

    const result = t.fetch(git);
    expect(result.repos.find(r => r.alias === 'canopy')?.ok).toBe(false);
    expect(result.repos.find(r => r.alias === 'acorn')?.ok).toBe(true);
    consoleSpy.mockRestore();
  });

  it('throws when manifest discovery fails entirely', () => {
    const { root } = createFixture([]);
    writeFileSync(join(root, '.trellis'), 'project: trellis\nplans_dir: plans\nmanifest: git@github.com:bad/repo.git\n');

    const t = new Trellis(root);
    const git = vi.fn<GitExecutor>().mockReturnValue(null);

    expect(() => t.fetch(git)).toThrow('Failed to discover project manifest');
  });
});

describe('Trellis.projectPlans()', () => {
  const manifestYaml = `
name: twiglylabs
repos:
  trellis:
    url: git@github.com:twiglylabs/trellis.git
    branch: main
    visibility: public
  canopy:
    url: git@github.com:twiglylabs/canopy.git
    branch: main
    visibility: public
`;

  const remotePlanReadme = `---
title: Remote Plan
status: draft
---

# Remote Plan

## Problem
`;

  it('returns null when no manifest configured', () => {
    const { root } = createFixture([]);
    const t = new Trellis(root);
    expect(t.projectPlans()).toBeNull();
  });

  it('returns remote plans map when manifest is configured', () => {
    const { root } = createFixture([]);
    writeFileSync(join(root, '.trellis'), 'project: trellis\nplans_dir: plans\nmanifest: git@github.com:twiglylabs/twiglylabs.git\n');

    const t = new Trellis(root);
    const git = vi.fn<GitExecutor>();

    // discoverManifest
    git.mockReturnValueOnce(null);
    git.mockReturnValueOnce('');
    git.mockReturnValueOnce('');
    git.mockReturnValueOnce(manifestYaml);

    // canopy plans
    git.mockReturnValueOnce(null);
    git.mockReturnValueOnce('');
    git.mockReturnValueOnce('');
    git.mockReturnValueOnce('plan-x\n');
    git.mockReturnValueOnce(remotePlanReadme);

    const result = t.projectPlans(git);
    expect(result).not.toBeNull();
    expect(result!.has('canopy')).toBe(true);
    expect(result!.get('canopy')![0].repoAlias).toBe('canopy');
  });

  it('returns null when manifest discovery fails', () => {
    const { root } = createFixture([]);
    writeFileSync(join(root, '.trellis'), 'project: trellis\nplans_dir: plans\nmanifest: git@github.com:bad/url.git\n');

    const t = new Trellis(root);
    const git = vi.fn<GitExecutor>().mockReturnValue(null);

    expect(t.projectPlans(git)).toBeNull();
  });
});
