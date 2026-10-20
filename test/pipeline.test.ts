import { describe, expect, it } from 'vitest';
import { createMockConfluenceClient } from '../src/clients/mockConfluenceClient.js';
import { createMockJiraClient } from '../src/clients/mockJiraClient.js';
import { openDb } from '../src/db/index.js';
import { buildPipeline } from '../src/pipeline.js';
import { createEstimationService } from '../src/service/estimationService.js';

function deps(env: NodeJS.ProcessEnv) {
  const jira = createMockJiraClient();
  const db = openDb(':memory:');
  return { env, jira, db, estimation: createEstimationService(jira, createMockConfluenceClient(), db) };
}

describe('buildPipeline', () => {
  it('is off (null) when SCOPE_HOME is not set', () => {
    expect(buildPipeline(deps({}))).toBeNull();
  });

  it('refuses to start without the memory-cap wrapper', () => {
    expect(() => buildPipeline(deps({ SCOPE_HOME: '/tmp/scope' }))).toThrow('SCOPE_BOUNDED');
  });

  it('builds the worker, review service and hooks when configured', async () => {
    const p = buildPipeline(deps({ SCOPE_HOME: '/tmp/scope', SCOPE_BOUNDED: '/tmp/bounded', SCOPE_WORK_DIR: '/tmp/work' }));
    expect(p).not.toBeNull();
    expect(p!.formula.createBatch).toBeTypeOf('function');
    expect(await p!.formula.searchKeys('project = KEY')).toContain('PRJ-9001');
  });

  it('falls back to the legacy engine for a story and keeps the formula version', async () => {
    const p = buildPipeline(deps({ SCOPE_HOME: '/tmp/scope', SCOPE_BOUNDED: '/tmp/bounded' }))!;
    p.store.addVersion({ issueKey: 'PRJ-9001', batchId: null, mode: 'formula', noCodeFacts: true, storyHash: null, estimate: { sp: null }, notes: null });
    const v = await p.review.useLegacy('PRJ-9001');
    expect(v.mode).toBe('legacy');
    expect((v.estimate as { issueKey: string }).issueKey).toBe('PRJ-9001');
    expect(p.store.listVersions('PRJ-9001').map(x => x.mode)).toEqual(['formula', 'legacy']);
  });
});
