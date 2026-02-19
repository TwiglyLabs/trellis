import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
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

function setupMcpJson(cwd: string): void {
  const mcpPath = join(cwd, '.mcp.json');
  const trellisConfig = {
    type: 'stdio',
    command: 'trellis',
    args: ['mcp'],
  };

  if (existsSync(mcpPath)) {
    try {
      const existing = JSON.parse(readFileSync(mcpPath, 'utf8'));
      if (!existing.mcpServers) existing.mcpServers = {};
      if (!existing.mcpServers.trellis) {
        existing.mcpServers.trellis = trellisConfig;
        writeFileSync(mcpPath, JSON.stringify(existing, null, 2) + '\n');
        console.log('Added trellis to existing .mcp.json');
      } else {
        console.log('.mcp.json already has trellis configured');
      }
    } catch {
      console.error('Warning: .mcp.json exists but is not valid JSON — skipping');
    }
  } else {
    const config = {
      mcpServers: {
        trellis: trellisConfig,
      },
    };
    writeFileSync(mcpPath, JSON.stringify(config, null, 2) + '\n');
    console.log('Created .mcp.json');
  }
}

export async function initCommand(options?: { yes?: boolean }): Promise<void> {
  const cwd = process.cwd();

  if (existsSync(join(cwd, '.trellis'))) {
    console.log('.trellis already exists');
    setupMcpJson(cwd);
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
}
