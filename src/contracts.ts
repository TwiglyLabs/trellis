import type { PlanContract, ContractSection } from './types.ts';

export function parseOutputs(markdown: string): PlanContract {
  const sections: ContractSection[] = [];
  let currentHeading: string | null = null;
  let currentItems: string[] = [];

  for (const line of markdown.split('\n')) {
    if (line.startsWith('## ')) {
      if (currentHeading !== null) {
        sections.push({ heading: currentHeading, items: currentItems });
      }
      currentHeading = line.slice(3).trim();
      currentItems = [];
    } else if (line.startsWith('- ') && currentHeading !== null) {
      currentItems.push(line.slice(2).trim());
    }
  }

  if (currentHeading !== null) {
    sections.push({ heading: currentHeading, items: currentItems });
  }

  return { raw: markdown, fromPlans: [], fromCode: [], sections };
}

export function parseInputs(markdown: string): PlanContract {
  const sections: ContractSection[] = [];
  const fromPlans: string[] = [];
  const fromCode: string[] = [];

  let currentH2: string | null = null;
  let currentH3: string | null = null;
  let currentItems: string[] = [];
  let inFromPlans = false;
  let inFromCode = false;

  function flushH3() {
    if (currentH3 !== null) {
      const source = currentH3;
      sections.push({ heading: currentH3, items: currentItems, source });
      if (inFromPlans) fromPlans.push(currentH3);
      if (inFromCode) fromCode.push(currentH3);
      currentH3 = null;
      currentItems = [];
    }
  }

  for (const line of markdown.split('\n')) {
    if (line.startsWith('## ')) {
      flushH3();
      currentH2 = line.slice(3).trim();
      inFromPlans = /^from plans$/i.test(currentH2);
      inFromCode = /^from existing code$/i.test(currentH2);
    } else if (line.startsWith('### ') && (inFromPlans || inFromCode)) {
      flushH3();
      currentH3 = line.slice(4).trim();
      currentItems = [];
    } else if (line.startsWith('- ') && currentH3 !== null) {
      currentItems.push(line.slice(2).trim());
    }
  }

  flushH3();

  return { raw: markdown, fromPlans, fromCode, sections };
}
