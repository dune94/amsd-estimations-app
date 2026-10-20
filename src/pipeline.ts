// ── Pipeline wiring ────────────────────────────────────────────────────────
// Builds the formula pipeline (scope runner, estimator, review store, worker, review service) from the environment.
// Returns null when SCOPE_HOME is not set: the app then behaves exactly as the legacy engine always did.

import type { JiraClient } from './clients/types.js';
import { baselineStories, confidenceConfig } from './config/index.js';
import type { EstimatesDb } from './db/index.js';
import { openReviewStore, type ReviewStore } from './db/reviewStore.js';
import { renderReviewPage } from './reporting/reviewPage.js';
import type { FormulaHooks } from './routes/index.js';
import { createScopeRunner } from './scope/scopeRunner.js';
import { createBatchWorker, type BatchWorker } from './service/batchWorker.js';
import type { EstimationService } from './service/estimationService.js';
import { createFormulaEstimator } from './service/formulaEstimator.js';
import { createOutputs, type Outputs } from './service/outputs.js';
import { createReviewService, type ReviewService } from './service/reviewService.js';

export interface Pipeline { worker: BatchWorker; review: ReviewService; store: ReviewStore; formula: FormulaHooks; outputs: Outputs }

export function buildPipeline(deps: { env: NodeJS.ProcessEnv; jira: JiraClient; estimation: EstimationService; db: EstimatesDb }): Pipeline | null {
  const { env } = deps;
  if (!env.SCOPE_HOME) return null;
  if (!env.SCOPE_BOUNDED) throw new Error('SCOPE_BOUNDED (the memory-cap wrapper) is required when SCOPE_HOME is set');
  const num = (v: string | undefined, d: number) => (v && Number(v) > 0 ? Number(v) : d);
  const maxNotesChars = num(env.MAX_NOTES_CHARS, 4000);

  const store = openReviewStore(deps.db.db);
  const scope = createScopeRunner({
    scopeHome: env.SCOPE_HOME, boundedBin: env.SCOPE_BOUNDED,
    boundedMb: num(env.SCOPE_BOUNDED_MB, 1024), timeoutMs: num(env.SCOPE_TIMEOUT_MS, 1_200_000),
  });
  const estimator = createFormulaEstimator({
    jira: deps.jira, scope, store, baselines: baselineStories, confidenceCfg: confidenceConfig,
    workDir: env.SCOPE_WORK_DIR || './data/work', maxNotesChars,
  });
  const worker = createBatchWorker({ store, estimator, maxBatchSize: num(env.MAX_BATCH_SIZE, 25) });
  const review = createReviewService({
    store, maxNotesChars, enqueue: (batchId, keys, notes) => worker.enqueue(batchId, keys, notes),
    legacyEstimate: async key => {
      const result = await deps.estimation.runEstimate(key);
      return store.addVersion({ issueKey: key, batchId: null, mode: 'legacy', noCodeFacts: false, storyHash: null, estimate: result, notes: null });
    },
  });
  const formula: FormulaHooks = {
    createBatch: (keys, source) => worker.createBatch(keys, source),
    searchKeys: async jql => (await deps.jira.searchByJql(jql, 100)).map(i => i.key),
  };
  // No writer is passed: Jira and Confluence stay read-only, so publishing is always a dry run until a writer is added on purpose.
  const outputs = createOutputs({
    store, env,
    render: v => ({ title: `Estimate: ${v.issueKey}`, html: renderReviewPage(v.batchId ?? '', [{ version: v, history: store.listVersions(v.issueKey) }]) }),
  });
  return { worker, review, store, formula, outputs };
}
