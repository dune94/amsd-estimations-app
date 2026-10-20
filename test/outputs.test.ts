import Fastify from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/index.js';
import { openReviewStore, type ReviewStore } from '../src/db/reviewStore.js';
import { registerOutputRoutes } from '../src/routes/outputs.js';
import { ConflictError, ValidationError } from '../src/service/reviewService.js';
import { createOutputs, type Outputs } from '../src/service/outputs.js';

let store: ReviewStore;
let writes: { target: string; payload: unknown }[];

function outputs(env: NodeJS.ProcessEnv = {}, withWriter = true): Outputs {
  return createOutputs({
    store, env,
    render: v => ({ title: `Estimate ${v.issueKey}`, html: `<p>${v.issueKey}</p>` }),
    write: withWriter ? async (target, payload) => { writes.push({ target, payload }); } : undefined,
  });
}
function version(status: 'DRAFT' | 'ACCEPTED' | 'PRESENTED') {
  const v = store.addVersion({ issueKey: 'K-1', batchId: null, mode: 'formula', noCodeFacts: false, storyHash: 'h', estimate: { sp: 5 }, notes: null });
  if (status !== 'DRAFT') store.setStatus('K-1', v.version, 'ACCEPTED', 'accept');
  if (status === 'PRESENTED') store.setStatus('K-1', v.version, 'PRESENTED', 'present');
  return v;
}

beforeEach(() => {
  store = openReviewStore(openDb(':memory:').db);
  writes = [];
});

describe('present', () => {
  it('requires an accepted version', () => {
    version('DRAFT');
    expect(() => outputs().present('K-1')).toThrow(ConflictError);
    expect(store.getVersion('K-1')?.status).toBe('DRAFT');
  });
  it('moves an accepted version to PRESENTED', () => {
    version('ACCEPTED');
    expect(outputs().present('K-1').status).toBe('PRESENTED');
    expect(store.events('K-1').map(e => e.event)).toEqual(['accept', 'present']);
  });
});

describe('publish', () => {
  it('refuses a version that is not presented', async () => {
    version('ACCEPTED');
    await expect(outputs({ OUTPUTS_ENABLED: 'true' }).publish('K-1', 'preview', { dryRun: false })).rejects.toThrow(ConflictError);
    expect(writes).toHaveLength(0);
  });

  it('defaults to a dry run and never writes, even with the flag on', async () => {
    version('PRESENTED');
    const r = await outputs({ OUTPUTS_ENABLED: 'true' }).publish('K-1', 'preview');
    expect(r.dryRun).toBe(true);
    expect(r.payload).toMatchObject({ title: 'Estimate K-1' });
    expect(writes).toHaveLength(0);
    expect(store.getVersion('K-1')?.status).toBe('PRESENTED');
  });

  it('does not write with dryRun false when OUTPUTS_ENABLED is not true', async () => {
    version('PRESENTED');
    for (const env of [{}, { OUTPUTS_ENABLED: 'false' }, { OUTPUTS_ENABLED: '1' }]) {
      const r = await outputs(env).publish('K-1', 'preview', { dryRun: false });
      expect(r.dryRun).toBe(true);
      expect(r.reason).toContain('OUTPUTS_ENABLED');
    }
    expect(writes).toHaveLength(0);
  });

  it('stays a dry run when no writer is configured', async () => {
    version('PRESENTED');
    const r = await outputs({ OUTPUTS_ENABLED: 'true' }, false).publish('K-1', 'preview', { dryRun: false });
    expect(r.dryRun).toBe(true);
    expect(r.reason).toContain('writer');
  });

  it('writes exactly once, and marks OUTPUT_WRITTEN, when every condition holds', async () => {
    version('PRESENTED');
    const r = await outputs({ OUTPUTS_ENABLED: 'true' }).publish('K-1', 'preview', { dryRun: false });
    expect(r.dryRun).toBe(false);
    expect(writes).toEqual([{ target: 'preview', payload: { title: 'Estimate K-1', html: '<p>K-1</p>' } }]);
    expect(store.getVersion('K-1')?.status).toBe('OUTPUT_WRITTEN');
    expect(store.events('K-1').map(e => e.event)).toContain('publish:preview');
  });

  it('builds the Jira story point payload from the estimate', async () => {
    version('PRESENTED');
    const r = await outputs().publish('K-1', 'jiraSp');
    expect(r.payload).toEqual({ issueKey: 'K-1', storyPoints: 5 });
  });

  it('rejects an unknown target', async () => {
    version('PRESENTED');
    await expect(outputs().publish('K-1', 'wiki' as never)).rejects.toThrow(ValidationError);
  });
});

describe('routes', () => {
  function app() {
    const a = Fastify();
    registerOutputRoutes(a, outputs());
    return a;
  }
  it('present answers 200 then 409', async () => {
    version('ACCEPTED');
    const a = app();
    expect((await a.inject({ method: 'POST', url: '/estimates/K-1/present' })).statusCode).toBe(200);
    expect((await a.inject({ method: 'POST', url: '/estimates/K-1/present' })).statusCode).toBe(409);
  });
  it('publish is a dry run by default, and 400 for a bad target', async () => {
    version('PRESENTED');
    const a = app();
    const ok = await a.inject({ method: 'POST', url: '/estimates/K-1/publish', payload: { target: 'preview' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().dryRun).toBe(true);
    const bad = await a.inject({ method: 'POST', url: '/estimates/K-1/publish', payload: { target: 'wiki' } });
    expect(bad.statusCode).toBe(400);
  });
});
