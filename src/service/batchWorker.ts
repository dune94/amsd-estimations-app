// ── Batch worker ───────────────────────────────────────────────────────────
// Runs queued stories strictly one at a time (memory, disk and the engine's own limits). Every state change is written to the
// store before and after a story runs, so a restart resumes: finished items are never re-run, a running item is re-queued once.

import type { ReviewStore } from '../db/reviewStore.js';
import type { FormulaEstimator } from './formulaEstimator.js';
import { ValidationError } from './reviewService.js';

const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d+$/;

export interface BatchProgress { total: number; queued: number; done: number; failed: number; running: string | null }

export interface BatchWorker {
  createBatch(keys: string[], source: string): string;
  enqueue(batchId: string, keys: string[], notes?: string): void;
  start(): void;
  idle(): Promise<void>;
  progress(batchId: string): BatchProgress;
}

export function createBatchWorker(deps: { store: ReviewStore; estimator: FormulaEstimator; maxBatchSize: number }): BatchWorker {
  const { store } = deps;
  let loop: Promise<void> | null = null;

  async function drain(): Promise<void> {
    for (;;) {
      const next = store.nextQueued();
      if (!next) return;
      store.setItemState(next.batchId, next.issueKey, 'RUNNING');
      try {
        const v = await deps.estimator.estimate(next.issueKey, { batchId: next.batchId, notes: next.notes ?? undefined });
        store.setStatus(v.issueKey, v.version, 'IN_REVIEW', 'ready');
        store.setItemState(next.batchId, next.issueKey, 'DONE');
      } catch (err) {
        store.setItemState(next.batchId, next.issueKey, 'FAILED', err instanceof Error ? err.message : String(err));
      }
    }
  }

  function kick(): void {
    if (loop) return;
    loop = drain().finally(() => {
      loop = null;
      if (store.nextQueued()) kick(); // something was queued while the loop was ending
    });
  }

  return {
    createBatch(keys, source) {
      const bad = keys.find(k => !ISSUE_KEY.test(k));
      if (bad !== undefined) throw new ValidationError(`"${bad}" is not an issue key (expected something like ABC-123)`);
      if (keys.length === 0) throw new ValidationError('a batch needs at least one story');
      if (new Set(keys).size !== keys.length) throw new ValidationError('a batch cannot contain the same story twice');
      if (keys.length > deps.maxBatchSize) throw new ValidationError(`a batch can have at most ${deps.maxBatchSize} stories`);
      const id = store.createBatch(keys, source);
      kick();
      return id;
    },
    enqueue(batchId, keys, notes) {
      for (const k of keys) store.setItemState(batchId, k, 'QUEUED', notes);
      kick();
    },
    start() {
      store.resetRunning();
      kick();
    },
    async idle() {
      while (loop) await loop;
    },
    progress(batchId) {
      const items = store.batchItems(batchId);
      const count = (s: string) => items.filter(i => i.state === s).length;
      return { total: items.length, queued: count('QUEUED'), done: count('DONE'), failed: count('FAILED'), running: items.find(i => i.state === 'RUNNING')?.issueKey ?? null };
    },
  };
}
