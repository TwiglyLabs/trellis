import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
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
  resolveProjectRepos,
  resolveProjectReposAsync,
  type GitExecutor,
} from './manifest.ts';
import type { ProjectManifest, Plan, RepoEntry } from './types.ts';

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

  it('parses base_dir field', () => {
    const result = parseManifest(`
name: test
base_dir: ~/repos
repos:
  a:
    url: x
    branch: main
    visibility: public
    path: org/repo-a
`);
    expect(result.base_dir).toBe('~/repos');
  });

  it('parses repo name, description, and tags', () => {
    const result = parseManifest(`
name: test
repos:
  a:
    url: x
    branch: main
    visibility: public
    name: My Repo
    description: A test repo
    tags: [frontend, internal]
`);
    expect(result.repos.a.name).toBe('My Repo');
    expect(result.repos.a.description).toBe('A test repo');
    expect(result.repos.a.tags).toEqual(['frontend', 'internal']);
  });

  it('throws on non-string base_dir', () => {
    expect(() => parseManifest('name: test\nbase_dir: 123\nrepos:\n  a:\n    url: x\n    branch: main\n    visibility: public\n'))
      .toThrow('"base_dir" must be a string');
  });

  it('throws on non-string repo name', () => {
    expect(() => parseManifest('name: test\nrepos:\n  a:\n    url: x\n    branch: main\n    visibility: public\n    name: 123\n'))
      .toThrow('repo "a" has non-string "name"');
  });

  it('throws on non-string repo description', () => {
    expect(() => parseManifest('name: test\nrepos:\n  a:\n    url: x\n    branch: main\n    visibility: public\n    description: 123\n'))
      .toThrow('repo "a" has non-string "description"');
  });

  it('throws on invalid tags', () => {
    expect(() => parseManifest('name: test\nrepos:\n  a:\n    url: x\n    branch: main\n    visibility: public\n    tags: not-an-array\n'))
      .toThrow('repo "a" has invalid "tags"');
  });

  it('throws on tags with non-string elements', () => {
    expect(() => parseManifest('name: test\nrepos:\n  a:\n    url: x\n    branch: main\n    visibility: public\n    tags: [1, 2]\n'))
      .toThrow('repo "a" has invalid "tags"');
  });

  it('omits base_dir when not present', () => {
    const result = parseManifest(validManifest);
    expect(result.base_dir).toBeUndefined();
  });

  it('backward compat — old manifests without new fields still work', () => {
    const result = parseManifest(validManifest);
    expect(result.repos.trellis.name).toBeUndefined();
    expect(result.repos.trellis.description).toBeUndefined();
    expect(result.repos.trellis.tags).toBeUndefined();
    expect(result.repos.trellis.group).toBeUndefined();
  });

  it('parses repo group field', () => {
    const result = parseManifest(`
name: test
repos:
  a:
    url: x
    branch: main
    visibility: public
    group: tooling
`);
    expect(result.repos.a.group).toBe('tooling');
  });

  it('parses repo without group field', () => {
    const result = parseManifest(`
name: test
repos:
  a:
    url: x
    branch: main
    visibility: public
`);
    expect(result.repos.a.group).toBeUndefined();
  });

  it('throws on non-string group', () => {
    expect(() => parseManifest('name: test\nrepos:\n  a:\n    url: x\n    branch: main\n    visibility: public\n    group: 123\n'))
      .toThrow('repo "a" has non-string "group"');
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
      updatedAt: new Date(),
      fileHashes: {},
    };
  }

  it('flags public-to-private dependencies', () => {
    const allPlans = new Map<string, Plan[]>([
      ['public_repo', [makePlan('pub-plan', ['private_repo:priv-plan'])]],
      ['private_repo', [makePlan('priv-plan')]],
    ]);

    const errors = checkVisibility(manifest, allPlans);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('public repos cannot depend on private repos');
  });

  it('allows private-to-public dependencies', () => {
    const allPlans = new Map<string, Plan[]>([
      ['private_repo', [makePlan('priv-plan', ['public_repo:pub-plan'])]],
      ['public_repo', [makePlan('pub-plan')]],
    ]);

    const errors = checkVisibility(manifest, allPlans);
    expect(errors).toHaveLength(0);
  });

  it('allows same-visibility dependencies', () => {
    const allPlans = new Map<string, Plan[]>([
      ['public_repo', [makePlan('plan-a', ['other_public:plan-b'])]],
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
      ['public_repo', [makePlan('plan-a', ['unknown_repo:plan-b'])]],
    ]);

    const errors = checkVisibility(manifest, allPlans);
    expect(errors).toHaveLength(0);
  });
});

// --- resolveProjectRepos ---

describe('resolveProjectRepos', () => {
  function writeTmpManifest(content: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'trellis-test-'));
    const manifestPath = join(dir, '.trellis-project');
    writeFileSync(manifestPath, content, 'utf8');
    return manifestPath;
  }

  it('resolves repos with base_dir and relative paths', () => {
    const manifestPath = writeTmpManifest(`
name: test
base_dir: /tmp
repos:
  myrepo:
    url: git@example.com:org/repo.git
    branch: main
    visibility: public
    path: org/repo
`);
    const results = resolveProjectRepos(manifestPath);
    expect(results).toHaveLength(1);
    expect(results[0].alias).toBe('myrepo');
    expect(results[0].localPath).toBe('/tmp/org/repo');
  });

  it('resolves repos without base_dir relative to manifest directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'trellis-test-'));
    const manifestPath = join(dir, '.trellis-project');
    // Create a subdirectory that the path points to
    const repoDir = join(dir, 'subrepo');
    mkdirSync(repoDir);
    writeFileSync(manifestPath, `
name: test
repos:
  myrepo:
    url: git@example.com:org/repo.git
    branch: main
    visibility: public
    path: subrepo
`, 'utf8');
    const results = resolveProjectRepos(manifestPath);
    expect(results).toHaveLength(1);
    expect(results[0].localPath).toBe(repoDir);
    expect(results[0].exists).toBe(true);
  });

  it('expands ~ in base_dir', () => {
    const manifestPath = writeTmpManifest(`
name: test
base_dir: ~/repos
repos:
  myrepo:
    url: git@example.com:org/repo.git
    branch: main
    visibility: public
    path: org/repo
`);
    const results = resolveProjectRepos(manifestPath);
    expect(results[0].localPath).toBe(join(homedir(), 'repos', 'org/repo'));
  });

  it('sets exists: false for missing paths', () => {
    const manifestPath = writeTmpManifest(`
name: test
base_dir: /nonexistent-base-dir-xyz
repos:
  myrepo:
    url: git@example.com:org/repo.git
    branch: main
    visibility: public
    path: does-not-exist
`);
    const results = resolveProjectRepos(manifestPath);
    expect(results[0].exists).toBe(false);
  });

  it('defaults name to alias, description to empty, tags to []', () => {
    const manifestPath = writeTmpManifest(`
name: test
repos:
  myrepo:
    url: git@example.com:org/repo.git
    branch: main
    visibility: public
    path: /tmp
`);
    const results = resolveProjectRepos(manifestPath);
    expect(results[0].name).toBe('myrepo');
    expect(results[0].description).toBe('');
    expect(results[0].tags).toEqual([]);
  });

  it('uses display metadata when provided', () => {
    const manifestPath = writeTmpManifest(`
name: test
repos:
  myrepo:
    url: git@example.com:org/repo.git
    branch: main
    visibility: public
    path: /tmp
    name: My Repo
    description: A great repo
    tags: [frontend, tools]
`);
    const results = resolveProjectRepos(manifestPath);
    expect(results[0].name).toBe('My Repo');
    expect(results[0].description).toBe('A great repo');
    expect(results[0].tags).toEqual(['frontend', 'tools']);
  });

  it('skips repos without a path field', () => {
    const manifestPath = writeTmpManifest(`
name: test
repos:
  with-path:
    url: git@example.com:org/a.git
    branch: main
    visibility: public
    path: /tmp
  without-path:
    url: git@example.com:org/b.git
    branch: main
    visibility: public
`);
    const results = resolveProjectRepos(manifestPath);
    expect(results).toHaveLength(1);
    expect(results[0].alias).toBe('with-path');
  });

  it('backward compat — old manifest format still works', () => {
    const manifestPath = writeTmpManifest(`
name: twiglylabs
repos:
  trellis:
    url: git@github.com:twiglylabs/trellis.git
    branch: main
    visibility: public
    path: /tmp
`);
    const results = resolveProjectRepos(manifestPath);
    expect(results).toHaveLength(1);
    expect(results[0].alias).toBe('trellis');
    expect(results[0].url).toBe('git@github.com:twiglylabs/trellis.git');
    expect(results[0].branch).toBe('main');
    expect(results[0].visibility).toBe('public');
  });

  it('uses absolute entry.path as-is, ignoring base_dir', () => {
    const manifestPath = writeTmpManifest(`
name: test
base_dir: /should/be/ignored
repos:
  myrepo:
    url: git@example.com:org/repo.git
    branch: main
    visibility: public
    path: /tmp
`);
    const results = resolveProjectRepos(manifestPath);
    expect(results).toHaveLength(1);
    expect(results[0].localPath).toBe('/tmp');
    expect(results[0].exists).toBe(true);
  });

  it('expands bare ~ in base_dir to homedir', () => {
    const manifestPath = writeTmpManifest(`
name: test
base_dir: "~"
repos:
  myrepo:
    url: git@example.com:org/repo.git
    branch: main
    visibility: public
    path: somedir
`);
    const results = resolveProjectRepos(manifestPath);
    expect(results[0].localPath).toBe(join(homedir(), 'somedir'));
  });

  it('resolves multiple repos and preserves manifest order', () => {
    const dir = mkdtempSync(join(tmpdir(), 'trellis-test-'));
    const aDir = join(dir, 'a');
    const bDir = join(dir, 'b');
    mkdirSync(aDir);
    mkdirSync(bDir);
    const manifestPath = join(dir, '.trellis-project');
    writeFileSync(manifestPath, `
name: test
repos:
  alpha:
    url: git@example.com:org/alpha.git
    branch: main
    visibility: public
    path: a
    name: Alpha Repo
    tags: [frontend]
  beta:
    url: git@example.com:org/beta.git
    branch: develop
    visibility: private
    path: b
    description: The beta service
  gamma:
    url: git@example.com:org/gamma.git
    branch: main
    visibility: public
`, 'utf8');
    const results = resolveProjectRepos(manifestPath);
    // gamma has no path, so it should be skipped
    expect(results).toHaveLength(2);
    expect(results[0].alias).toBe('alpha');
    expect(results[0].name).toBe('Alpha Repo');
    expect(results[0].tags).toEqual(['frontend']);
    expect(results[0].localPath).toBe(aDir);
    expect(results[0].exists).toBe(true);
    expect(results[1].alias).toBe('beta');
    expect(results[1].name).toBe('beta'); // defaults to alias
    expect(results[1].description).toBe('The beta service');
    expect(results[1].branch).toBe('develop');
    expect(results[1].visibility).toBe('private');
    expect(results[1].localPath).toBe(bDir);
    expect(results[1].exists).toBe(true);
  });

  it('includes group in resolved output', () => {
    const manifestPath = writeTmpManifest(`
name: test
repos:
  myrepo:
    url: git@example.com:org/repo.git
    branch: main
    visibility: public
    path: /tmp
    group: tooling
`);
    const results = resolveProjectRepos(manifestPath);
    expect(results[0].group).toBe('tooling');
  });

  it('omits group when not provided', () => {
    const manifestPath = writeTmpManifest(`
name: test
repos:
  myrepo:
    url: git@example.com:org/repo.git
    branch: main
    visibility: public
    path: /tmp
`);
    const results = resolveProjectRepos(manifestPath);
    expect(results[0].group).toBeUndefined();
  });

  it('resolves path-only entries (no URL)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'trellis-test-'));
    const repoDir = join(dir, 'local-repo');
    mkdirSync(repoDir);
    const manifestPath = join(dir, '.trellis-project');
    writeFileSync(manifestPath, `
name: test
repos:
  local:
    path: local-repo
`, 'utf8');
    const results = resolveProjectRepos(manifestPath);
    expect(results).toHaveLength(1);
    expect(results[0].alias).toBe('local');
    expect(results[0].url).toBe('');
    expect(results[0].branch).toBe('');
    expect(results[0].visibility).toBe('private');
    expect(results[0].localPath).toBe(repoDir);
    expect(results[0].exists).toBe(true);
  });
});

// --- resolveProjectReposAsync ---

describe('resolveProjectReposAsync', () => {
  it('produces identical output to resolveProjectRepos', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trellis-test-'));
    const repoDir = join(dir, 'subrepo');
    mkdirSync(repoDir);
    const manifestPath = join(dir, '.trellis-project');
    writeFileSync(manifestPath, `
name: test
repos:
  myrepo:
    url: git@example.com:org/repo.git
    branch: main
    visibility: public
    path: subrepo
`, 'utf8');

    const sync = resolveProjectRepos(manifestPath);
    const async_ = await resolveProjectReposAsync(manifestPath);
    expect(async_).toEqual(sync);
  });

  it('handles missing paths', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trellis-test-'));
    const manifestPath = join(dir, '.trellis-project');
    writeFileSync(manifestPath, `
name: test
base_dir: /nonexistent-base-dir-xyz
repos:
  myrepo:
    url: git@example.com:org/repo.git
    branch: main
    visibility: public
    path: does-not-exist
`, 'utf8');

    const sync = resolveProjectRepos(manifestPath);
    const async_ = await resolveProjectReposAsync(manifestPath);
    expect(async_).toEqual(sync);
  });

  it('expands tilde in base_dir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trellis-test-'));
    const manifestPath = join(dir, '.trellis-project');
    writeFileSync(manifestPath, `
name: test
base_dir: ~/repos
repos:
  myrepo:
    url: git@example.com:org/repo.git
    branch: main
    visibility: public
    path: org/repo
`, 'utf8');
    const sync = resolveProjectRepos(manifestPath);
    const async_ = await resolveProjectReposAsync(manifestPath);
    expect(async_).toEqual(sync);
    expect(async_[0].localPath).toContain('repos/org/repo');
  });

  it('preserves display metadata', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trellis-test-'));
    const manifestPath = join(dir, '.trellis-project');
    writeFileSync(manifestPath, `
name: test
repos:
  myrepo:
    url: git@example.com:org/repo.git
    branch: main
    visibility: public
    path: /tmp
    name: My Repo
    description: A great repo
    tags: [frontend, tools]
`, 'utf8');
    const sync = resolveProjectRepos(manifestPath);
    const async_ = await resolveProjectReposAsync(manifestPath);
    expect(async_).toEqual(sync);
    expect(async_[0].name).toBe('My Repo');
    expect(async_[0].description).toBe('A great repo');
    expect(async_[0].tags).toEqual(['frontend', 'tools']);
  });

  it('skips repos without a path field', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trellis-test-'));
    const manifestPath = join(dir, '.trellis-project');
    writeFileSync(manifestPath, `
name: test
repos:
  with-path:
    url: git@example.com:org/a.git
    branch: main
    visibility: public
    path: /tmp
  without-path:
    url: git@example.com:org/b.git
    branch: main
    visibility: public
`, 'utf8');
    const sync = resolveProjectRepos(manifestPath);
    const async_ = await resolveProjectReposAsync(manifestPath);
    expect(async_).toEqual(sync);
    expect(async_).toHaveLength(1);
    expect(async_[0].alias).toBe('with-path');
  });

  it('resolves multiple repos and preserves order', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trellis-test-'));
    const aDir = join(dir, 'a');
    const bDir = join(dir, 'b');
    mkdirSync(aDir);
    mkdirSync(bDir);
    const manifestPath = join(dir, '.trellis-project');
    writeFileSync(manifestPath, `
name: test
repos:
  alpha:
    url: git@example.com:org/alpha.git
    branch: main
    visibility: public
    path: a
    name: Alpha Repo
    tags: [frontend]
  beta:
    url: git@example.com:org/beta.git
    branch: develop
    visibility: private
    path: b
    description: The beta service
  gamma:
    url: git@example.com:org/gamma.git
    branch: main
    visibility: public
`, 'utf8');
    const sync = resolveProjectRepos(manifestPath);
    const async_ = await resolveProjectReposAsync(manifestPath);
    expect(async_).toEqual(sync);
    expect(async_).toHaveLength(2);
    expect(async_[0].alias).toBe('alpha');
    expect(async_[1].alias).toBe('beta');
  });

  it('resolves path-only entries (no URL)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trellis-test-'));
    const repoDir = join(dir, 'local-repo');
    mkdirSync(repoDir);
    const manifestPath = join(dir, '.trellis-project');
    writeFileSync(manifestPath, `
name: test
repos:
  local:
    path: local-repo
`, 'utf8');
    const sync = resolveProjectRepos(manifestPath);
    const async_ = await resolveProjectReposAsync(manifestPath);
    expect(async_).toEqual(sync);
    expect(async_[0].url).toBe('');
    expect(async_[0].branch).toBe('');
    expect(async_[0].visibility).toBe('private');
  });

  it('uses absolute path as-is, ignoring base_dir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trellis-test-'));
    const manifestPath = join(dir, '.trellis-project');
    writeFileSync(manifestPath, `
name: test
base_dir: /should/be/ignored
repos:
  myrepo:
    url: git@example.com:org/repo.git
    branch: main
    visibility: public
    path: /tmp
`, 'utf8');
    const sync = resolveProjectRepos(manifestPath);
    const async_ = await resolveProjectReposAsync(manifestPath);
    expect(async_).toEqual(sync);
    expect(async_[0].localPath).toBe('/tmp');
  });
});
