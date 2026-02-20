import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';

export function prompt(question: string, defaultVal: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(`${question} [${defaultVal}]: `, answer => {
      rl.close();
      resolve(answer.trim() || defaultVal);
    });
  });
}

export function setupMcpJson(cwd: string): void {
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
