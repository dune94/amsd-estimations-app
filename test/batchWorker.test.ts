import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/index.js';
import { openReviewStore, type EstimateVersion, type ReviewStore } from '../src/db/reviewStore.js';
import { createBatchWorker } from '../src/service/batchWorker.js';
import { ValidationError } from '../src/service/reviewService.js';
import type { FormulaEstimator } from '../src/service/formulaEstimator.js';

let store: ReviewStore;
let seen: { key: string; notes?: string }[];
let active: number;
let maxActive: number;
let failKeys: Set<string>;

function estimator(): FormulaEstimator {
  return {
    async estimate(key, o) {
      active++; maxActive = Math.max(maxActive, active);
      seen.push({ key, notes: o?.notes });
      await new Promise(r => setTimeout(r, 5));
      active--;
      if (failKeys.has(key)) throw new Error('engine exploded');
      return store.addVersion({ issueKey: key, batchId: o?.batchId ?? null, mode: 'formula', noCodeFacts: false, storyHash: 'h', estimate: {}, notes: o?.notes ?? null });
    },
  };
}
const worker = (max = 5) => createBatchWorker({ store, estimator: estimator(), maxBatchSize: max });

beforeEach(() => {
  store = openReviewStore(openDb(':memory:').db);
  seen = []; active = 0; maxActive = 0; failKeys = new Set();
});

describe('batch worker', () => {
  it('runs one story at a time, in order', async () => {
    const w = worker();
    w.createBatch(['K-1', 'K-2', 'K-3'], 'keys');
    await w.idle();
    expect(seen.map(s => s.key)).toEqual(['K-1', 'K-2', 'K-3']);
    expect(maxActive).toBe(1);
  });

  it('moves a finished story to IN_REVIEW and marks the item DONE', async () => {
    const w = worker();
    const b = w.createBatch(['K-1'], 'keys');
    await w.idle();
    expect(store.getVersion('K-1')?.status).toBe('IN_REVIEW');
    expect(store.batchItems(b)[0].state).toBe('DONE');
  });

  it('does not stop the batch when one story fails', async () => {
    failKeys.add('K-2');
    const w = worker();
    const b = w.createBatch(['K-1', 'K-2', 'K-3'], 'keys');
    await w.idle();
    expect(store.batchItems(b).map(i => i.state)).toEqual(['DONE', 'FAILED', 'DONE']);
    expect(store.batchItems(b)[1].notes).toContain('engine exploded');
  });

  it('on restart skips finished items and re-queues a running one exactly once', async () => {
    const b = store.createBatch(['K-1', 'K-2', 'K-3'], 'keys');
    store.setItemState(b, 'K-1', 'DONE'); store.setItemState(b, 'K-2', 'RUNNING');
    const w = worker();
    w.start();
    await w.idle();
    expect(seen.map(s => s.key)).toEqual(['K-2', 'K-3']);
    w.start(); await w.idle();
    expect(seen).toHaveLength(2);
  });

  it('re-runs a sent-back story with its notes', async () => {
    const w = worker();
    const b = w.createBatch(['K-1'], 'keys');
    await w.idle();
    w.enqueue(b, ['K-1'], 'check the rule');
    await w.idle();
    expect(seen[1]).toEqual({ key: 'K-1', notes: 'check the rule' });
    expect(store.getVersion('K-1')?.version).toBe(2);
  });

  it('rejects an empty batch, duplicate keys and an oversize batch', () => {
    const w = worker(2);
    expect(() => w.createBatch([], 'keys')).toThrow(ValidationError);
    expect(() => w.createBatch(['K-1', 'K-1'], 'keys')).toThrow(ValidationError);
    expect(() => w.createBatch(['K-1', 'K-2', 'K-3'], 'keys')).toThrow(ValidationError);
  });

  it('reports progress', async () => {
    failKeys.add('K-2');
    const w = worker();
    const b = w.createBatch(['K-1', 'K-2', 'K-3'], 'keys');
    expect(w.progress(b)).toMatchObject({ total: 3 });
    await w.idle();
    expect(w.progress(b)).toEqual({ total: 3, queued: 0, done: 2, failed: 1, running: null });
    expect(w.progress('b_unknown').total).toBe(0);
  });

  it('refuses keys that are not issue keys', () => {
    const w = worker();
    for (const bad of ['../x', 'K-1;rm', 'k-1', 'K-', '-1', 'K 1', 'K-1/../..', '']) {
      expect(() => w.createBatch([bad], 'keys'), bad).toThrow(ValidationError);
    }
    expect(() => w.createBatch(['AB_C-12'], 'keys')).not.toThrow();
  });
});
