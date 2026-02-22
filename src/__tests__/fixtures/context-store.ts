import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { RepoSpec } from '../../core/types.ts';

export interface TestFixtureRepo {
  root: string;
  plansDir: string;
  alias: string;
}

export interface TestFixture {
  repos: TestFixtureRepo[];
  repoSpecs: RepoSpec[];
  cacheDir: string;
}

/**
 * Create a test fixture with multiple repos, each containing plan files.
 * Reusable by all epic:perf-cache plan tests.
 */
export function createTestFixture(repoCount: number, plansPerRepo: number): TestFixture {
  const repos: TestFixtureRepo[] = [];
  const repoSpecs: RepoSpec[] = [];
  const cacheDir = mkdtempSync(join(tmpdir(), 'trellis-cache-'));

  for (let r = 0; r < repoCount; r++) {
    const alias = `repo-${r}`;
    const root = mkdtempSync(join(tmpdir(), `trellis-repo-${r}-`));
    const plansDir = join(root, 'plans');
    mkdirSync(plansDir, { recursive: true });

    // Create .trellis config
    mkdirSync(join(root, '.trellis'), { recursive: true });
    writeFileSync(
      join(root, '.trellis', 'config'),
      `project: ${alias}\nplans_dir: plans\n`,
    );

    // Create plans
    for (let p = 0; p < plansPerRepo; p++) {
      const planId = `plan-${p}`;
      const planDir = join(plansDir, planId);
      mkdirSync(planDir, { recursive: true });

      const depends = p > 0 ? `\ndepends_on:\n  - plan-${p - 1}` : '';
      const status = p === 0 ? 'done' : 'not_started';

      writeFileSync(
        join(planDir, 'README.md'),
        `---\ntitle: Plan ${p} in ${alias}\nstatus: ${status}${depends}\n---\n\n## Problem\nTest plan ${p}\n\n## Approach\nTest approach ${p}\n`,
      );

      writeFileSync(
        join(planDir, 'implementation.md'),
        `## Steps\nStep 1\n\n## Testing\nTest case 1\n\n## Done-when\n- [ ] Done\n`,
      );
    }

    repos.push({ root, plansDir, alias });
    repoSpecs.push({ path: root, alias });
  }

  return { repos, repoSpecs, cacheDir };
}
