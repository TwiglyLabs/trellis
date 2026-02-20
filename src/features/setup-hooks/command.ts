import type { Command } from 'commander';
import { setupHooks } from './logic.ts';

export function register(program: Command): void {
  program
    .command('setup-hooks')
    .description('Install Claude Code hooks and git pre-commit hook')
    .addHelpText('after', '\nExamples:\n  $ trellis setup-hooks')
    .action(() => setupHooksCommand());
}

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
