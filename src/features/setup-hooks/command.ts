import { setupHooks } from './logic.ts';

export function setupHooksCommand(): void {
  const cwd = process.cwd();
  const result = setupHooks(cwd);

  for (const msg of result.messages) {
    console.log(msg);
  }

  if (!result.claudeHooks && !result.preCommit) {
    console.log('Hooks already installed — nothing to do.');
  }
}
