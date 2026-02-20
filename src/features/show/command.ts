import chalk from 'chalk';
import { relative } from 'path';
import { Trellis } from '../../api.ts';
import { padRight, computeColumnWidth } from '../../core/utils.ts';

interface ShowOptions {
  json?: boolean;
  contracts?: boolean;
  file?: string;
  section?: string;
  raw?: boolean;
}

export function showCommand(planId: string, options?: ShowOptions): void {
  const t = new Trellis(process.cwd());

  // --file / --section mode: granular content read
  if (options?.file || options?.section) {
    // Map --contracts to --file for backward compat
    const file = options.file;
    const section = options.section;

    if (section && !file) {
      const msg = '--section requires --file';
      if (options?.json) {
        console.error(JSON.stringify({ error: msg }));
      } else {
        console.error(msg);
      }
      process.exitCode = 1;
      return;
    }

    try {
      const result = t.readSection(planId, file, section);
      if (options?.json) {
        console.log(JSON.stringify({ id: planId, file, section, content: result.content }, null, 2));
      } else {
        console.log(result.content);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (options?.json) {
        console.error(JSON.stringify({ error: message }));
      } else {
        console.error(message);
      }
      process.exitCode = 1;
    }
    return;
  }

  // --raw mode: dump all plan content
  if (options?.raw) {
    try {
      const result = t.readSection(planId);
      console.log(result.content);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (options?.json) {
        console.error(JSON.stringify({ error: message }));
      } else {
        console.error(message);
      }
      process.exitCode = 1;
    }
    return;
  }

  // Standard show mode
  const result = t.show(planId);

  if (!result) {
    if (options?.json) {
      console.error(JSON.stringify({ error: `Plan "${planId}" not found.` }));
    } else {
      console.error(`Plan "${planId}" not found.`);
    }
    process.exitCode = 1;
    return;
  }

  // Backward compat: --contracts maps to including inputs/outputs in JSON
  const showContracts = options?.contracts;

  if (options?.json) {
    const output: Record<string, any> = {
      id: result.id,
      filePath: result.filePath,
      title: result.title,
      status: result.status,
      blocked: result.blocked,
      ready: result.ready,
      tags: result.tags,
      repo: result.repo,
      assignee: result.assignee,
      description: result.description,
      started_at: result.startedAt,
      completed_at: result.completedAt,
      depends_on: result.dependsOn.map((d) => ({
        id: d.id,
        status: d.status,
        satisfied: d.satisfied,
      })),
      blocks: result.blocks,
      critical_path: result.criticalPath,
    };
    if (showContracts) {
      output.inputs = result.inputs;
      output.outputs = result.outputs;
    }
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  let statusDisplay = result.status;
  if (result.blocked) statusDisplay += ' (blocked)';
  else if (result.ready) statusDisplay += ' (ready)';

  console.log();
  console.log(`  ${chalk.bold(result.title)}`);
  console.log(`  Path:       ${relative(process.cwd(), result.filePath)}`);
  console.log(`  Status:     ${statusDisplay}`);
  if (result.tags.length) console.log(`  Tags:       ${result.tags.join(', ')}`);
  if (result.repo) console.log(`  Repo:       ${result.repo}`);
  if (result.assignee) console.log(`  Assignee:   ${result.assignee}`);
  if (result.description) console.log(`  Desc:       ${result.description}`);

  if (result.dependsOn.length > 0) {
    const depWidth = computeColumnWidth(result.dependsOn.map((d) => d.id));
    console.log(`\n  Depends on:`);
    for (const dep of result.dependsOn) {
      if (dep.status === 'not_found') {
        console.log(`    ${chalk.red('✗')} ${dep.id}  ${chalk.red('(not found)')}`);
      } else {
        const isDone = dep.satisfied;
        const icon = isDone ? chalk.green('✓') : chalk.red('✗');
        const blocking = isDone ? '' : chalk.red('    ← blocking');
        console.log(`    ${icon} ${padRight(dep.id, depWidth)} ${dep.status}${blocking}`);
      }
    }
  }

  const directBlocks = result.blocks.filter((id) => {
    const show = t.show(id);
    return show?.dependsOn.some((d) => d.id === planId);
  });
  const transitiveOnly = result.blocks.filter((id) => !directBlocks.includes(id));

  if (result.blocks.length > 0) {
    console.log(`\n  Blocks:`);
    for (const id of directBlocks) {
      console.log(`    ${id}`);
    }
    for (const id of transitiveOnly) {
      console.log(`    ${id} ${chalk.dim('(transitive)')}`);
    }
  }

  if (result.criticalPath.length > 1) {
    console.log(`\n  Critical path (depth ${result.criticalPath.length}):`);
    console.log(`    ${result.criticalPath.join(' → ')}`);
  }

  if (showContracts) {
    console.log(`\n  Inputs:`);
    if (result.inputs && result.inputs.length > 0) {
      for (const section of result.inputs) {
        console.log(`    ${section.heading}`);
        for (const item of section.items) {
          console.log(`      - ${item}`);
        }
      }
    } else {
      console.log(`    (none)`);
    }

    console.log(`\n  Outputs:`);
    if (result.outputs && result.outputs.length > 0) {
      for (const section of result.outputs) {
        console.log(`    ${section.heading}`);
        for (const item of section.items) {
          console.log(`      - ${item}`);
        }
      }
    } else {
      console.log(`    (none)`);
    }
  }

  console.log();
}
