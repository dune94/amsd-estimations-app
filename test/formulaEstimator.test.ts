import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { JiraClient, RawJiraIssue } from '../src/clients/types.js';
import { confidenceConfig } from '../src/config/index.js';
import { openDb } from '../src/db/index.js';
import { openReviewStore, type ReviewStore } from '../src/db/reviewStore.js';
import { createFormulaEstimator, type FormulaEstimate } from '../src/service/formulaEstimator.js';
import type { ScopeOutcome, ScopeRunner } from '../src/scope/scopeRunner.js';

const sample = () => JSON.parse(readFileSync(join(__dirname, 'fixtures', 'scope-result-v1.json'), 'utf8'));

const WITH_ACS = 'Acceptance Criteria\n- Given a signed-in user, when they open the page, then the banner is shown\n- Given no data, when the page loads, then an empty state is shown';

function issue(key: string, descriptionText: string): RawJiraIssue {
  return { key, fields: { summary: 'Sample story', descriptionText, issuetype: { name: 'Story' }, labels: [], components: [] } } as RawJiraIssue;
}

function jiraWith(descriptionText: string): JiraClient {
  return {
    getIssue: async key => issue(key, descriptionText),
    addComment: async () => { throw new Error('read-only'); },
    searchByJql: async () => [],
    getAttachmentContent: async () => Buffer.alloc(0),
  };
}

function fakeRunner(outcome: ScopeOutcome, seen: { text: string }[] = []): ScopeRunner {
  return {
    async buildPack(key, dir) {
      mkdirSync(dir, { recursive: true });
      const p = join(dir, 'pack.json');
      writeFileSync(p, JSON.stringify({ schema_version: 1, key, title: 'T', text: 'Body', images: [], inputs: {}, reviewer_notes: [] }));
      mkdirSync(join(dir, 'images'), { recursive: true });
      writeFileSync(join(dir, 'images', '00-shot.png'), 'png');
      return { packPath: p };
    },
    async run(_key, packPath) { seen.push(JSON.parse(readFileSync(packPath, 'utf8'))); return outcome; },
  };
}

let store: ReviewStore;
let workDir: string;
beforeEach(() => {
  store = openReviewStore(openDb(':memory:').db);
  workDir = mkdtempSync(join(tmpdir(), 'formula-'));
});

const make = (jira: JiraClient, runner: ScopeRunner) =>
  createFormulaEstimator({ jira, scope: runner, store, baselines: [], confidenceCfg: confidenceConfig, workDir });

describe('formula estimator', () => {
  it('copies SP and PERT from the scope result without recomputing', async () => {
    const result = sample();
    const v = await make(jiraWith(WITH_ACS), fakeRunner({ ok: true, result, resultPath: '/x/result.json' })).estimate('PRJ-1');
    const e = v.estimate as FormulaEstimate;
    expect(v.version).toBe(1);
    expect(v.status).toBe('DRAFT');
    expect(v.mode).toBe('formula');
    expect(v.noCodeFacts).toBe(false);
    expect(v.storyHash).toBe(result.story_hash);
    expect(e.sp).toBe(result.planning.planning_sp);
    expect(e.pert).toEqual(result.pert);
    expect(e.levels).toEqual({ scope: 'High', complexity: 'High', risk: 'Low' });
  });

  it('gives Low confidence, with the reason, when acceptance criteria are missing', async () => {
    const v = await make(jiraWith('No criteria written yet.'), fakeRunner({ ok: true, result: sample(), resultPath: '/x' })).estimate('PRJ-1');
    const e = v.estimate as FormulaEstimate;
    expect(e.confidence.level).toBe('Low');
    expect(e.confidence.reasons.map(r => r.code)).toContain('ac_missing');
  });

  it('stores a no-code-facts version, without throwing, when the scope run fails', async () => {
    const v = await make(jiraWith(WITH_ACS), fakeRunner({ ok: false, reason: 'timeout' })).estimate('PRJ-1');
    const e = v.estimate as FormulaEstimate;
    expect(v.noCodeFacts).toBe(true);
    expect(v.status).toBe('DRAFT');
    expect(e.sp).toBeNull();
    expect(e.reason).toBe('timeout');
    expect(e.confidence.level).toBe('Low');
    expect(e.confidence.reasons.map(r => r.code)).toEqual(['no_code_facts']);
  });

  it('treats a result with no required codeline change as no code facts', async () => {
    const result = sample(); delete result.planning; result.pert = null;
    const v = await make(jiraWith(WITH_ACS), fakeRunner({ ok: true, result, resultPath: '/x' })).estimate('PRJ-1');
    expect(v.noCodeFacts).toBe(true);
    expect((v.estimate as FormulaEstimate).reason).toContain('no required codeline');
  });

  it('creates the next version on a re-run and keeps the earlier one', async () => {
    const est = make(jiraWith(WITH_ACS), fakeRunner({ ok: true, result: sample(), resultPath: '/x' }));
    await est.estimate('PRJ-1');
    const second = await est.estimate('PRJ-1');
    expect(second.version).toBe(2);
    expect(store.listVersions('PRJ-1')).toHaveLength(2);
  });

  it('adds the reviewer notes to the pack before the run', async () => {
    const seen: { text: string }[] = [];
    const v = await make(jiraWith(WITH_ACS), fakeRunner({ ok: true, result: sample(), resultPath: '/x' }, seen))
      .estimate('PRJ-1', { notes: 'Please recheck the second rule' });
    expect(seen[0].text).toContain('REVIEWER NOTES');
    expect(seen[0].text).toContain('Please recheck the second rule');
    expect(v.notes).toBe('Please recheck the second rule');
  });

  it('removes the downloaded images after the run and keeps the small pack file', async () => {
    await make(jiraWith(WITH_ACS), fakeRunner({ ok: true, result: sample(), resultPath: '/x' })).estimate('PRJ-1');
    expect(existsSync(join(workDir, 'PRJ-1', 'images'))).toBe(false);
    expect(existsSync(join(workDir, 'PRJ-1', 'pack.json'))).toBe(true);
  });

  it('records the batch id on the version', async () => {
    const batch = store.createBatch(['PRJ-1'], 'keys');
    const v = await make(jiraWith(WITH_ACS), fakeRunner({ ok: true, result: sample(), resultPath: '/x' })).estimate('PRJ-1', { batchId: batch });
    expect(v.batchId).toBe(batch);
    expect(store.listBatchLatest(batch)).toHaveLength(1);
  });
});
