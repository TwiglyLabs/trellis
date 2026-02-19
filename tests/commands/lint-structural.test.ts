import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFixture } from '../helpers.ts';
import { lintCommand } from '../../src/commands/lint.ts';

describe('lint structural checks', () => {
  let originalCwd: () => string;
  let logs: string[];

  beforeEach(() => {
    originalCwd = process.cwd;
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((...args: any[]) => {
      logs.push(args.join(' '));
    });
  });

  afterEach(() => {
    process.cwd = originalCwd;
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  // --- File layout checks ---

  describe('file layout', () => {
    it('errors when plan is a single .md file, not a directory', () => {
      const { root } = createFixture([]);
      // Create a single .md file in plans/ (not a directory)
      const { writeFileSync, mkdirSync } = require('fs');
      const { join } = require('path');
      mkdirSync(join(root, 'plans'), { recursive: true });
      writeFileSync(join(root, 'plans', 'orphan.md'), '---\ntitle: Orphan\nstatus: draft\n---\n\n## Problem\n\nP\n');
      process.cwd = () => root;

      lintCommand();

      const output = logs.join('\n');
      expect(output).toContain('orphan.md');
      expect(output).toContain('single file, not a plan directory');
      expect(process.exitCode).toBe(1);
    });

    it('errors when directory is missing README.md', () => {
      const { root } = createFixture([]);
      const { mkdirSync } = require('fs');
      const { join } = require('path');
      mkdirSync(join(root, 'plans', 'empty-dir'), { recursive: true });
      process.cwd = () => root;

      lintCommand();

      const output = logs.join('\n');
      expect(output).toContain('empty-dir');
      expect(output).toContain('missing README.md');
      expect(process.exitCode).toBe(1);
    });

    it('warns when plan has depends_on but no inputs.md', () => {
      const BODY = '\n## Problem\n\nP\n\n## Approach\n\nA\n';
      const IMPL = '## Steps\n\n## Testing\n\n## Done-when\n';
      const { root } = createFixture([
        { id: 'upstream', title: 'Upstream', status: 'done', body: BODY, implementationMd: IMPL,
          outputsMd: '## Types\n- T\n' },
        { id: 'consumer', title: 'Consumer', status: 'not_started', depends_on: ['upstream'],
          body: BODY, implementationMd: IMPL },
      ]);
      process.cwd = () => root;

      lintCommand();

      const output = logs.join('\n');
      expect(output).toContain('consumer');
      expect(output).toContain('depends_on but no inputs.md');
    });

    it('does not warn about missing inputs.md when no depends_on', () => {
      const { root } = createFixture([
        { id: 'standalone', title: 'Standalone', status: 'not_started',
          body: '\n## Problem\n\nP\n\n## Approach\n\nA\n',
          implementationMd: '## Steps\n\n## Testing\n\n## Done-when\n' },
      ]);
      process.cwd = () => root;

      lintCommand();

      const output = logs.join('\n');
      expect(output).not.toContain('inputs.md');
    });

    it('warns when plan has dependents but no outputs.md', () => {
      const BODY = '\n## Problem\n\nP\n\n## Approach\n\nA\n';
      const IMPL = '## Steps\n\n## Testing\n\n## Done-when\n';
      const { root } = createFixture([
        { id: 'core', title: 'Core', status: 'not_started', body: BODY, implementationMd: IMPL },
        { id: 'consumer', title: 'Consumer', status: 'not_started', depends_on: ['core'],
          body: BODY, implementationMd: IMPL,
          inputsMd: '## From plans\n\n### core\n- types\n' },
      ]);
      process.cwd = () => root;

      lintCommand();

      const output = logs.join('\n');
      expect(output).toContain('core');
      expect(output).toContain('has dependents but no outputs.md');
    });

    it('does not warn about missing outputs.md when no dependents', () => {
      const { root } = createFixture([
        { id: 'leaf', title: 'Leaf', status: 'not_started',
          body: '\n## Problem\n\nP\n\n## Approach\n\nA\n',
          implementationMd: '## Steps\n\n## Testing\n\n## Done-when\n' },
      ]);
      process.cwd = () => root;

      lintCommand();

      const output = logs.join('\n');
      expect(output).not.toContain('outputs.md');
    });
  });

  // --- Section checks ---

  describe('section checks', () => {
    it('errors when README.md missing ## Problem for draft plan', () => {
      const { root } = createFixture([
        { id: 'no-problem', title: 'No Problem', status: 'draft', body: '\n## Approach\n\nSome approach\n' },
      ]);
      process.cwd = () => root;

      lintCommand();

      const output = logs.join('\n');
      expect(output).toContain('no-problem');
      expect(output).toMatch(/missing.*Problem/i);
      expect(process.exitCode).toBe(1);
    });

    it('errors when plan at not_started missing ## Approach', () => {
      const { root } = createFixture([
        {
          id: 'no-approach', title: 'No Approach', status: 'not_started',
          body: '\n## Problem\n\nSome problem\n',
          implementationMd: '## Steps\n\n## Testing\n\n## Done-when\n',
        },
      ]);
      process.cwd = () => root;

      lintCommand();

      const output = logs.join('\n');
      expect(output).toContain('no-approach');
      expect(output).toMatch(/missing.*Approach/i);
      expect(process.exitCode).toBe(1);
    });

    it('errors when plan at not_started missing implementation.md', () => {
      const { root } = createFixture([
        {
          id: 'no-impl', title: 'No Impl', status: 'not_started',
          body: '\n## Problem\n\nSome problem\n\n## Approach\n\nSome approach\n',
        },
      ]);
      process.cwd = () => root;

      lintCommand();

      const output = logs.join('\n');
      expect(output).toContain('no-impl');
      expect(output).toMatch(/missing.*implementation\.md/i);
      expect(process.exitCode).toBe(1);
    });

    it('errors when implementation.md missing required sections', () => {
      const { root } = createFixture([
        {
          id: 'bad-impl', title: 'Bad Impl', status: 'not_started',
          body: '\n## Problem\n\nSome problem\n\n## Approach\n\nSome approach\n',
          implementationMd: '## Steps\n\nSome steps\n',
        },
      ]);
      process.cwd = () => root;

      lintCommand();

      const output = logs.join('\n');
      expect(output).toContain('bad-impl');
      expect(output).toMatch(/missing.*Testing/i);
      expect(output).toMatch(/missing.*Done-when/i);
      expect(process.exitCode).toBe(1);
    });

    it('warns when inputs.md exists but missing From plans / From existing code', () => {
      const { root } = createFixture([
        { id: 'upstream', title: 'Upstream', status: 'done' },
        {
          id: 'bad-inputs', title: 'Bad Inputs', status: 'not_started',
          depends_on: ['upstream'],
          body: '\n## Problem\n\nSome problem\n\n## Approach\n\nSome approach\n',
          implementationMd: '## Steps\n\n## Testing\n\n## Done-when\n',
          inputsMd: '## Random section\n\nSome content\n',
        },
      ]);
      process.cwd = () => root;

      lintCommand();

      const output = logs.join('\n');
      expect(output).toContain('bad-inputs');
      expect(output).toMatch(/inputs\.md.*From plans.*From existing code/i);
    });

    it('does not warn about inputs.md sections when it has From plans', () => {
      const { root } = createFixture([
        { id: 'upstream', title: 'Upstream', status: 'done' },
        {
          id: 'good-inputs', title: 'Good Inputs', status: 'not_started',
          depends_on: ['upstream'],
          body: '\n## Problem\n\nSome problem\n\n## Approach\n\nSome approach\n',
          implementationMd: '## Steps\n\n## Testing\n\n## Done-when\n',
          inputsMd: '## From plans\n\n### upstream\n- types\n',
        },
      ]);
      process.cwd = () => root;

      lintCommand();

      const output = logs.join('\n');
      expect(output).not.toMatch(/inputs\.md.*From plans.*From existing code/i);
    });
  });

  // --- Status gate compliance ---

  describe('status gate compliance', () => {
    it('errors when done plan with dependents has no outputs.md', () => {
      const { root } = createFixture([
        {
          id: 'done-core', title: 'Done Core', status: 'done',
          body: '\n## Problem\n\nP\n\n## Approach\n\nA\n',
          implementationMd: '## Steps\n\n## Testing\n\n## Done-when\n',
        },
        { id: 'consumer', title: 'Consumer', status: 'not_started', depends_on: ['done-core'] },
      ]);
      process.cwd = () => root;

      lintCommand();

      const output = logs.join('\n');
      expect(output).toContain('done-core');
      expect(output).toMatch(/outputs\.md.*required.*dependents/i);
      expect(process.exitCode).toBe(1);
    });

    it('does not error for done plan without dependents missing outputs.md', () => {
      const { root } = createFixture([
        {
          id: 'done-leaf', title: 'Done Leaf', status: 'done',
          body: '\n## Problem\n\nP\n\n## Approach\n\nA\n',
          implementationMd: '## Steps\n\n## Testing\n\n## Done-when\n',
        },
      ]);
      process.cwd = () => root;

      lintCommand();

      const output = logs.join('\n');
      // Should not have gate-related errors for outputs.md
      expect(output).not.toMatch(/outputs\.md.*required.*dependents/i);
    });

    it('passes well-formed plan at not_started', () => {
      const { root } = createFixture([
        {
          id: 'good-plan', title: 'Good Plan', status: 'not_started',
          body: '\n## Problem\n\nSome problem\n\n## Approach\n\nSome approach\n',
          implementationMd: '## Steps\n\n## Testing\n\n## Done-when\n',
        },
      ]);
      process.cwd = () => root;

      lintCommand();

      const output = logs.join('\n');
      expect(output).toContain('1 plans OK');
      expect(process.exitCode).toBeUndefined();
    });

    it('catches retroactive gate violations from manual edits', () => {
      // A plan that claims to be in_progress but is missing implementation.md
      const { root } = createFixture([
        {
          id: 'violated', title: 'Violated', status: 'in_progress',
          body: '\n## Problem\n\nP\n\n## Approach\n\nA\n',
          // No implementationMd — violates in_progress gate
        },
      ]);
      process.cwd = () => root;

      lintCommand();

      const output = logs.join('\n');
      expect(output).toContain('violated');
      expect(output).toMatch(/implementation\.md/i);
      expect(process.exitCode).toBe(1);
    });
  });

  // --- --fix flag ---

  describe('--fix flag', () => {
    it('creates missing implementation.md with required headings', () => {
      const { root } = createFixture([
        {
          id: 'needs-impl', title: 'Needs Impl', status: 'not_started',
          body: '\n## Problem\n\nP\n\n## Approach\n\nA\n',
        },
      ]);
      process.cwd = () => root;

      lintCommand({ fix: true });

      const output = logs.join('\n');
      expect(output).toContain('needs-impl: created implementation.md');

      // Verify the file was created
      const { readFileSync } = require('fs');
      const { join } = require('path');
      const content = readFileSync(join(root, 'plans/needs-impl/implementation.md'), 'utf8');
      expect(content).toContain('## Steps');
      expect(content).toContain('## Testing');
      expect(content).toContain('## Done-when');
    });

    it('adds missing ## Problem heading to README.md', () => {
      const { root } = createFixture([
        { id: 'no-problem', title: 'No Problem', status: 'draft', body: '\nSome content\n' },
      ]);
      process.cwd = () => root;

      lintCommand({ fix: true });

      const output = logs.join('\n');
      expect(output).toContain('no-problem: added ## Problem to README.md');

      const { readFileSync } = require('fs');
      const { join } = require('path');
      const content = readFileSync(join(root, 'plans/no-problem/README.md'), 'utf8');
      expect(content).toContain('## Problem');
    });

    it('adds missing ## Approach heading to README.md', () => {
      const { root } = createFixture([
        {
          id: 'no-approach', title: 'No Approach', status: 'not_started',
          body: '\n## Problem\n\nSome problem\n',
          implementationMd: '## Steps\n\n## Testing\n\n## Done-when\n',
        },
      ]);
      process.cwd = () => root;

      lintCommand({ fix: true });

      const output = logs.join('\n');
      expect(output).toContain('no-approach: added ## Approach to README.md');

      const { readFileSync } = require('fs');
      const { join } = require('path');
      const content = readFileSync(join(root, 'plans/no-approach/README.md'), 'utf8');
      expect(content).toContain('## Approach');
    });

    it('does not overwrite existing content', () => {
      const { root } = createFixture([
        {
          id: 'partial', title: 'Partial', status: 'not_started',
          body: '\n## Problem\n\nExisting problem description\n\n## Approach\n\nExisting approach\n',
          implementationMd: '## Steps\n\nExisting steps\n',
        },
      ]);
      process.cwd = () => root;

      lintCommand({ fix: true });

      const { readFileSync } = require('fs');
      const { join } = require('path');
      const implContent = readFileSync(join(root, 'plans/partial/implementation.md'), 'utf8');
      expect(implContent).toContain('Existing steps');
      expect(implContent).toContain('## Testing');
      expect(implContent).toContain('## Done-when');
    });

    it('creates missing outputs.md for done plan with dependents', () => {
      const { root } = createFixture([
        {
          id: 'done-core', title: 'Done Core', status: 'done',
          body: '\n## Problem\n\nP\n\n## Approach\n\nA\n',
          implementationMd: '## Steps\n\n## Testing\n\n## Done-when\n',
          // no outputsMd — gate violation for done with dependents
        },
        {
          id: 'consumer', title: 'Consumer', status: 'not_started',
          depends_on: ['done-core'],
          body: '\n## Problem\n\nP\n\n## Approach\n\nA\n',
          implementationMd: '## Steps\n\n## Testing\n\n## Done-when\n',
          inputsMd: '## From plans\n\n### done-core\n- types\n',
        },
      ]);
      process.cwd = () => root;

      lintCommand({ fix: true });

      const output = logs.join('\n');
      expect(output).toContain('done-core: created outputs.md');

      const { readFileSync } = require('fs');
      const { join } = require('path');
      const content = readFileSync(join(root, 'plans/done-core/outputs.md'), 'utf8');
      expect(content).toContain('## Outputs');
    });

    it('reports what was fixed', () => {
      const { root } = createFixture([
        {
          id: 'fixable', title: 'Fixable', status: 'not_started',
          body: '\n## Problem\n\nP\n',
        },
      ]);
      process.cwd = () => root;

      lintCommand({ fix: true });

      const output = logs.join('\n');
      // Should report the Fixed section
      expect(output).toContain('Fixed');
      expect(output).toContain('fixable:');
    });
  });

  // --- JSON output ---

  describe('JSON output', () => {
    it('includes structural errors/warnings in JSON', () => {
      const { root } = createFixture([
        {
          id: 'bad', title: 'Bad', status: 'not_started',
          body: '\n## Problem\n\nP\n',
          // Missing ## Approach, missing implementation.md
        },
      ]);
      process.cwd = () => root;

      lintCommand({ json: true });

      const parsed = JSON.parse(logs.join(''));
      expect(parsed.structural).toBeDefined();
      expect(parsed.structural.errors.length).toBeGreaterThan(0);
      // Structural errors should have plan_id, type, message
      expect(parsed.structural.errors[0]).toHaveProperty('plan_id');
      expect(parsed.structural.errors[0]).toHaveProperty('message');
    });

    it('does not include contract_coverage in JSON', () => {
      const { root } = createFixture([
        { id: 'a', title: 'A', status: 'done',
          body: '\n## Problem\n\nP\n\n## Approach\n\nA\n',
          implementationMd: '## Steps\n\n## Testing\n\n## Done-when\n' },
      ]);
      process.cwd = () => root;

      lintCommand({ json: true });

      const parsed = JSON.parse(logs.join(''));
      expect(parsed).not.toHaveProperty('contract_coverage');
    });

    it('includes structural warnings in JSON', () => {
      const { root } = createFixture([
        {
          id: 'core', title: 'Core', status: 'not_started',
          body: '\n## Problem\n\nP\n\n## Approach\n\nA\n',
          implementationMd: '## Steps\n\n## Testing\n\n## Done-when\n',
        },
        {
          id: 'consumer', title: 'Consumer', status: 'not_started',
          depends_on: ['core'],
          body: '\n## Problem\n\nP\n\n## Approach\n\nA\n',
          implementationMd: '## Steps\n\n## Testing\n\n## Done-when\n',
        },
      ]);
      process.cwd = () => root;

      lintCommand({ json: true });

      const parsed = JSON.parse(logs.join(''));
      expect(parsed.structural.warnings.length).toBeGreaterThan(0);
    });

    it('includes fixed items in JSON when --fix and --json combined', () => {
      const { root } = createFixture([
        {
          id: 'fixable', title: 'Fixable', status: 'not_started',
          body: '\n## Problem\n\nP\n',
          // Missing ## Approach and implementation.md
        },
      ]);
      process.cwd = () => root;

      lintCommand({ json: true, fix: true });

      const parsed = JSON.parse(logs.join(''));
      expect(parsed.fixed).toBeDefined();
      expect(Array.isArray(parsed.fixed)).toBe(true);
      expect(parsed.fixed.length).toBeGreaterThan(0);
      expect(parsed.fixed.some((f: string) => f.includes('fixable'))).toBe(true);
    });
  });

  // --- Old contract checks removed ---

  describe('old contract checks removed', () => {
    it('does not produce orphaned_input_ref errors', () => {
      const { root } = createFixture([
        {
          id: 'upstream', title: 'Upstream', status: 'not_started',
          body: '\n## Problem\n\nP\n\n## Approach\n\nA\n',
          implementationMd: '## Steps\n\n## Testing\n\n## Done-when\n',
          outputsMd: '## Types\n- Person\n',
        },
        {
          id: 'consumer', title: 'Consumer', status: 'not_started',
          body: '\n## Problem\n\nP\n\n## Approach\n\nA\n',
          implementationMd: '## Steps\n\n## Testing\n\n## Done-when\n',
          inputsMd: '## From plans\n\n### upstream\n- Person type\n',
          // NOTE: upstream is NOT in depends_on — old check would error
        },
      ]);
      process.cwd = () => root;

      lintCommand({ json: true });

      const parsed = JSON.parse(logs.join(''));
      const orphanedRef = parsed.errors.find((e: any) => e.type === 'orphaned_input_ref');
      expect(orphanedRef).toBeUndefined();
    });

    it('does not produce missing_upstream_outputs warnings', () => {
      const { root } = createFixture([
        {
          id: 'no-outputs', title: 'No Outputs', status: 'not_started',
          body: '\n## Problem\n\nP\n\n## Approach\n\nA\n',
          implementationMd: '## Steps\n\n## Testing\n\n## Done-when\n',
        },
        {
          id: 'consumer', title: 'Consumer', status: 'not_started',
          depends_on: ['no-outputs'],
          body: '\n## Problem\n\nP\n\n## Approach\n\nA\n',
          implementationMd: '## Steps\n\n## Testing\n\n## Done-when\n',
          inputsMd: '## From plans\n\n### no-outputs\n- Something\n',
        },
      ]);
      process.cwd = () => root;

      lintCommand({ json: true });

      const parsed = JSON.parse(logs.join(''));
      const upstreamWarning = parsed.warnings.find((w: any) => w.type === 'missing_upstream_outputs');
      expect(upstreamWarning).toBeUndefined();
    });
  });
});
