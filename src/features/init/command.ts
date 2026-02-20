import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync } from 'fs';
import { join, basename } from 'path';
import type { Command } from 'commander';
import { setupHooks } from '../setup-hooks/logic.ts';
import { prompt, setupMcpJson } from './logic.ts';

const TRELLIS_GITIGNORE = 'cache/\n';

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
  const trellisPath = join(cwd, '.trellis');

  if (existsSync(trellisPath)) {
    const stat = statSync(trellisPath);

    if (stat.isDirectory()) {
      // Already migrated to directory format
      console.log('.trellis/ already exists');
      setupMcpJson(cwd);
      const hookResult = setupHooks(cwd);
      for (const msg of hookResult.messages) {
        console.log(msg);
      }
      return;
    }

    // File format — offer migration
    if (!options?.yes) {
      const answer = await prompt('Migrate .trellis file to directory format?', 'yes');
      if (answer.toLowerCase() !== 'yes' && answer.toLowerCase() !== 'y') {
        console.log('Skipping migration.');
        setupMcpJson(cwd);
        const hookResult = setupHooks(cwd);
        for (const msg of hookResult.messages) {
          console.log(msg);
        }
        return;
      }
    }

    // Migrate: read file content, create directory, write config + .gitignore
    const content = readFileSync(trellisPath, 'utf8');
    const { unlinkSync } = await import('fs');
    unlinkSync(trellisPath);
    mkdirSync(trellisPath, { recursive: true });
    writeFileSync(join(trellisPath, 'config'), content);
    writeFileSync(join(trellisPath, '.gitignore'), TRELLIS_GITIGNORE);
    console.log('Migrated .trellis file to .trellis/ directory format.');

    setupMcpJson(cwd);
    const hookResult = setupHooks(cwd);
    for (const msg of hookResult.messages) {
      console.log(msg);
    }
    return;
  }

  // Fresh init — create directory format
  let projectName: string;
  let plansDir: string;

  if (options?.yes) {
    projectName = basename(cwd);
    plansDir = 'plans';
  } else {
    projectName = await prompt('Project name', basename(cwd));
    plansDir = await prompt('Plans directory', 'plans');
  }

  mkdirSync(trellisPath, { recursive: true });
  writeFileSync(
    join(trellisPath, 'config'),
    `project: ${projectName}\nplans_dir: ${plansDir}\n`,
  );
  writeFileSync(join(trellisPath, '.gitignore'), TRELLIS_GITIGNORE);

  mkdirSync(join(cwd, plansDir), { recursive: true });
  console.log(`Created .trellis/ and ${plansDir}/`);

  setupMcpJson(cwd);

  // Install hooks
  const hookResult = setupHooks(cwd);
  for (const msg of hookResult.messages) {
    console.log(msg);
  }
}
