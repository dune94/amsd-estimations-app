// ── Formula estimator ──────────────────────────────────────────────────────
// In `formula` mode the scope engine's result IS the estimate (SP and PERT range are copied, never recomputed).
// This service builds the story pack, runs the engine, attaches baseline evidence and confidence, and stores a new
// draft version. An engine failure never throws: it stores a "no code facts" version the reviewer can re-run.

import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { mapJiraIssueToSignals } from '../clients/mapIssue.js';
import type { JiraClient } from '../clients/types.js';
import type { BaselineStory, ConfidenceConfig } from '../config/index.js';
import type { EstimateVersion, ReviewStore } from '../db/reviewStore.js';
import { baselineEvidence, type BaselineEvidence } from '../engine/baselineEvidence.js';
import { computeConfidence, type Confidence } from '../engine/confidence.js';
import { classifyEffort } from '../engine/effortClassifier.js';
import { appendNotes } from '../scope/pack.js';
import type { PertBlock, ScopeResultV1, ScopeRunner } from '../scope/scopeRunner.js';

export interface FormulaEstimate {
  issueKey: string;
  mode: 'formula';
  sp: number | null;
  pert: PertBlock | null;
  levels: { scope: string; complexity: string; risk: string } | null;
  drivers: ScopeResultV1['drivers'] | null;
  scope: ScopeResultV1 | null;
  scopeResultPath: string | null;
  inputs: ScopeResultV1['inputs'] | null;
  confidence: Confidence;
  baseline: BaselineEvidence;
  noCodeFacts: boolean;
  reason?: string;
  generatedAt: string;
}

export interface FormulaEstimatorDeps {
  jira: JiraClient;
  scope: ScopeRunner;
  store: ReviewStore;
  baselines: BaselineStory[];
  confidenceCfg: ConfidenceConfig;
  workDir: string;
  maxNotesChars?: number;
  closestCount?: number;
  now?: () => Date;
}

export interface FormulaEstimator {
  estimate(issueKey: string, o?: { batchId?: string; notes?: string }): Promise<EstimateVersion>;
}

export function createFormulaEstimator(deps: FormulaEstimatorDeps): FormulaEstimator {
  const now = deps.now ?? (() => new Date());
  const maxNotes = deps.maxNotesChars ?? 4000;
  const emptyEvidence: BaselineEvidence = { support: 0, observedSp: [], medianObservedSp: null, closest: [] };

  return {
    async estimate(issueKey, o = {}) {
      const raw = await deps.jira.getIssue(issueKey);
      const acStatus = classifyEffort(mapJiraIssueToSignals(raw)).acStatus;
      const dir = join(deps.workDir, issueKey);
      const generatedAt = now().toISOString();

      const save = (estimate: FormulaEstimate, storyHash: string | null) =>
        deps.store.addVersion({
          issueKey, batchId: o.batchId ?? null, mode: 'formula', noCodeFacts: estimate.noCodeFacts,
          storyHash, estimate, notes: o.notes ?? null,
        });
      const noCodeFacts = (reason: string): EstimateVersion => {
        const confidence = computeConfidence({
          acStatus, noCodeFacts: true, attachmentsRead: 0, attachmentsNotRead: [], droppedDrivers: 0,
          support: 0, base: 0, upper: 0, estimateSp: null, medianObservedSp: null,
        }, deps.confidenceCfg);
        return save({
          issueKey, mode: 'formula', sp: null, pert: null, levels: null, drivers: null, scope: null, scopeResultPath: null,
          inputs: null, confidence, baseline: emptyEvidence, noCodeFacts: true, reason, generatedAt,
        }, null);
      };

      try {
        const built = await deps.scope.buildPack(issueKey, dir);
        if ('error' in built) return noCodeFacts(`pack: ${built.error}`);
        if (o.notes) appendNotes(built.packPath, o.notes, generatedAt.slice(0, 10), maxNotes);
        const out = await deps.scope.run(issueKey, built.packPath);
        if (!out.ok) return noCodeFacts(out.reason);

        const r = out.result;
        const p = r.planning;
        if (!p) return noCodeFacts('no required codeline had a change in BASE');
        const levels = { scope: p.scope, complexity: p.complexity, risk: p.risk };
        const baseline = baselineEvidence({ ...levels, blastRadius: p.base_br }, deps.baselines, deps.closestCount ?? 5);
        const confidence = computeConfidence({
          acStatus, noCodeFacts: false,
          attachmentsRead: r.inputs.attachments_read?.length ?? 0,
          attachmentsNotRead: r.inputs.attachments_not_read ?? [],
          droppedDrivers: r.drivers.dropped.length,
          support: baseline.support, base: p.base_br, upper: p.upper_br,
          estimateSp: p.planning_sp, medianObservedSp: baseline.medianObservedSp,
        }, deps.confidenceCfg);
        return save({
          issueKey, mode: 'formula', sp: p.planning_sp, pert: r.pert ?? p.pert, levels, drivers: r.drivers, scope: r,
          scopeResultPath: out.resultPath, inputs: r.inputs, confidence, baseline, noCodeFacts: false, generatedAt,
        }, r.story_hash);
      } finally {
        rmSync(join(dir, 'images'), { recursive: true, force: true }); // keep the small pack file, drop the downloaded images
      }
    },
  };
}
