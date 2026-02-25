import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, realpathSync, symlinkSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { detectWorktree, detectWorktreeAsync, applyWorktreeOverride, applyWorktreeOverrideAsync } from './worktree.ts';
import type { ResolvedRepo } from './types.ts';

function makeTmpDir(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'trellis-worktree-test-')));
}

function makeRepo(name: string): string {
  const dir = makeTmpDir();
  const repoDir = join(dir, name);
  mkdirSync(repoDir, { recursive: true });
  execFileSync('git', ['init', '--initial-branch=main'], { cwd: repoDir, stdio: 'pipe' });
  execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: repoDir, stdio: 'pipe' });
  return repoDir;
}

function makeResolvedRepo(alias: string, localPath: string, exists = true): ResolvedRepo {
  return {
    alias,
    name: alias,
    description: '',
    tags: [],
    url: '',
    branch: 'main',
    visibility: 'private',
    localPath,
    exists,
  };
}

// --- detectWorktree ---

describe('detectWorktree', () => {
  it('returns isWorktree: false for a normal .git directory', () => {
    const repo = makeRepo('normal');
    const result = detectWorktree(repo);
    expect(result).toEqual({ isWorktree: false });
  });

  it('returns isWorktree: false when .git does not exist', () => {
    const dir = makeTmpDir();
    const result = detectWorktree(dir);
    expect(result).toEqual({ isWorktree: false });
  });

  it('returns isWorktree: true with correct mainRepoPath for a git worktree', () => {
    const mainRepo = makeRepo('main-repo');
    const worktreeDir = join(makeTmpDir(), 'my-worktree');
    execFileSync('git', ['worktree', 'add', '-b', 'feature', worktreeDir], { cwd: mainRepo, stdio: 'pipe' });

    const result = detectWorktree(worktreeDir);
    expect(result.isWorktree).toBe(true);
    expect(result.mainRepoPath).toBe(realpathSync(mainRepo));
  });

  it('returns isWorktree: false for malformed gitdir content', () => {
    const dir = makeTmpDir();
    const repoDir = join(dir, 'bad');
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(join(repoDir, '.git'), 'not a gitdir pointer');

    const result = detectWorktree(repoDir);
    expect(result).toEqual({ isWorktree: false });
  });

  it('handles relative gitdir path in .git file', () => {
    const mainRepo = makeRepo('relative-gitdir');
    const worktreeDir = join(makeTmpDir(), 'wt-relative');
    execFileSync('git', ['worktree', 'add', '-b', 'feat-relative', worktreeDir], { cwd: mainRepo, stdio: 'pipe' });

    // Rewrite .git file to use a relative gitdir path
    const gitFileContent = readFileSync(join(worktreeDir, '.git'), 'utf8').trim();
    const absGitdir = gitFileContent.slice('gitdir: '.length);
    const relGitdir = relative(worktreeDir, absGitdir);
    writeFileSync(join(worktreeDir, '.git'), `gitdir: ${relGitdir}`);

    const result = detectWorktree(worktreeDir);
    expect(result.isWorktree).toBe(true);
    expect(result.mainRepoPath).toBe(realpathSync(mainRepo));
  });

  it('resolves mainRepoPath through symlinks', () => {
    const mainRepo = makeRepo('symlink-target');
    const worktreeDir = join(makeTmpDir(), 'wt-symlink');
    execFileSync('git', ['worktree', 'add', '-b', 'feat-symlink', worktreeDir], { cwd: mainRepo, stdio: 'pipe' });

    // Create a symlink to the main repo and verify detection resolves through it
    const linkDir = join(makeTmpDir(), 'repo-link');
    symlinkSync(mainRepo, linkDir);

    // The worktree's mainRepoPath should match the realpath of the symlink target
    const result = detectWorktree(worktreeDir);
    expect(result.isWorktree).toBe(true);
    expect(result.mainRepoPath).toBe(realpathSync(linkDir));
  });

  it('returns isWorktree: false when commondir is missing', () => {
    const dir = makeTmpDir();
    const repoDir = join(dir, 'no-commondir');
    mkdirSync(repoDir, { recursive: true });
    // Point to a gitdir path that exists but has no commondir
    const fakeGitdir = join(dir, 'fake-gitdir');
    mkdirSync(fakeGitdir, { recursive: true });
    writeFileSync(join(repoDir, '.git'), `gitdir: ${fakeGitdir}`);

    const result = detectWorktree(repoDir);
    expect(result).toEqual({ isWorktree: false });
  });
});

// --- detectWorktreeAsync ---

describe('detectWorktreeAsync', () => {
  it('returns isWorktree: false for a normal .git directory', async () => {
    const repo = makeRepo('normal-async');
    const result = await detectWorktreeAsync(repo);
    expect(result).toEqual({ isWorktree: false });
  });

  it('returns isWorktree: true with correct mainRepoPath for a git worktree', async () => {
    const mainRepo = makeRepo('main-async');
    const worktreeDir = join(makeTmpDir(), 'wt-async');
    execFileSync('git', ['worktree', 'add', '-b', 'feat-async', worktreeDir], { cwd: mainRepo, stdio: 'pipe' });

    const result = await detectWorktreeAsync(worktreeDir);
    expect(result.isWorktree).toBe(true);
    expect(result.mainRepoPath).toBe(realpathSync(mainRepo));
  });

  it('returns isWorktree: false when .git does not exist', async () => {
    const dir = makeTmpDir();
    const result = await detectWorktreeAsync(dir);
    expect(result).toEqual({ isWorktree: false });
  });

  it('returns isWorktree: false for malformed gitdir content', async () => {
    const dir = makeTmpDir();
    const repoDir = join(dir, 'bad-async');
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(join(repoDir, '.git'), 'not a gitdir pointer');

    const result = await detectWorktreeAsync(repoDir);
    expect(result).toEqual({ isWorktree: false });
  });

  it('returns isWorktree: false when commondir is missing', async () => {
    const dir = makeTmpDir();
    const repoDir = join(dir, 'no-commondir-async');
    mkdirSync(repoDir, { recursive: true });
    const fakeGitdir = join(dir, 'fake-gitdir-async');
    mkdirSync(fakeGitdir, { recursive: true });
    writeFileSync(join(repoDir, '.git'), `gitdir: ${fakeGitdir}`);

    const result = await detectWorktreeAsync(repoDir);
    expect(result).toEqual({ isWorktree: false });
  });
});

// --- applyWorktreeOverride ---

describe('applyWorktreeOverride', () => {
  it('substitutes matching repo localPath when CWD is a worktree', () => {
    const mainRepo = makeRepo('override-main');
    const worktreeDir = join(makeTmpDir(), 'wt-override');
    execFileSync('git', ['worktree', 'add', '-b', 'feat-override', worktreeDir], { cwd: mainRepo, stdio: 'pipe' });

    const repos = [
      makeResolvedRepo('trellis', mainRepo),
      makeResolvedRepo('canopy', '/some/other/repo'),
    ];

    const result = applyWorktreeOverride(repos, worktreeDir);

    // The matching repo should have its path swapped
    expect(result[0].localPath).toBe(worktreeDir);
    expect(result[0].exists).toBe(true);
    // The non-matching repo should be unchanged
    expect(result[1].localPath).toBe('/some/other/repo');
  });

  it('returns repos unchanged when CWD is not a worktree', () => {
    const normalRepo = makeRepo('not-worktree');
    const repos = [makeResolvedRepo('trellis', normalRepo)];

    const result = applyWorktreeOverride(repos, normalRepo);

    expect(result[0].localPath).toBe(normalRepo);
  });

  it('only overrides the matching repo, leaves others alone', () => {
    const mainRepo = makeRepo('multi-main');
    const otherRepo = makeRepo('multi-other');
    const worktreeDir = join(makeTmpDir(), 'wt-multi');
    execFileSync('git', ['worktree', 'add', '-b', 'feat-multi', worktreeDir], { cwd: mainRepo, stdio: 'pipe' });

    const repos = [
      makeResolvedRepo('trellis', mainRepo),
      makeResolvedRepo('canopy', otherRepo),
    ];

    const result = applyWorktreeOverride(repos, worktreeDir);

    expect(result[0].localPath).toBe(worktreeDir);
    expect(result[1].localPath).toBe(otherRepo);
  });

  it('returns repos unchanged when worktree does not match any manifest repo', () => {
    const mainRepo = makeRepo('unrelated-main');
    const otherRepo = makeRepo('unrelated-other');
    const worktreeDir = join(makeTmpDir(), 'wt-unrelated');
    execFileSync('git', ['worktree', 'add', '-b', 'feat-unrelated', worktreeDir], { cwd: mainRepo, stdio: 'pipe' });

    // Manifest only contains otherRepo, which is NOT the worktree's main repo
    const repos = [makeResolvedRepo('canopy', otherRepo)];

    const result = applyWorktreeOverride(repos, worktreeDir);

    expect(result[0].localPath).toBe(otherRepo);
  });

  it('matches manifest repo through symlink to the same real path', () => {
    const mainRepo = makeRepo('symlink-match');
    const worktreeDir = join(makeTmpDir(), 'wt-symlink-match');
    execFileSync('git', ['worktree', 'add', '-b', 'feat-symlink-match', worktreeDir], { cwd: mainRepo, stdio: 'pipe' });

    // Manifest references the repo through a symlink, not the real path
    const linkDir = join(makeTmpDir(), 'repo-link');
    symlinkSync(mainRepo, linkDir);
    const repos = [makeResolvedRepo('trellis', linkDir)];

    const result = applyWorktreeOverride(repos, worktreeDir);

    // Should still match because realpathSync normalizes both
    expect(result[0].localPath).toBe(worktreeDir);
    expect(result[0].exists).toBe(true);
  });

  it('handles non-existent repo paths gracefully', () => {
    const mainRepo = makeRepo('graceful-main');
    const worktreeDir = join(makeTmpDir(), 'wt-graceful');
    execFileSync('git', ['worktree', 'add', '-b', 'feat-graceful', worktreeDir], { cwd: mainRepo, stdio: 'pipe' });

    const repos = [
      makeResolvedRepo('missing', '/nonexistent/path', false),
      makeResolvedRepo('trellis', mainRepo),
    ];

    const result = applyWorktreeOverride(repos, worktreeDir);

    // Non-existent repo should be passed through unchanged
    expect(result[0].localPath).toBe('/nonexistent/path');
    expect(result[0].exists).toBe(false);
    // Matching repo should be overridden
    expect(result[1].localPath).toBe(worktreeDir);
  });
});

// --- applyWorktreeOverrideAsync ---

describe('applyWorktreeOverrideAsync', () => {
  it('substitutes matching repo localPath when CWD is a worktree', async () => {
    const mainRepo = makeRepo('async-override-main');
    const worktreeDir = join(makeTmpDir(), 'wt-async-override');
    execFileSync('git', ['worktree', 'add', '-b', 'feat-async-override', worktreeDir], { cwd: mainRepo, stdio: 'pipe' });

    const repos = [
      makeResolvedRepo('trellis', mainRepo),
      makeResolvedRepo('canopy', '/some/other/repo'),
    ];

    const result = await applyWorktreeOverrideAsync(repos, worktreeDir);

    expect(result[0].localPath).toBe(worktreeDir);
    expect(result[0].exists).toBe(true);
    expect(result[1].localPath).toBe('/some/other/repo');
  });

  it('returns repos unchanged when CWD is not a worktree', async () => {
    const normalRepo = makeRepo('async-not-wt');
    const repos = [makeResolvedRepo('trellis', normalRepo)];

    const result = await applyWorktreeOverrideAsync(repos, normalRepo);

    expect(result[0].localPath).toBe(normalRepo);
  });

  it('only overrides the matching repo, leaves others alone', async () => {
    const mainRepo = makeRepo('async-multi-main');
    const otherRepo = makeRepo('async-multi-other');
    const worktreeDir = join(makeTmpDir(), 'wt-async-multi');
    execFileSync('git', ['worktree', 'add', '-b', 'feat-async-multi', worktreeDir], { cwd: mainRepo, stdio: 'pipe' });

    const repos = [
      makeResolvedRepo('trellis', mainRepo),
      makeResolvedRepo('canopy', otherRepo),
    ];

    const result = await applyWorktreeOverrideAsync(repos, worktreeDir);

    expect(result[0].localPath).toBe(worktreeDir);
    expect(result[1].localPath).toBe(otherRepo);
  });

  it('handles non-existent repo paths gracefully', async () => {
    const mainRepo = makeRepo('async-graceful-main');
    const worktreeDir = join(makeTmpDir(), 'wt-async-graceful');
    execFileSync('git', ['worktree', 'add', '-b', 'feat-async-graceful', worktreeDir], { cwd: mainRepo, stdio: 'pipe' });

    const repos = [
      makeResolvedRepo('missing', '/nonexistent/path', false),
      makeResolvedRepo('trellis', mainRepo),
    ];

    const result = await applyWorktreeOverrideAsync(repos, worktreeDir);

    expect(result[0].localPath).toBe('/nonexistent/path');
    expect(result[0].exists).toBe(false);
    expect(result[1].localPath).toBe(worktreeDir);
  });

  it('returns repos unchanged when worktree does not match any manifest repo', async () => {
    const mainRepo = makeRepo('async-unrelated-main');
    const otherRepo = makeRepo('async-unrelated-other');
    const worktreeDir = join(makeTmpDir(), 'wt-async-unrelated');
    execFileSync('git', ['worktree', 'add', '-b', 'feat-async-unrelated', worktreeDir], { cwd: mainRepo, stdio: 'pipe' });

    const repos = [makeResolvedRepo('canopy', otherRepo)];

    const result = await applyWorktreeOverrideAsync(repos, worktreeDir);

    expect(result[0].localPath).toBe(otherRepo);
  });
});
