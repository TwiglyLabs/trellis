import type { GraphData } from '../../core/graph.ts';
import type { PlanFrontmatter } from '../../core/types.ts';
import { updatePlanFile } from '../../core/index.ts';
import type { SetResult } from '../../api.ts';

const EDITABLE_FIELDS = ['title', 'description', 'depends_on', 'tags', 'repo', 'assignee', 'sessions', 'deviation'] as const;
const LIST_FIELDS = ['depends_on', 'tags'] as const;

export interface ComputeSetOptions {
  planId: string;
  field: string;
  value: string | string[];
  mode: 'replace' | 'add' | 'remove';
  graph: GraphData;
}

export interface ComputeSetCallbacks {
  refresh: () => void;
}

export function computeSet(options: ComputeSetOptions, callbacks: ComputeSetCallbacks): SetResult {
  const { planId, field, value, mode, graph } = options;

  const plan = graph.plans.get(planId);
  if (!plan) throw new Error(`Plan "${planId}" not found.`);

  if (field === 'status') {
    throw new Error('Cannot set "status" — use update() for status transitions.');
  }

  if (!(EDITABLE_FIELDS as readonly string[]).includes(field)) {
    throw new Error(`Unknown field "${field}". Editable fields: ${EDITABLE_FIELDS.join(', ')}`);
  }

  const isList = (LIST_FIELDS as readonly string[]).includes(field);
  const fm = plan.frontmatter as Record<string, any>;
  const previousValue = fm[field];

  if (mode !== 'replace' && !isList) {
    throw new Error(`Field "${field}" is not a list — cannot use ${mode} mode.`);
  }

  let newValue: string | string[];

  if (mode === 'add') {
    const current = Array.isArray(fm[field]) ? [...fm[field]] : [];
    const toAdd = Array.isArray(value) ? value : [value];
    if (field === 'depends_on') {
      for (const dep of toAdd) {
        if (!graph.plans.has(dep)) {
          throw new Error(`Dependency "${dep}" not found.`);
        }
      }
    }
    newValue = [...current, ...toAdd];
  } else if (mode === 'remove') {
    const current = Array.isArray(fm[field]) ? [...fm[field]] : [];
    const toRemove = Array.isArray(value) ? value : [value];
    newValue = current.filter((item: string) => !toRemove.includes(item));
  } else {
    // replace mode
    if (field === 'depends_on') {
      const deps = Array.isArray(value) ? value : [value];
      for (const dep of deps) {
        if (!graph.plans.has(dep)) {
          throw new Error(`Dependency "${dep}" not found.`);
        }
      }
      newValue = deps;
    } else if (isList) {
      newValue = Array.isArray(value) ? value : [value];
    } else if (field === 'sessions') {
      const raw = typeof value === 'string' ? value : value[0];
      const num = Number(raw);
      if (!Number.isInteger(num) || num < 1) {
        throw new Error(`"sessions" must be a positive integer, got "${raw}".`);
      }
      newValue = num as any;
    } else if (field === 'deviation') {
      const raw = typeof value === 'string' ? value : value[0];
      if (raw !== 'none' && raw !== 'minor' && raw !== 'major') {
        throw new Error(`"deviation" must be "none", "minor", or "major", got "${raw}".`);
      }
      newValue = raw;
    } else {
      newValue = typeof value === 'string' ? value : value[0];
    }
  }

  updatePlanFile(plan.filePath, { [field]: newValue } as Partial<PlanFrontmatter>);
  callbacks.refresh();

  return { id: planId, field, value: newValue, previousValue };
}
