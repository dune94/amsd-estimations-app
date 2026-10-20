import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/index.js';
import { openReviewStore, type NewVersion } from '../src/db/reviewStore.js';

function store() {
  const est = openDb(':memory:');
  return { est, rs: openReviewStore(est.db) };
}

function nv(issueKey: string, over: Partial<NewVersion> = {}): NewVersion {
  return { issueKey, batchId: null, mode: 'formula', noCodeFacts: false, storyHash: 'h1', estimate: { sp: 5 }, notes: null, ...over };
}

describe('review store', () => {
  it('increments the version per issue', () => {
    const { rs } = store();
    expect(rs.addVersion(nv('K-1')).version).toBe(1);
    expect(rs.addVersion(nv('K-1')).version).toBe(2);
    expect(rs.addVersion(nv('K-1')).version).toBe(3);
    expect(rs.addVersion(nv('K-2')).version).toBe(1);
    expect(rs.listVersions('K-1').map(v => v.version)).toEqual([1, 2, 3]);
  });

  it('returns the latest version by default and a specific one on request', () => {
    const { rs } = store();
    rs.addVersion(nv('K-1', { estimate: { sp: 3 } }));
    rs.addVersion(nv('K-1', { estimate: { sp: 8 } }));
    expect(rs.getVersion('K-1')?.estimate).toEqual({ sp: 8 });
    expect(rs.getVersion('K-1', 1)?.estimate).toEqual({ sp: 3 });
    expect(rs.getVersion('K-9')).toBeNull();
    expect(rs.addVersion(nv('K-3')).status).toBe('DRAFT');
  });

  it('appends an event for every status change, in order', () => {
    const { rs } = store();
    rs.addVersion(nv('K-1'));
    rs.setStatus('K-1', 1, 'IN_REVIEW', 'ready');
    rs.setStatus('K-1', 1, 'SENT_BACK', 'send_back', 'check the second rule');
    expect(rs.getVersion('K-1', 1)?.status).toBe('SENT_BACK');
    const ev = rs.events('K-1');
    expect(ev.map(e => e.event)).toEqual(['ready', 'send_back']);
    expect(ev[1].notes).toBe('check the second rule');
  });

  it('lists one row per key for a batch (the latest version)', () => {
    const { rs } = store();
    const batch = rs.createBatch(['K-1', 'K-2'], 'keys');
    rs.addVersion(nv('K-1', { batchId: batch }));
    rs.addVersion(nv('K-1', { batchId: batch }));
    rs.addVersion(nv('K-2', { batchId: batch }));
    const rows = rs.listBatchLatest(batch);
    expect(rows.map(r => `${r.issueKey}:${r.version}`).sort()).toEqual(['K-1:2', 'K-2:1']);
  });

  it('tracks batch items and their state', () => {
    const { rs } = store();
    const batch = rs.createBatch(['K-1', 'K-2'], 'jql');
    expect(rs.batchItems(batch).map(i => [i.issueKey, i.state])).toEqual([['K-1', 'QUEUED'], ['K-2', 'QUEUED']]);
    rs.setItemState(batch, 'K-1', 'DONE');
    expect(rs.batchItems(batch).find(i => i.issueKey === 'K-1')?.state).toBe('DONE');
  });

  it('can be opened twice on the same database without losing data', () => {
    const est = openDb(':memory:');
    const first = openReviewStore(est.db);
    first.addVersion(nv('K-1'));
    const second = openReviewStore(est.db);
    expect(second.getVersion('K-1')?.version).toBe(1);
  });

  it('returns the oldest queued item first, and null when nothing is queued', () => {
    const { rs } = store();
    const b1 = rs.createBatch(['K-1', 'K-2'], 'keys');
    const b2 = rs.createBatch(['K-3'], 'keys');
    expect(rs.nextQueued()).toEqual({ batchId: b1, issueKey: 'K-1', notes: null });
    rs.setItemState(b1, 'K-1', 'DONE');
    expect(rs.nextQueued()?.issueKey).toBe('K-2');
    rs.setItemState(b1, 'K-2', 'RUNNING');
    expect(rs.nextQueued()).toEqual({ batchId: b2, issueKey: 'K-3', notes: null });
    rs.setItemState(b2, 'K-3', 'FAILED');
    expect(rs.nextQueued()).toBeNull();
  });

  it('puts running items back in the queue and says how many', () => {
    const { rs } = store();
    const b = rs.createBatch(['K-1', 'K-2', 'K-3'], 'keys');
    rs.setItemState(b, 'K-1', 'RUNNING'); rs.setItemState(b, 'K-2', 'RUNNING'); rs.setItemState(b, 'K-3', 'DONE');
    expect(rs.resetRunning()).toBe(2);
    expect(rs.batchItems(b).map(i => i.state)).toEqual(['QUEUED', 'QUEUED', 'DONE']);
  });

  it('leaves the legacy estimates table untouched', () => {
    const { est } = store();
    est.saveEstimate({ issueKey: 'K-1', generatedAt: '2026-10-20T00:00:00Z' } as never);
    expect(est.getEstimate('K-1')?.issueKey).toBe('K-1');
  });
});
