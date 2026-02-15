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
  directory?: boolean;
  outputsMd?: string;
  inputsMd?: string;
}

export function createFixture(plans: FixturePlan[]): { root: string; plansDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'trellis-test-'));
  const plansDir = join(root, 'plans');
  mkdirSync(plansDir, { recursive: true });

  writeFileSync(join(root, '.trellis'), `project: test-project\nplans_dir: plans\n`);

  for (const plan of plans) {
    const parts = plan.id.split('/');
    const fileName = parts.pop()!;
    const dir = join(plansDir, ...parts);
    mkdirSync(dir, { recursive: true });

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

    if (plan.directory) {
      // Create directory-based plan with README.md
      const planDir = join(dir, fileName);
      mkdirSync(planDir, { recursive: true });
      writeFileSync(join(planDir, 'README.md'), content);

      // Create inputs.md if provided
      if (plan.inputsMd) {
        writeFileSync(join(planDir, 'inputs.md'), plan.inputsMd);
      }

      // Create outputs.md if provided
      if (plan.outputsMd) {
        writeFileSync(join(planDir, 'outputs.md'), plan.outputsMd);
      }
    } else {
      // Create single-file plan
      writeFileSync(join(dir, `${fileName}.md`), content);
    }
  }

  return { root, plansDir };
}
