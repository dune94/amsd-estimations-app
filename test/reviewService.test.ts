import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/index.js';
import { openReviewStore, type NewVersion, type ReviewStore } from '../src/db/reviewStore.js';
import { ConflictError, createReviewService, ValidationError, type ReviewService } from '../src/service/reviewService.js';

type Call = { batchId: string; keys: string[]; notes?: string };

let store: ReviewStore;
let calls: Call[];
let svc: ReviewService;

const est = (level: 'High' | 'Medium' | 'Low', noCodeFacts = false) => ({ sp: 5, confidence: { level, reasons: [] }, noCodeFacts });
const add = (key: string, over: Partial<NewVersion> = {}) =>
  store.addVersion({ issueKey: key, batchId: null, mode: 'formula', noCodeFacts: false, storyHash: 'h', estimate: est('High'), notes: null, ...over });

beforeEach(() => {
  store = openReviewStore(openDb(':memory:').db);
  calls = [];
  svc = createReviewService({
    store, maxNotesChars: 50,
    enqueue: (batchId, keys, notes) => { calls.push({ batchId, keys, notes }); },
    legacyEstimate: async key => store.addVersion({ issueKey: key, batchId: null, mode: 'legacy', noCodeFacts: false, storyHash: null, estimate: { sp: 8 }, notes: null }),
  });
});

describe('accept', () => {
  it('accepts a draft', () => {
    add('K-1');
    svc.accept('K-1');
    expect(store.getVersion('K-1')?.status).toBe('ACCEPTED');
    expect(store.events('K-1').map(e => e.event)).toEqual(['accept']);
  });

  it('conflicts on a second accept and changes nothing', () => {
    add('K-1');
    svc.accept('K-1');
    expect(() => svc.accept('K-1')).toThrow(ConflictError);
    expect(store.events('K-1')).toHaveLength(1);
  });

  it('conflicts when there is no estimate yet', () => {
    expect(() => svc.accept('K-9')).toThrow(ConflictError);
  });

  it('accepts all High-confidence stories of a batch and skips the rest', () => {
    const b = store.createBatch(['K-1', 'K-2', 'K-3', 'K-4'], 'keys');
    add('K-1', { batchId: b }); add('K-2', { batchId: b, estimate: est('Medium') });
    add('K-3', { batchId: b, estimate: est('Low') }); add('K-4', { batchId: b, estimate: est('High', true), noCodeFacts: true });
    expect(svc.acceptAllHigh(b)).toEqual(['K-1']);
    expect(['K-1', 'K-2', 'K-3', 'K-4'].map(k => store.getVersion(k)?.status)).toEqual(['ACCEPTED', 'DRAFT', 'DRAFT', 'DRAFT']);
  });
});

describe('send back', () => {
  it('records the notes and queues a re-run in the same batch', () => {
    const b = store.createBatch(['K-1'], 'keys');
    add('K-1', { batchId: b });
    svc.sendBack('K-1', 'check the second rule');
    expect(store.getVersion('K-1')?.status).toBe('SENT_BACK');
    expect(store.events('K-1')[0]).toMatchObject({ event: 'send_back', notes: 'check the second rule' });
    expect(calls).toEqual([{ batchId: b, keys: ['K-1'], notes: 'check the second rule' }]);
  });

  it('opens a new batch when the story had none', () => {
    add('K-1');
    svc.sendBack('K-1', 'again');
    expect(calls).toHaveLength(1);
    expect(store.batchItems(calls[0].batchId).map(i => i.issueKey)).toEqual(['K-1']);
  });

  it('carries earlier notes into the next re-run', () => {
    add('K-1');
    svc.sendBack('K-1', 'first');
    add('K-1', { notes: 'first' });
    svc.sendBack('K-1', 'second');
    expect(calls[1].notes).toContain('first');
    expect(calls[1].notes).toContain('second');
  });

  it('does not compound earlier notes: three send-backs give A, A+B, A+B+C', () => {
    add('K-1');
    svc.sendBack('K-1', 'A');
    add('K-1', { notes: calls[0].notes });
    svc.sendBack('K-1', 'B');
    add('K-1', { notes: calls[1].notes });
    svc.sendBack('K-1', 'C');
    expect(calls.map(c => c.notes)).toEqual(['A', 'A\n\nB', 'A\n\nB\n\nC']);
  });

  it('keeps the newest notes when the total is over the limit', () => {
    add('K-1');
    svc.sendBack('K-1', 'a'.repeat(30));
    add('K-1', { notes: calls[0].notes });
    svc.sendBack('K-1', 'b'.repeat(30));
    const sent = calls[1].notes!;
    expect(sent.length).toBeLessThanOrEqual(50);
    expect(sent.endsWith('b'.repeat(30))).toBe(true);
  });

  it('conflicts on an accepted story', () => {
    add('K-1');
    svc.accept('K-1');
    expect(() => svc.sendBack('K-1', 'no')).toThrow(ConflictError);
    expect(store.getVersion('K-1')?.status).toBe('ACCEPTED');
    expect(calls).toHaveLength(0);
  });

  it('conflicts when the story is already sent back and waiting for its re-run', () => {
    add('K-1');
    svc.sendBack('K-1', 'once');
    expect(() => svc.sendBack('K-1', 'twice')).toThrow(ConflictError);
    expect(calls).toHaveLength(1);
  });

  it('sends the whole batch back, one re-run per story, and skips accepted stories', () => {
    const b = store.createBatch(['K-1', 'K-2', 'K-3'], 'keys');
    add('K-1', { batchId: b }); add('K-2', { batchId: b }); add('K-3', { batchId: b });
    svc.accept('K-3');
    expect(svc.sendBackBatch(b, 'redo')).toEqual(['K-1', 'K-2']);
    expect(calls.map(c => c.keys)).toEqual([['K-1'], ['K-2']]);
    expect(store.getVersion('K-3')?.status).toBe('ACCEPTED');
  });

  it('rejects empty notes and notes over the limit', () => {
    add('K-1');
    expect(() => svc.sendBack('K-1', '   ')).toThrow(ValidationError);
    expect(() => svc.sendBack('K-1', 'x'.repeat(51))).toThrow(ValidationError);
    expect(store.getVersion('K-1')?.status).toBe('DRAFT');
  });
});

describe('reopen and legacy fallback', () => {
  it('lets a reopened story be sent back', () => {
    add('K-1');
    svc.accept('K-1');
    svc.reopen('K-1');
    expect(store.getVersion('K-1')?.status).toBe('IN_REVIEW');
    svc.sendBack('K-1', 'after all');
    expect(store.getVersion('K-1')?.status).toBe('SENT_BACK');
  });

  it('refuses to reopen a story that is not accepted', () => {
    add('K-1');
    expect(() => svc.reopen('K-1')).toThrow(ConflictError);
  });

  it('adds a legacy version and keeps the formula version', async () => {
    add('K-1', { noCodeFacts: true, estimate: est('Low', true) });
    const v = await svc.useLegacy('K-1');
    expect(v.mode).toBe('legacy');
    expect(store.listVersions('K-1').map(x => x.mode)).toEqual(['formula', 'legacy']);
  });

  it('refuses the legacy fallback on an accepted story', async () => {
    add('K-1');
    svc.accept('K-1');
    await expect(svc.useLegacy('K-1')).rejects.toThrow(ConflictError);
  });
});
