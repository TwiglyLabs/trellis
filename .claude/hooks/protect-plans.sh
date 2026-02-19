#!/bin/bash
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
elif [ -n "${CLAUDE_PROJECT_DIR:-}" ] && [ -f "$CLAUDE_PROJECT_DIR/.trellis" ]; then
  PROJECT_ROOT="$CLAUDE_PROJECT_DIR"
else
  # No .trellis found — not a trellis project, allow the operation
  exit 0
fi

# Read plans_dir from .trellis config (default: plans)
PLANS_DIR="plans"
if [ -f "$PROJECT_ROOT/.trellis" ]; then
  PARSED=$(grep '^plans_dir:' "$PROJECT_ROOT/.trellis" | sed 's/^plans_dir:\s*//' | sed 's/\s*#.*$//' | tr -d '[:space:]')
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
