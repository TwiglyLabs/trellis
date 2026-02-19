---
title: Headless Graph Server
status: archived
tags: [cli, graph]
depends_on: []
description: Add --no-open flag to trellis graph so external tools can manage the viewer lifecycle
---

# Headless Graph Server

## Problem

`trellis graph` always opens the system browser via `execFile('open', [url])`. External tools (Emacs xwidget-webkit, IDE webviews, scripts) that want to embed the graph viewer need the server running without the side effect of a browser tab opening.

## Solution

Add a `--no-open` flag to the `graph` command that starts the HTTP server but skips the browser launch. The server output (`Serving DAG viewer at http://localhost:<port>`) remains unchanged so callers can parse the URL.

## Scope

This is a single-flag addition to `src/commands/graph.ts` — no new files, no behavior changes to existing flags.

## Changes

### `src/cli.ts`

Register the new option:

```typescript
.option('--no-open', 'Start server without opening browser')
```

### `src/commands/graph.ts`

Accept `noOpen` in options and gate the `execFile` call:

```typescript
export function graphCommand(options: { port?: number; json?: boolean; noOpen?: boolean }): void {
  // ... existing code ...

  server.listen(port, () => {
    // ... existing port/url logging ...

    if (!options.noOpen) {
      const platform = process.platform;
      const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
      execFile(cmd, [url], (err) => {
        if (err) console.log(`Open ${url} in your browser`);
      });
    }
  });
}
```

## Testing

```bash
# Starts server, does NOT open browser
trellis graph --no-open --port 9847

# Existing behavior unchanged
trellis graph
trellis graph --port 8080
trellis graph --json
```
