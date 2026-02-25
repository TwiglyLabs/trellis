import { readFileSync, statSync, realpathSync } from 'fs';
import { readFile, stat, realpath } from 'fs/promises';
import { join, resolve, isAbsolute } from 'path';
import type { ResolvedRepo } from './types.ts';

export interface WorktreeInfo {
  isWorktree: boolean;
  mainRepoPath?: string; // absolute, realpath-normalized
}

/**
 * Detect whether `dir` is a git worktree (as opposed to a normal .git directory).
 *
 * Worktrees have a `.git` *file* (not directory) containing `gitdir: <path>`.
 * We follow the gitdir pointer to find the `commondir` file, then resolve
 * the main repo root from that.
 */
export function detectWorktree(dir: string): WorktreeInfo {
  try {
    const gitPath = join(dir, '.git');
    const st = statSync(gitPath);

    // Normal repo: .git is a directory
    if (st.isDirectory()) {
      return { isWorktree: false };
    }

    // Worktree: .git is a file containing "gitdir: <path>"
    if (!st.isFile()) {
      return { isWorktree: false };
    }

    const content = readFileSync(gitPath, 'utf8').trim();
    if (!content.startsWith('gitdir:')) {
      return { isWorktree: false };
    }

    const gitdirRaw = content.slice('gitdir:'.length).trim();
    const gitdir = isAbsolute(gitdirRaw) ? gitdirRaw : resolve(dir, gitdirRaw);

    // Read commondir to find the main .git directory
    const commondirPath = join(gitdir, 'commondir');
    const commondirRaw = readFileSync(commondirPath, 'utf8').trim();
    const mainGitDir = isAbsolute(commondirRaw) ? commondirRaw : resolve(gitdir, commondirRaw);

    // The main repo root is the parent of the main .git dir
    const mainRepoPath = realpathSync(resolve(mainGitDir, '..'));

    return { isWorktree: true, mainRepoPath };
  } catch {
    return { isWorktree: false };
  }
}

/**
 * Async variant of detectWorktree.
 */
export async function detectWorktreeAsync(dir: string): Promise<WorktreeInfo> {
  try {
    const gitPath = join(dir, '.git');
    const st = await stat(gitPath);

    if (st.isDirectory()) {
      return { isWorktree: false };
    }

    if (!st.isFile()) {
      return { isWorktree: false };
    }

    const content = (await readFile(gitPath, 'utf8')).trim();
    if (!content.startsWith('gitdir:')) {
      return { isWorktree: false };
    }

    const gitdirRaw = content.slice('gitdir:'.length).trim();
    const gitdir = isAbsolute(gitdirRaw) ? gitdirRaw : resolve(dir, gitdirRaw);

    const commondirPath = join(gitdir, 'commondir');
    const commondirRaw = (await readFile(commondirPath, 'utf8')).trim();
    const mainGitDir = isAbsolute(commondirRaw) ? commondirRaw : resolve(gitdir, commondirRaw);

    const mainRepoPath = await realpath(resolve(mainGitDir, '..'));

    return { isWorktree: true, mainRepoPath };
  } catch {
    return { isWorktree: false };
  }
}

/**
 * If CWD is a git worktree of one of the manifest repos, substitute the
 * worktree path for that repo's canonical path.
 *
 * Only the matching repo is overridden — others keep their canonical paths.
 */
export function applyWorktreeOverride(repos: ResolvedRepo[], cwd: string): ResolvedRepo[] {
  const info = detectWorktree(cwd);
  if (!info.isWorktree || !info.mainRepoPath) {
    return repos;
  }

  return repos.map(repo => {
    try {
      const repoRealPath = realpathSync(repo.localPath);
      if (repoRealPath === info.mainRepoPath) {
        return { ...repo, localPath: cwd, exists: true };
      }
    } catch {
      // repo path doesn't exist or can't be resolved — skip
    }
    return repo;
  });
}

/**
 * Async variant of applyWorktreeOverride.
 */
export async function applyWorktreeOverrideAsync(repos: ResolvedRepo[], cwd: string): Promise<ResolvedRepo[]> {
  const info = await detectWorktreeAsync(cwd);
  if (!info.isWorktree || !info.mainRepoPath) {
    return repos;
  }

  const result: ResolvedRepo[] = [];
  for (const repo of repos) {
    try {
      const repoRealPath = await realpath(repo.localPath);
      if (repoRealPath === info.mainRepoPath) {
        result.push({ ...repo, localPath: cwd, exists: true });
        continue;
      }
    } catch {
      // repo path doesn't exist or can't be resolved — skip
    }
    result.push(repo);
  }
  return result;
}
