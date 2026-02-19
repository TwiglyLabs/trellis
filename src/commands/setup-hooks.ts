import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, chmodSync } from 'fs';
import { join, dirname } from 'path';

const PROTECT_PLANS_HOOK = `#!/bin/bash
# Claude Code PreToolUse hook: blocks Edit and Write on plan files.
# Agents must use trellis MCP tools instead of direct file editing.

set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Find the project root by looking for .trellis
find_project_root() {
  local dir="$1"
  while [ "$dir" != "/" ]; do
    if [ -f "$dir/.trellis" ]; then
      echo "$dir"
      return 0
    fi
    dir=$(dirname "$dir")
  done
  return 1
}

# Try to find project root from the file path, then from cwd
PROJECT_ROOT=""
if PROJECT_ROOT=$(find_project_root "$(dirname "$FILE_PATH")") 2>/dev/null; then
  :
elif [ -n "\${CLAUDE_PROJECT_DIR:-}" ] && [ -f "$CLAUDE_PROJECT_DIR/.trellis" ]; then
  PROJECT_ROOT="$CLAUDE_PROJECT_DIR"
else
  # No .trellis found — not a trellis project, allow the operation
  exit 0
fi

# Read plans_dir from .trellis config (default: plans)
PLANS_DIR="plans"
if [ -f "$PROJECT_ROOT/.trellis" ]; then
  PARSED=$(grep '^plans_dir:' "$PROJECT_ROOT/.trellis" | sed 's/^plans_dir:\\s*//' | sed 's/\\s*#.*$//' | tr -d '[:space:]')
  if [ -n "$PARSED" ]; then
    PLANS_DIR="$PARSED"
  fi
fi

# Resolve to absolute path
PLANS_ABS="$PROJECT_ROOT/$PLANS_DIR"

# Normalize both paths (resolve symlinks, remove trailing slashes)
PLANS_ABS=$(cd "$PLANS_ABS" 2>/dev/null && pwd -P) || exit 0
FILE_DIR=$(cd "$(dirname "$FILE_PATH")" 2>/dev/null && pwd -P) || exit 0

# Check if the file is inside the plans directory
case "$FILE_DIR/" in
  "$PLANS_ABS/"*)
    TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // "Edit/Write"')
    echo "Plan files are managed by trellis. Use the trellis MCP tools (trellis_create, trellis_write_section, trellis_read_section, trellis_set, trellis_update) instead of $TOOL_NAME on plan files directly." >&2
    exit 2
    ;;
esac

exit 0
`;

const PRE_COMMIT_HOOK = `#!/bin/bash
# Git pre-commit hook: runs trellis lint on staged plan files.

set -euo pipefail

if [ ! -f ".trellis" ]; then
  exit 0
fi

PLANS_DIR="plans"
PARSED=$(grep '^plans_dir:' ".trellis" 2>/dev/null | sed 's/^plans_dir:\\s*//' | sed 's/\\s*#.*$//' | tr -d '[:space:]')
if [ -n "$PARSED" ]; then
  PLANS_DIR="$PARSED"
fi

STAGED_PLANS=$(git diff --cached --name-only --diff-filter=ACMR | grep "^\${PLANS_DIR}/" || true)

if [ -z "$STAGED_PLANS" ]; then
  exit 0
fi

if ! command -v trellis &>/dev/null; then
  echo "Warning: trellis not found in PATH — skipping plan lint" >&2
  exit 0
fi

OUTPUT=$(trellis lint 2>&1) || {
  echo "trellis lint found issues in plan files:" >&2
  echo "$OUTPUT" >&2
  echo "" >&2
  echo "Fix the issues above, or use 'git commit --no-verify' to bypass." >&2
  exit 1
}

exit 0
`;

export interface SetupHooksResult {
  claudeHooks: boolean;
  preCommit: boolean;
  messages: string[];
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

export function setupHooks(cwd: string): SetupHooksResult {
  const messages: string[] = [];
  let claudeHooks = false;
  let preCommit = false;

  // 1. Install Claude Code hook script
  claudeHooks = installClaudeHooks(cwd, messages);

  // 2. Install git pre-commit hook
  preCommit = installPreCommitHook(cwd, messages);

  return { claudeHooks, preCommit, messages };
}

function installClaudeHooks(cwd: string, messages: string[]): boolean {
  const claudeDir = join(cwd, '.claude');
  const hooksDir = join(claudeDir, 'hooks');
  const settingsPath = join(claudeDir, 'settings.json');
  const hookScript = join(hooksDir, 'protect-plans.sh');

  let changed = false;

  // Write the hook script
  mkdirSync(hooksDir, { recursive: true });
  writeFileSync(hookScript, PROTECT_PLANS_HOOK);
  chmodSync(hookScript, 0o755);

  // Read or create settings.json
  let settings: Record<string, any> = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    } catch {
      messages.push('Warning: .claude/settings.json exists but is not valid JSON — creating new');
      settings = {};
    }
  }

  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks.PreToolUse) settings.hooks.PreToolUse = [];

  // Check if hook already registered
  const hookEntries: any[] = settings.hooks.PreToolUse;
  const alreadyInstalled = hookEntries.some((entry: any) =>
    entry.matcher === 'Edit|Write' &&
    entry.hooks?.some((h: any) => h.command?.includes('protect-plans.sh'))
  );

  if (!alreadyInstalled) {
    hookEntries.push({
      matcher: 'Edit|Write',
      hooks: [
        {
          type: 'command',
          command: '.claude/hooks/protect-plans.sh',
        },
      ],
    });
    changed = true;
    messages.push('Installed Claude Code hooks in .claude/settings.json');
  } else {
    messages.push('Claude Code hooks already configured');
  }

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  return changed;
}

function installPreCommitHook(cwd: string, messages: string[]): boolean {
  const gitHooksDir = join(cwd, '.git', 'hooks');

  if (!existsSync(join(cwd, '.git'))) {
    messages.push('Not a git repository — skipping pre-commit hook');
    return false;
  }

  mkdirSync(gitHooksDir, { recursive: true });
  const preCommitPath = join(gitHooksDir, 'pre-commit');

  if (existsSync(preCommitPath)) {
    const existing = readFileSync(preCommitPath, 'utf8');
    if (existing.includes('trellis lint')) {
      messages.push('Pre-commit hook already includes trellis lint');
      return false;
    }

    // Append to existing hook
    const appendBlock = '\n\n# --- trellis plan lint ---\n' + PRE_COMMIT_HOOK.replace('#!/bin/bash\n', '').replace('# Git pre-commit hook: runs trellis lint on staged plan files.\n\n', '');
    writeFileSync(preCommitPath, existing + appendBlock);
    chmodSync(preCommitPath, 0o755);
    messages.push('Appended trellis lint to existing pre-commit hook');
    return true;
  }

  writeFileSync(preCommitPath, PRE_COMMIT_HOOK);
  chmodSync(preCommitPath, 0o755);
  messages.push('Installed git pre-commit hook');
  return true;
}
