import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseManifest,
  ensureRemote,
  fetchRemote,
  gitShow,
  gitListTree,
  discoverManifest,
  fetchRepoPlans,
  fetchProjectPlans,
  checkVisibility,
  type GitExecutor,
} from '../src/manifest.ts';
import type { ProjectManifest, Plan, RepoEntry } from '../src/types.ts';

// --- parseManifest ---

describe('parseManifest', () => {
  const validManifest = `
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

  it('parses a valid manifest', () => {
    const result = parseManifest(validManifest);
    expect(result.name).toBe('twiglylabs');
    expect(Object.keys(result.repos)).toEqual(['trellis', 'canopy', 'acorn']);
    expect(result.repos.trellis).toEqual({
      url: 'git@github.com:twiglylabs/trellis.git',
      branch: 'main',
      visibility: 'public',
    });
    expect(result.repos.acorn.branch).toBe('develop');
    expect(result.repos.acorn.visibility).toBe('private');
  });

  it('throws on missing name', () => {
    expect(() => parseManifest('repos:\n  a:\n    url: x\n    branch: main\n    visibility: public\n'))
      .toThrow('missing or non-string "name"');
  });

  it('throws on missing repos', () => {
    expect(() => parseManifest('name: test\n'))
      .toThrow('missing or invalid "repos"');
  });

  it('throws on empty repos', () => {
    expect(() => parseManifest('name: test\nrepos: {}\n'))
      .toThrow('"repos" is empty');
  });

  it('throws on missing url', () => {
    expect(() => parseManifest('name: test\nrepos:\n  a:\n    branch: main\n    visibility: public\n'))
      .toThrow('repo "a" missing "url"');
  });

  it('throws on missing branch', () => {
    expect(() => parseManifest('name: test\nrepos:\n  a:\n    url: x\n    visibility: public\n'))
      .toThrow('repo "a" missing "branch"');
  });

  it('throws on invalid visibility', () => {
    expect(() => parseManifest('name: test\nrepos:\n  a:\n    url: x\n    branch: main\n    visibility: internal\n'))
      .toThrow('invalid visibility "internal"');
  });

  it('throws on missing visibility', () => {
    expect(() => parseManifest('name: test\nrepos:\n  a:\n    url: x\n    branch: main\n'))
      .toThrow('invalid visibility');
  });

  it('throws on non-object YAML', () => {
    expect(() => parseManifest('just a string'))
      .toThrow('not a YAML object');
  });

  it('throws on repo entry that is not an object', () => {
    expect(() => parseManifest('name: test\nrepos:\n  a: just-a-string\n'))
      .toThrow('repo "a" is not an object');
  });
});

// --- Git operations ---

describe('ensureRemote', () => {
  it('adds remote if it does not exist', () => {
    const git = vi.fn<GitExecutor>()
      .mockReturnValueOnce(null)  // remote get-url fails (doesn't exist)
      .mockReturnValueOnce('');   // remote add succeeds
    ensureRemote('trellis/canopy', 'git@github.com:twiglylabs/canopy.git', '/tmp', git);
    expect(git).toHaveBeenCalledWith(['remote', 'get-url', 'trellis/canopy'], '/tmp');
    expect(git).toHaveBeenCalledWith(['remote', 'add', 'trellis/canopy', 'git@github.com:twiglylabs/canopy.git'], '/tmp');
  });

  it('updates remote url if it has changed', () => {
    const git = vi.fn<GitExecutor>()
      .mockReturnValueOnce('git@github.com:old/url.git\n')  // remote exists with different url
      .mockReturnValueOnce('');                              // set-url succeeds
    ensureRemote('trellis/canopy', 'git@github.com:new/url.git', '/tmp', git);
    expect(git).toHaveBeenCalledWith(['remote', 'set-url', 'trellis/canopy', 'git@github.com:new/url.git'], '/tmp');
  });

  it('does nothing if remote url matches', () => {
    const git = vi.fn<GitExecutor>()
      .mockReturnValueOnce('git@github.com:twiglylabs/canopy.git');  // matches
    ensureRemote('trellis/canopy', 'git@github.com:twiglylabs/canopy.git', '/tmp', git);
    expect(git).toHaveBeenCalledTimes(1);
  });
});

describe('fetchRemote', () => {
  it('returns ok on success', () => {
    const git = vi.fn<GitExecutor>().mockReturnValueOnce('');
    const result = fetchRemote('trellis/canopy', '/tmp', git);
    expect(result).toEqual({ ok: true });
    expect(git).toHaveBeenCalledWith(['fetch', 'trellis/canopy'], '/tmp');
  });

  it('returns error on failure', () => {
    const git = vi.fn<GitExecutor>().mockReturnValueOnce(null);
    const result = fetchRemote('trellis/canopy', '/tmp', git);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('trellis/canopy');
  });
});

describe('gitShow', () => {
  it('returns content on success', () => {
    const git = vi.fn<GitExecutor>().mockReturnValueOnce('file content');
    const result = gitShow('trellis/canopy/main:plans/foo/README.md', '/tmp', git);
    expect(result).toBe('file content');
    expect(git).toHaveBeenCalledWith(['show', 'trellis/canopy/main:plans/foo/README.md'], '/tmp');
  });

  it('returns null on failure', () => {
    const git = vi.fn<GitExecutor>().mockReturnValueOnce(null);
    const result = gitShow('nonexistent-ref', '/tmp', git);
    expect(result).toBeNull();
  });
});

describe('gitListTree', () => {
  it('returns directory names', () => {
    const git = vi.fn<GitExecutor>().mockReturnValueOnce('plan-a\nplan-b\nplan-c\n');
    const result = gitListTree('trellis/canopy/main:plans', '/tmp', git);
    expect(result).toEqual(['plan-a', 'plan-b', 'plan-c']);
  });

  it('returns empty array on failure', () => {
    const git = vi.fn<GitExecutor>().mockReturnValueOnce(null);
    const result = gitListTree('nonexistent-ref', '/tmp', git);
    expect(result).toEqual([]);
  });

  it('filters empty lines', () => {
    const git = vi.fn<GitExecutor>().mockReturnValueOnce('plan-a\n\nplan-b\n');
    const result = gitListTree('ref', '/tmp', git);
    expect(result).toEqual(['plan-a', 'plan-b']);
  });
});

// --- discoverManifest ---

describe('discoverManifest', () => {
  const manifestContent = `
name: twiglylabs
repos:
  trellis:
    url: git@github.com:twiglylabs/trellis.git
    branch: main
    visibility: public
`;

  it('discovers manifest from meta repo', () => {
    const git = vi.fn<GitExecutor>()
      .mockReturnValueOnce(null)             // remote get-url (doesn't exist)
      .mockReturnValueOnce('')               // remote add
      .mockReturnValueOnce('')               // fetch
      .mockReturnValueOnce(manifestContent); // git show .trellis-project

    const result = discoverManifest('git@github.com:twiglylabs/twiglylabs.git', '/tmp', git);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('twiglylabs');

    // Verify remote naming convention
    expect(git).toHaveBeenCalledWith(['remote', 'add', 'trellis/__manifest', 'git@github.com:twiglylabs/twiglylabs.git'], '/tmp');
    expect(git).toHaveBeenCalledWith(['fetch', 'trellis/__manifest'], '/tmp');
    expect(git).toHaveBeenCalledWith(['show', 'trellis/__manifest/main:.trellis-project'], '/tmp');
  });

  it('returns null on fetch failure', () => {
    const git = vi.fn<GitExecutor>()
      .mockReturnValueOnce(null)  // remote get-url
      .mockReturnValueOnce('')    // remote add
      .mockReturnValueOnce(null); // fetch fails

    const result = discoverManifest('git@example.com:bad/repo.git', '/tmp', git);
    expect(result).toBeNull();
  });

  it('returns null when .trellis-project not found', () => {
    const git = vi.fn<GitExecutor>()
      .mockReturnValueOnce(null)   // remote get-url
      .mockReturnValueOnce('')     // remote add
      .mockReturnValueOnce('')     // fetch succeeds
      .mockReturnValueOnce(null);  // git show returns null

    const result = discoverManifest('git@example.com:meta/repo.git', '/tmp', git);
    expect(result).toBeNull();
  });

  it('returns null on invalid manifest YAML', () => {
    const git = vi.fn<GitExecutor>()
      .mockReturnValueOnce(null)      // remote get-url
      .mockReturnValueOnce('')        // remote add
      .mockReturnValueOnce('')        // fetch
      .mockReturnValueOnce('not valid yaml: {{{');  // invalid content

    const result = discoverManifest('git@example.com:meta/repo.git', '/tmp', git);
    expect(result).toBeNull();
  });
});

// --- fetchRepoPlans ---

describe('fetchRepoPlans', () => {
  const entry: RepoEntry = {
    url: 'git@github.com:twiglylabs/canopy.git',
    branch: 'main',
    visibility: 'public',
  };

  const planReadme = `---
title: Some Plan
status: not_started
depends_on: []
tags: [foundation]
---

# Some Plan

## Problem
Something needs doing.
`;

  it('reads plans from git objects', () => {
    const git = vi.fn<GitExecutor>()
      .mockReturnValueOnce(null)         // remote get-url (doesn't exist)
      .mockReturnValueOnce('')           // remote add
      .mockReturnValueOnce('')           // fetch
      .mockReturnValueOnce('plan-a\nplan-b\n')  // ls-tree
      .mockReturnValueOnce(planReadme)   // git show plan-a/README.md
      .mockReturnValueOnce(planReadme);  // git show plan-b/README.md

    const { plans, fetchFailed } = fetchRepoPlans('canopy', entry, '/tmp', git);
    expect(fetchFailed).toBe(false);
    expect(plans).toHaveLength(2);
    expect(plans[0].id).toBe('plan-a');
    expect(plans[0].repoAlias).toBe('canopy');
    expect(plans[0].filePath).toBe('trellis/canopy/main:plans/plan-a/README.md');
    expect(plans[0].frontmatter.title).toBe('Some Plan');
    expect(plans[0].lineCount).toBe(planReadme.split('\n').length);
    expect(plans[1].id).toBe('plan-b');
    expect(plans[1].repoAlias).toBe('canopy');
  });

  it('sets synthetic filePath for remote plans', () => {
    const entryDev: RepoEntry = { url: 'x', branch: 'develop', visibility: 'private' };
    const git = vi.fn<GitExecutor>()
      .mockReturnValueOnce(null)       // remote get-url
      .mockReturnValueOnce('')         // remote add
      .mockReturnValueOnce('')         // fetch
      .mockReturnValueOnce('my-plan\n') // ls-tree
      .mockReturnValueOnce(planReadme); // git show

    const { plans } = fetchRepoPlans('acorn', entryDev, '/tmp', git);
    expect(plans[0].filePath).toBe('trellis/acorn/develop:plans/my-plan/README.md');
  });

  it('skips plans with invalid frontmatter', () => {
    const git = vi.fn<GitExecutor>()
      .mockReturnValueOnce(null)
      .mockReturnValueOnce('')
      .mockReturnValueOnce('')
      .mockReturnValueOnce('good-plan\nbad-plan\n')
      .mockReturnValueOnce(planReadme)
      .mockReturnValueOnce('no frontmatter here');  // bad plan

    const { plans } = fetchRepoPlans('canopy', entry, '/tmp', git);
    expect(plans).toHaveLength(1);
    expect(plans[0].id).toBe('good-plan');
  });

  it('returns fetchFailed true on fetch failure', () => {
    const git = vi.fn<GitExecutor>()
      .mockReturnValueOnce(null)   // remote get-url
      .mockReturnValueOnce('')     // remote add
      .mockReturnValueOnce(null);  // fetch fails

    const { plans, fetchFailed } = fetchRepoPlans('canopy', entry, '/tmp', git);
    expect(plans).toEqual([]);
    expect(fetchFailed).toBe(true);
  });

  it('handles missing plans directory', () => {
    const git = vi.fn<GitExecutor>()
      .mockReturnValueOnce(null)   // remote get-url
      .mockReturnValueOnce('')     // remote add
      .mockReturnValueOnce('')     // fetch succeeds
      .mockReturnValueOnce(null);  // ls-tree returns null (no plans dir)

    const { plans, fetchFailed } = fetchRepoPlans('canopy', entry, '/tmp', git);
    expect(plans).toEqual([]);
    expect(fetchFailed).toBe(false);
  });

  it('handles individual plan read failures', () => {
    const git = vi.fn<GitExecutor>()
      .mockReturnValueOnce(null)
      .mockReturnValueOnce('')
      .mockReturnValueOnce('')
      .mockReturnValueOnce('plan-a\nplan-b\n')
      .mockReturnValueOnce(null)          // plan-a README.md not found
      .mockReturnValueOnce(planReadme);   // plan-b works

    const { plans } = fetchRepoPlans('canopy', entry, '/tmp', git);
    expect(plans).toHaveLength(1);
    expect(plans[0].id).toBe('plan-b');
  });
});

// --- fetchProjectPlans ---

describe('fetchProjectPlans', () => {
  const manifest: ProjectManifest = {
    name: 'twiglylabs',
    repos: {
      trellis: { url: 'git@github.com:twiglylabs/trellis.git', branch: 'main', visibility: 'public' },
      canopy: { url: 'git@github.com:twiglylabs/canopy.git', branch: 'main', visibility: 'public' },
      acorn: { url: 'git@github.com:twiglylabs/acorn.git', branch: 'develop', visibility: 'private' },
    },
  };

  const planReadme = `---
title: Remote Plan
status: draft
---

# Remote Plan

## Problem
`;

  it('skips current repo', () => {
    const git = vi.fn<GitExecutor>()
      // canopy: remote get-url, add, fetch, ls-tree, show
      .mockReturnValueOnce(null).mockReturnValueOnce('').mockReturnValueOnce('')
      .mockReturnValueOnce('plan-c\n').mockReturnValueOnce(planReadme)
      // acorn: remote get-url, add, fetch, ls-tree, show
      .mockReturnValueOnce(null).mockReturnValueOnce('').mockReturnValueOnce('')
      .mockReturnValueOnce('plan-a\n').mockReturnValueOnce(planReadme);

    const result = fetchProjectPlans(manifest, 'trellis', '/tmp', git);
    // Should have canopy and acorn but not trellis
    expect(result.has('trellis')).toBe(false);
    expect(result.has('canopy')).toBe(true);
    expect(result.has('acorn')).toBe(true);

    // Verify plan content is correctly keyed by alias
    const canopyPlans = result.get('canopy')!;
    expect(canopyPlans).toHaveLength(1);
    expect(canopyPlans[0].id).toBe('plan-c');
    expect(canopyPlans[0].repoAlias).toBe('canopy');
    expect(canopyPlans[0].frontmatter.title).toBe('Remote Plan');

    const acornPlans = result.get('acorn')!;
    expect(acornPlans).toHaveLength(1);
    expect(acornPlans[0].id).toBe('plan-a');
    expect(acornPlans[0].repoAlias).toBe('acorn');
  });

  it('warns on failed fetch for a repo', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const git = vi.fn<GitExecutor>()
      // canopy: remote get-url, add, fetch fails
      .mockReturnValueOnce(null).mockReturnValueOnce('').mockReturnValueOnce(null)
      // acorn: remote get-url, add, fetch succeeds, ls-tree, show
      .mockReturnValueOnce(null).mockReturnValueOnce('').mockReturnValueOnce('')
      .mockReturnValueOnce('plan-x\n').mockReturnValueOnce(planReadme);

    const result = fetchProjectPlans(manifest, 'trellis', '/tmp', git);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('canopy'));
    expect(result.has('acorn')).toBe(true);
    consoleSpy.mockRestore();
  });

  it('returns empty map when all fetches fail', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const git = vi.fn<GitExecutor>().mockReturnValue(null);

    const result = fetchProjectPlans(manifest, 'trellis', '/tmp', git);
    expect(result.size).toBe(0);
    consoleSpy.mockRestore();
  });
});

// --- checkVisibility ---

describe('checkVisibility', () => {
  const manifest: ProjectManifest = {
    name: 'test',
    repos: {
      public_repo: { url: 'x', branch: 'main', visibility: 'public' },
      private_repo: { url: 'y', branch: 'main', visibility: 'private' },
      other_public: { url: 'z', branch: 'main', visibility: 'public' },
    },
  };

  function makePlan(id: string, depends_on?: string[]): Plan {
    return {
      id,
      filePath: `plans/${id}/README.md`,
      frontmatter: { title: id, status: 'not_started', depends_on },
      body: '',
      lineCount: 1,
    };
  }

  it('flags public-to-private dependencies', () => {
    const allPlans = new Map<string, Plan[]>([
      ['public_repo', [makePlan('pub-plan', ['private_repo/priv-plan'])]],
      ['private_repo', [makePlan('priv-plan')]],
    ]);

    const errors = checkVisibility(manifest, allPlans);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('public repos cannot depend on private repos');
  });

  it('allows private-to-public dependencies', () => {
    const allPlans = new Map<string, Plan[]>([
      ['private_repo', [makePlan('priv-plan', ['public_repo/pub-plan'])]],
      ['public_repo', [makePlan('pub-plan')]],
    ]);

    const errors = checkVisibility(manifest, allPlans);
    expect(errors).toHaveLength(0);
  });

  it('allows same-visibility dependencies', () => {
    const allPlans = new Map<string, Plan[]>([
      ['public_repo', [makePlan('plan-a', ['other_public/plan-b'])]],
      ['other_public', [makePlan('plan-b')]],
    ]);

    const errors = checkVisibility(manifest, allPlans);
    expect(errors).toHaveLength(0);
  });

  it('ignores unqualified (local) dependencies', () => {
    const allPlans = new Map<string, Plan[]>([
      ['public_repo', [makePlan('plan-a', ['local-plan'])]],
    ]);

    const errors = checkVisibility(manifest, allPlans);
    expect(errors).toHaveLength(0);
  });

  it('ignores dependencies to unknown repos', () => {
    const allPlans = new Map<string, Plan[]>([
      ['public_repo', [makePlan('plan-a', ['unknown_repo/plan-b'])]],
    ]);

    const errors = checkVisibility(manifest, allPlans);
    expect(errors).toHaveLength(0);
  });
});
