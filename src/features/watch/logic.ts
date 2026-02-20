import { join } from 'path';
import { EventEmitter } from 'events';
import { watch as fsWatch, type FSWatcher } from 'fs';
import { scanPlans, buildGraph } from '../../core/index.ts';
import type { TrellisConfig } from '../../core/types.ts';

export interface WatchableInstance extends EventEmitter {
  readonly projectDir: string;
  readonly config: TrellisConfig;
  refresh(): void;
  graph(): any;
}

export interface WatchState {
  watcher: FSWatcher | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
}

export function watchPlans(instance: WatchableInstance, state: WatchState, debounceMs = 100): void {
  if (state.watcher) return;

  const plansDir = join(instance.projectDir, instance.config.plans_dir);
  state.watcher = fsWatch(plansDir, { recursive: true }, () => {
    if (state.debounceTimer) clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(() => {
      instance.refresh();
      instance.emit('change', instance.graph());
    }, debounceMs);
  });

  state.watcher.on('error', (err) => {
    instance.emit('error', err);
  });
}

export function unwatchPlans(state: WatchState): void {
  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer);
    state.debounceTimer = null;
  }
  if (state.watcher) {
    state.watcher.close();
    state.watcher = null;
  }
}

export function isWatching(state: WatchState): boolean {
  return state.watcher !== null;
}
