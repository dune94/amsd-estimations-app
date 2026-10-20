import Fastify from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMockConfluenceClient } from '../src/clients/mockConfluenceClient.js';
import { createMockJiraClient } from '../src/clients/mockJiraClient.js';
import { openDb } from '../src/db/index.js';
import { openReviewStore, type ReviewStore } from '../src/db/reviewStore.js';
import { registerReviewRoutes } from '../src/routes/review.js';
import { registerRoutes } from '../src/routes/index.js';
import { createBatchWorker, type BatchWorker } from '../src/service/batchWorker.js';
import { createEstimationService } from '../src/service/estimationService.js';
import { createReviewService } from '../src/service/reviewService.js';
import type { FormulaEstimator } from '../src/service/formulaEstimator.js';

let store: ReviewStore;
let worker: BatchWorker;
let app: ReturnType<typeof Fastify>;

const confidence = { level: 'High', reasons: [] };

function build(maxBatch = 3) {
  const est = openDb(':memory:');
  store = openReviewStore(est.db);
  const jira = createMockJiraClient();
  const estimator: FormulaEstimator = {
    estimate: async (key, o) => store.addVersion({
      issueKey: key, batchId: o?.batchId ?? null, mode: 'formula', noCodeFacts: false, storyHash: 'h',
      estimate: { issueKey: key, mode: 'formula', sp: 5, confidence, noCodeFacts: false }, notes: o?.notes ?? null,
    }),
  };
  worker = createBatchWorker({ store, estimator, maxBatchSize: maxBatch });
  const review = createReviewService({
    store, maxNotesChars: 40, enqueue: (b, k, n) => worker.enqueue(b, k, n),
    legacyEstimate: async key => store.addVersion({ issueKey: key, batchId: null, mode: 'legacy', noCodeFacts: false, storyHash: null, estimate: { sp: 8 }, notes: null }),
  });
  app = Fastify();
  const service = createEstimationService(jira, createMockConfluenceClient(), est);
  registerRoutes(app, service, { createBatch: (keys, source) => worker.createBatch(keys, source), searchKeys: async jql => (await jira.searchByJql(jql)).map(i => i.key) });
  registerReviewRoutes(app, { worker, review, store, jira });
}

const post = (url: string, payload?: unknown) => app.inject({ method: 'POST', url, payload: payload as never });

beforeEach(() => build());

describe('batches', () => {
  it('creates a batch (202), runs it, and reports progress', async () => {
    const res = await post('/batches', { keys: ['K-1', 'K-2'] });
    expect(res.statusCode).toBe(202);
    const { batchId } = res.json();
    await worker.idle();
    const prog = await app.inject({ method: 'GET', url: `/batches/${batchId}` });
    expect(prog.json()).toEqual({ total: 2, queued: 0, done: 2, failed: 0, running: null });
  });

  it('rejects empty, duplicate and oversize input with 400', async () => {
    expect((await post('/batches', { keys: [] })).statusCode).toBe(400);
    expect((await post('/batches', {})).statusCode).toBe(400);
    expect((await post('/batches', { keys: ['K-1', 'K-1'] })).statusCode).toBe(400);
    expect((await post('/batches', { keys: ['A', 'B', 'C', 'D'] })).statusCode).toBe(400);
  });

  it('rejects keys that are not issue keys with 400', async () => {
    expect((await post('/batches', { keys: ['../x'] })).statusCode).toBe(400);
    expect((await post('/batches', { keys: ['K-1;ls'] })).statusCode).toBe(400);
  });

  it('shows queued and failed stories on the review page with the reason', async () => {
    const res = await post('/batches', { keys: ['K-1'] });
    const { batchId } = res.json();
    store.setItemState(batchId, 'K-1', 'FAILED', 'engine <exploded>');
    await worker.idle();
    const page = await app.inject({ method: 'GET', url: `/review/${batchId}` });
    expect(page.body).toContain('K-1');
    expect(page.body).toContain('FAILED');
    expect(page.body).toContain('engine &lt;exploded&gt;');
  });

  it('takes the stories from a JQL query', async () => {
    const res = await post('/batches', { jql: 'project = KEY' });
    expect(res.statusCode).toBe(202);
    await worker.idle();
    expect(store.batchItems(res.json().batchId).length).toBeGreaterThan(0);
  });

  it('answers 404 for an unknown batch', async () => {
    expect((await app.inject({ method: 'GET', url: '/batches/b_unknown' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/review/b_unknown' })).statusCode).toBe(404);
  });
});

describe('review', () => {
  async function batchOf(...keys: string[]) {
    const { batchId } = (await post('/batches', { keys })).json();
    await worker.idle();
    return batchId as string;
  }

  it('serves the review page as HTML', async () => {
    const b = await batchOf('K-1');
    const res = await app.inject({ method: 'GET', url: `/review/${b}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('K-1');
  });

  it('accepts once (200) and conflicts the second time (409)', async () => {
    await batchOf('K-1');
    expect((await post('/review/K-1/accept')).statusCode).toBe(200);
    expect((await post('/review/K-1/accept')).statusCode).toBe(409);
  });

  it('sends back with notes, re-runs the story, and rejects empty or over-long notes', async () => {
    await batchOf('K-1');
    expect((await post('/review/K-1/send-back', { notes: '' })).statusCode).toBe(400);
    expect((await post('/review/K-1/send-back', { notes: 'x'.repeat(41) })).statusCode).toBe(400);
    expect((await post('/review/K-1/send-back', { notes: 'check the rule' })).statusCode).toBe(200);
    await worker.idle();
    expect(store.getVersion('K-1')?.version).toBe(2);
    expect(store.getVersion('K-1')?.notes).toContain('check the rule');
  });

  it('accepts all High-confidence stories and sends a whole batch back', async () => {
    const b = await batchOf('K-1', 'K-2');
    expect((await post(`/batches/${b}/accept-high`)).json()).toEqual({ accepted: ['K-1', 'K-2'] });
    const b2 = await batchOf('K-3');
    const sent = await post(`/batches/${b2}/send-back`, { notes: 'redo all' });
    expect(sent.json()).toEqual({ sentBack: ['K-3'] });
  });

  it('reopens an accepted story and runs the legacy fallback', async () => {
    await batchOf('K-1');
    await post('/review/K-1/accept');
    expect((await post('/review/K-1/reopen')).statusCode).toBe(200);
    expect((await post('/review/K-1/use-legacy')).statusCode).toBe(200);
    expect(store.listVersions('K-1').map(v => v.mode)).toEqual(['formula', 'legacy']);
  });

  it('answers a form post with a redirect back to the review page', async () => {
    const b = await batchOf('K-1');
    const res = await app.inject({ method: 'POST', url: '/review/K-1/accept', payload: 'x=1', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe(`/review/${b}`);
  });
});

describe('mode on the existing routes', () => {
  it('rejects an invalid mode with 400', async () => {
    const res = await post('/estimates/PRJ-9001/recompute', { mode: 'turbo' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('invalid mode');
  });

  it('creates a batch (202) for mode formula and leaves legacy unchanged', async () => {
    const res = await post('/estimates/PRJ-9001/recompute', { mode: 'formula' });
    expect(res.statusCode).toBe(202);
    expect(res.json().batchId).toMatch(/^b_/);
    const legacy = await post('/estimates/PRJ-9001/recompute', { mode: 'legacy' });
    expect(legacy.statusCode).toBe(200);
    expect(legacy.json().issueKey).toBe('PRJ-9001');
  });

  it('says formula mode is not configured when the pipeline is not wired', async () => {
    const bare = Fastify();
    registerRoutes(bare, createEstimationService(createMockJiraClient(), createMockConfluenceClient(), openDb(':memory:')));
    const res = await bare.inject({ method: 'POST', url: '/estimates/PRJ-9001/recompute', payload: { mode: 'formula' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('not configured');
  });
});
