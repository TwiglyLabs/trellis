import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

export interface FixturePlan {
  id: string;
  title: string;
  status: string;
  depends_on?: string[];
  tags?: string[];
  repo?: string;
  description?: string;
  assignee?: string;
  started_at?: string;
  completed_at?: string;
  body?: string;
  directory?: boolean; // ignored — all plans are directory-based now
  outputsMd?: string;
  inputsMd?: string;
  implementationMd?: string;
}

export function createFixture(plans: FixturePlan[]): { root: string; plansDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'trellis-test-'));
  const plansDir = join(root, 'plans');
  mkdirSync(plansDir, { recursive: true });

  writeFileSync(join(root, '.trellis'), `project: test-project\nplans_dir: plans\n`);

  for (const plan of plans) {
    // All plans are directory-based: plans/<id>/README.md
    const planDir = join(plansDir, plan.id);
    mkdirSync(planDir, { recursive: true });

    const fmLines = [`title: ${plan.title}`, `status: ${plan.status}`];

    if (plan.depends_on?.length) {
      fmLines.push('depends_on:');
      for (const dep of plan.depends_on) {
        fmLines.push(`  - ${dep}`);
      }
    }

    if (plan.tags?.length) {
      fmLines.push(`tags: [${plan.tags.join(', ')}]`);
    }

    if (plan.repo) {
      fmLines.push(`repo: ${plan.repo}`);
    }

    if (plan.description) {
      fmLines.push(`description: ${plan.description}`);
    }

    if (plan.assignee) {
      fmLines.push(`assignee: ${plan.assignee}`);
    }

    if (plan.started_at) {
      fmLines.push(`started_at: '${plan.started_at}'`);
    }

    if (plan.completed_at) {
      fmLines.push(`completed_at: '${plan.completed_at}'`);
    }

    const content = `---\n${fmLines.join('\n')}\n---\n${plan.body || ''}\n`;
    writeFileSync(join(planDir, 'README.md'), content);

    if (plan.inputsMd) {
      writeFileSync(join(planDir, 'inputs.md'), plan.inputsMd);
    }

    if (plan.outputsMd) {
      writeFileSync(join(planDir, 'outputs.md'), plan.outputsMd);
    }

    if (plan.implementationMd) {
      writeFileSync(join(planDir, 'implementation.md'), plan.implementationMd);
    }
  }

  return { root, plansDir };
}
