import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, basename } from 'path';
import { createInterface } from 'readline';

function prompt(question: string, defaultVal: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(`${question} [${defaultVal}]: `, answer => {
      rl.close();
      resolve(answer.trim() || defaultVal);
    });
  });
}

export async function initCommand(options?: { yes?: boolean }): Promise<void> {
  const cwd = process.cwd();

  if (existsSync(join(cwd, '.trellis'))) {
    console.log('.trellis already exists');
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
}
