import { describe, it, expect } from 'vitest';
import { computeCompleteness, DEFAULT_THRESHOLDS, PLACEHOLDER_PATTERNS } from './completeness.ts';
import type { Plan, TrellisConfig } from './types.ts';

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'test-plan',
    filePath: '/tmp/plans/test-plan/README.md',
    frontmatter: { title: 'Test', status: 'draft' },
    body: '',
    lineCount: 10,
    ...overrides,
  };
}

const defaultConfig: TrellisConfig = { project: 'test', plans_dir: 'plans' };

describe('computeCompleteness', () => {
  describe('scoring basics', () => {
    it('scores missing section as 0', () => {
      const plan = makePlan({ body: '' });
      const result = computeCompleteness(plan, defaultConfig);
      expect(result.sections['Problem'].score).toBe(0);
      expect(result.sections['Problem'].reason).toBe('missing');
      expect(result.sections['Problem'].wordCount).toBe(0);
    });

    it('scores a complete section as 100', () => {
      // Default Problem high threshold is 50 words
      const words = Array(60).fill('word').join(' ');
      const plan = makePlan({ body: `\n## Problem\n${words}\n` });
      const result = computeCompleteness(plan, defaultConfig);
      expect(result.sections['Problem'].score).toBe(100);
      expect(result.sections['Problem'].reason).toBe('complete');
      expect(result.sections['Problem'].wordCount).toBe(60);
    });

    it('scores a thin section as 50', () => {
      // Default Problem: low=20, high=50 → 25 words is thin
      const words = Array(25).fill('word').join(' ');
      const plan = makePlan({ body: `\n## Problem\n${words}\n` });
      const result = computeCompleteness(plan, defaultConfig);
      expect(result.sections['Problem'].score).toBe(50);
      expect(result.sections['Problem'].reason).toBe('thin');
    });

    it('scores a stub section (below low threshold) as 0', () => {
      // Default Problem low=20 → 5 words is stub
      const plan = makePlan({ body: `\n## Problem\nJust five words here now\n` });
      const result = computeCompleteness(plan, defaultConfig);
      expect(result.sections['Problem'].score).toBe(0);
      expect(result.sections['Problem'].reason).toBe('placeholder');
    });
  });

  describe('placeholder detection', () => {
    it('scores TBD as 0 regardless of word count', () => {
      const plan = makePlan({ body: `\n## Problem\nTBD\n` });
      const result = computeCompleteness(plan, defaultConfig);
      expect(result.sections['Problem'].score).toBe(0);
      expect(result.sections['Problem'].reason).toBe('placeholder');
    });

    it('scores TODO as 0', () => {
      const plan = makePlan({ body: `\n## Problem\nTODO: figure this out later\n` });
      const result = computeCompleteness(plan, defaultConfig);
      expect(result.sections['Problem'].score).toBe(0);
      expect(result.sections['Problem'].reason).toBe('placeholder');
    });

    it('scores FIXME as 0', () => {
      const plan = makePlan({ body: `\n## Problem\nFIXME needs real content\n` });
      const result = computeCompleteness(plan, defaultConfig);
      expect(result.sections['Problem'].score).toBe(0);
      expect(result.sections['Problem'].reason).toBe('placeholder');
    });

    it('scores "placeholder" as 0', () => {
      const plan = makePlan({ body: `\n## Problem\nThis is a placeholder for the problem statement\n` });
      const result = computeCompleteness(plan, defaultConfig);
      expect(result.sections['Problem'].score).toBe(0);
      expect(result.sections['Problem'].reason).toBe('placeholder');
    });

    it('scores "coming soon" as 0', () => {
      const plan = makePlan({ body: `\n## Problem\nComing soon\n` });
      const result = computeCompleteness(plan, defaultConfig);
      expect(result.sections['Problem'].score).toBe(0);
      expect(result.sections['Problem'].reason).toBe('placeholder');
    });

    it('scores whitespace-only body as 0', () => {
      const plan = makePlan({ body: `\n## Problem\n   \n  \n` });
      const result = computeCompleteness(plan, defaultConfig);
      expect(result.sections['Problem'].score).toBe(0);
      expect(result.sections['Problem'].reason).toBe('placeholder');
    });
  });

  describe('status-aware section expectations', () => {
    it('draft only expects Problem section', () => {
      const plan = makePlan({
        frontmatter: { title: 'Test', status: 'draft' },
        body: `\n## Problem\n${Array(60).fill('word').join(' ')}\n`,
      });
      const result = computeCompleteness(plan, defaultConfig);
      expect(Object.keys(result.sections)).toEqual(['Problem']);
      expect(result.aggregate).toBe(100);
    });

    it('not_started expects Problem, Approach, Steps, Testing, Done-when', () => {
      const words60 = Array(60).fill('word').join(' ');
      const words80 = Array(80).fill('word').join(' ');
      const words40 = Array(40).fill('word').join(' ');
      const words25 = Array(25).fill('word').join(' ');
      const plan = makePlan({
        frontmatter: { title: 'Test', status: 'not_started' },
        body: `\n## Problem\n${words60}\n## Approach\n${words60}\n`,
        implementationContent: `## Steps\n${words80}\n## Testing\n${words40}\n## Done-when\n${words25}\n`,
      } as any);
      const result = computeCompleteness(plan, defaultConfig);
      expect(Object.keys(result.sections).sort()).toEqual(
        ['Approach', 'Done-when', 'Problem', 'Steps', 'Testing']
      );
    });

    it('in_progress expects same sections as not_started', () => {
      const plan = makePlan({
        frontmatter: { title: 'Test', status: 'in_progress' },
        body: `\n## Problem\nTBD\n## Approach\nTBD\n`,
      });
      const result = computeCompleteness(plan, defaultConfig);
      expect(Object.keys(result.sections).sort()).toEqual(
        ['Approach', 'Done-when', 'Problem', 'Steps', 'Testing']
      );
    });
  });

  describe('aggregate scoring', () => {
    it('computes mean of applicable section scores', () => {
      // draft: only Problem. score=100 → aggregate=100
      const words = Array(60).fill('word').join(' ');
      const plan = makePlan({ body: `\n## Problem\n${words}\n` });
      const result = computeCompleteness(plan, defaultConfig);
      expect(result.aggregate).toBe(100);
    });

    it('averages multiple scores correctly', () => {
      // not_started: 5 sections. Problem=100, Approach=50, Steps/Testing/Done-when=0 (missing)
      const words60 = Array(60).fill('word').join(' ');
      const words30 = Array(30).fill('word').join(' ');
      const plan = makePlan({
        frontmatter: { title: 'Test', status: 'not_started' },
        body: `\n## Problem\n${words60}\n## Approach\n${words30}\n`,
      });
      const result = computeCompleteness(plan, defaultConfig);
      // 100 + 50 + 0 + 0 + 0 = 150 / 5 = 30
      expect(result.aggregate).toBe(30);
    });

    it('returns 0 aggregate when all sections are missing', () => {
      const plan = makePlan({ body: '' });
      const result = computeCompleteness(plan, defaultConfig);
      expect(result.aggregate).toBe(0);
    });
  });

  describe('config threshold overrides', () => {
    it('uses custom thresholds from config', () => {
      const config: TrellisConfig = {
        ...defaultConfig,
        completenessThresholds: {
          completeness_problem_low: 5,
          completeness_problem_high: 10,
        },
      };
      // 8 words: above low=5, below high=10 → thin
      const plan = makePlan({ body: `\n## Problem\none two three four five six seven eight\n` });
      const result = computeCompleteness(plan, config);
      expect(result.sections['Problem'].score).toBe(50);
      expect(result.sections['Problem'].reason).toBe('thin');
    });

    it('uses default thresholds for unconfigured sections', () => {
      const config: TrellisConfig = {
        ...defaultConfig,
        completenessThresholds: {
          completeness_problem_low: 5,
          completeness_problem_high: 10,
        },
      };
      const words60 = Array(60).fill('word').join(' ');
      const plan = makePlan({
        frontmatter: { title: 'Test', status: 'not_started' },
        body: `\n## Problem\n${words60}\n## Approach\n${words60}\n`,
      });
      const result = computeCompleteness(plan, config);
      // Problem uses custom config (60 >= 10 → complete)
      expect(result.sections['Problem'].score).toBe(100);
      // Approach uses defaults (60 >= 60 → complete)
      expect(result.sections['Approach'].score).toBe(100);
    });
  });

  describe('implementation.md sections', () => {
    it('reads Steps, Testing, Done-when from implementationContent', () => {
      const words80 = Array(80).fill('word').join(' ');
      const words40 = Array(40).fill('word').join(' ');
      const words25 = Array(25).fill('word').join(' ');
      const plan = makePlan({
        frontmatter: { title: 'Test', status: 'not_started' },
        body: `\n## Problem\n${Array(60).fill('word').join(' ')}\n## Approach\n${Array(70).fill('word').join(' ')}\n`,
      });
      // Attach implementation content
      plan.implementationContent = `## Steps\n${words80}\n## Testing\n${words40}\n## Done-when\n${words25}\n`;
      const result = computeCompleteness(plan, defaultConfig);
      expect(result.sections['Steps'].score).toBe(100);
      expect(result.sections['Testing'].score).toBe(100);
      expect(result.sections['Done-when'].score).toBe(100);
    });

    it('scores missing implementation sections as 0', () => {
      const plan = makePlan({
        frontmatter: { title: 'Test', status: 'not_started' },
        body: `\n## Problem\n${Array(60).fill('word').join(' ')}\n## Approach\n${Array(70).fill('word').join(' ')}\n`,
      });
      const result = computeCompleteness(plan, defaultConfig);
      expect(result.sections['Steps'].score).toBe(0);
      expect(result.sections['Steps'].reason).toBe('missing');
      expect(result.sections['Testing'].score).toBe(0);
      expect(result.sections['Done-when'].score).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('handles archived plans with no expected sections', () => {
      const plan = makePlan({
        frontmatter: { title: 'Test', status: 'archived' },
        body: '',
      });
      const result = computeCompleteness(plan, defaultConfig);
      expect(Object.keys(result.sections)).toEqual([]);
      expect(result.aggregate).toBe(0);
    });

    it('handles done plans (same sections as not_started)', () => {
      const plan = makePlan({
        frontmatter: { title: 'Test', status: 'done' },
        body: `\n## Problem\nTBD\n## Approach\nTBD\n`,
      });
      const result = computeCompleteness(plan, defaultConfig);
      expect(Object.keys(result.sections).sort()).toEqual(
        ['Approach', 'Done-when', 'Problem', 'Steps', 'Testing']
      );
    });

    it('strips frontmatter before section extraction', () => {
      // body from parseFrontmatter already has frontmatter stripped, but test defensively
      const plan = makePlan({ body: `\n## Problem\n${Array(60).fill('word').join(' ')}\n` });
      const result = computeCompleteness(plan, defaultConfig);
      expect(result.sections['Problem'].score).toBe(100);
    });
  });

  describe('exports', () => {
    it('exports DEFAULT_THRESHOLDS', () => {
      expect(DEFAULT_THRESHOLDS).toBeDefined();
      expect(DEFAULT_THRESHOLDS['Problem']).toEqual({ low: 20, high: 50 });
    });

    it('exports PLACEHOLDER_PATTERNS', () => {
      expect(PLACEHOLDER_PATTERNS).toBeDefined();
      expect(PLACEHOLDER_PATTERNS.length).toBeGreaterThan(0);
    });
  });
});

describe('scanner integration', () => {
  it('plans from createContext have completeness attached', async () => {
    const { createContext } = await import('./context.ts');
    const { createFixture } = await import('../__tests__/helpers.ts');

    const words60 = Array(60).fill('word').join(' ');
    const { root } = createFixture([
      {
        id: 'complete-plan',
        title: 'Complete',
        status: 'not_started',
        body: `\n## Problem\n${words60}\n## Approach\n${words60}\n`,
        implementationMd: `## Steps\n${Array(80).fill('word').join(' ')}\n## Testing\n${Array(40).fill('word').join(' ')}\n## Done-when\n${Array(25).fill('word').join(' ')}\n`,
      },
      {
        id: 'stub-plan',
        title: 'Stub',
        status: 'draft',
        body: '\n## Problem\nTBD\n',
      },
    ]);

    const ctx = createContext(root);
    const complete = ctx.plans.find(p => p.id === 'complete-plan')!;
    const stub = ctx.plans.find(p => p.id === 'stub-plan')!;

    expect(complete.completeness).toBeDefined();
    expect(complete.completeness!.aggregate).toBe(100);

    expect(stub.completeness).toBeDefined();
    expect(stub.completeness!.sections['Problem'].score).toBe(0);
    expect(stub.completeness!.sections['Problem'].reason).toBe('placeholder');
    expect(stub.completeness!.aggregate).toBe(0);
  });

  it('empty plans directory produces no errors', async () => {
    const { createContext } = await import('./context.ts');
    const { createFixture } = await import('../__tests__/helpers.ts');

    const { root } = createFixture([]);
    const ctx = createContext(root);
    expect(ctx.plans).toHaveLength(0);
  });
});
