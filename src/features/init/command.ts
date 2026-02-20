import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, basename } from 'path';
import type { Command } from 'commander';
import { setupHooks } from '../setup-hooks/logic.ts';
import { prompt, setupMcpJson } from './logic.ts';

export function register(program: Command): void {
  program
    .command('init')
    .description('Scaffold .trellis config and plans/ directory')
    .option('-y, --yes', 'Accept defaults without prompting')
    .addHelpText('after', '\nExamples:\n  $ trellis init\n  $ trellis init --yes')
    .action((options) => initCommand(options));
}

export async function initCommand(options?: { yes?: boolean }): Promise<void> {
  const cwd = process.cwd();

  if (existsSync(join(cwd, '.trellis'))) {
    console.log('.trellis already exists');
    setupMcpJson(cwd);
    const hookResult = setupHooks(cwd);
    for (const msg of hookResult.messages) {
      console.log(msg);
    }
    return;
  }

  let projectName: string;
  let plansDir: string;

  if (options?.yes) {
    projectName = basename(cwd);
    plansDir = 'plans';
  } else {
    projectName = await prompt('Project name', basename(cwd));
    plansDir = await prompt('Plans directory', 'plans');
  }

  writeFileSync(
    join(cwd, '.trellis'),
    `project: ${projectName}\nplans_dir: ${plansDir}\n`,
  );

  mkdirSync(join(cwd, plansDir), { recursive: true });
  console.log(`Created .trellis and ${plansDir}/`);

  setupMcpJson(cwd);

  // Install hooks
  const hookResult = setupHooks(cwd);
  for (const msg of hookResult.messages) {
    console.log(msg);
  }
}
