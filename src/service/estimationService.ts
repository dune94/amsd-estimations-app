// ── Estimation service ───────────────────────────────────────────────────────
// Orchestrates: fetch issue -> map to signals -> run deterministic engine ->
// optionally run LLM deep-dive -> persist -> render -> write back.
// This is the only place that knows about clients, db, and reporting all at
// once — routes stay thin.

import type { ConfluenceClient, JiraClient } from '../clients/types.js';
import { mapJiraIssueToSignals } from '../clients/mapIssue.js';
import type { EstimatesDb } from '../db/index.js';
import { estimate } from '../engine/index.js';
import { blendEstimates, type LlmEstimator } from '../engine/llmEngine.js';
import type { CodeAssessor, SourceExcerpt } from '../engine/codeAssessor.js';
import type { AttachmentAssessor, RawAttachment } from '../engine/attachmentAssessor.js';
import type { EstimateResult } from '../engine/types.js';
import { renderConfluencePage, renderJiraComment } from '../reporting/estimateCard.js';

interface RunOpts {
  writeBack?: boolean;
  /** When true, runs the LLM deep-dive if an llmEstimator was supplied. */
  withLlm?: boolean;
  /**
   * When true, runs an LLM code-assessment pass using the supplied codeAssessor.
   * Callers must also provide sourceExcerpts — the files/content to review.
   * Non-fatal: if the assessor throws, codeAssessmentError is set on the result.
   */
  withCodeAssessment?: boolean;
  /** Source file excerpts to pass to the code assessor. Required when withCodeAssessment=true. */
  sourceExcerpts?: SourceExcerpt[];
  /**
   * When true, fetches Jira attachments and passes them to the attachmentAssessor.
   * Non-fatal: if fetching or the assessor throws, attachmentAssessmentError is set on the result.
   */
  withAttachments?: boolean;
}

export interface EstimationService {
  runEstimate(issueKey: string, opts?: RunOpts): Promise<EstimateResult>;
  runBatch(jql: string, opts?: RunOpts): Promise<EstimateResult[]>;
  getStoredEstimate(issueKey: string): EstimateResult | null;
  listEstimates(limit?: number): EstimateResult[];
}

export function createEstimationService(
  jira: JiraClient,
  confluence: ConfluenceClient,
  db: EstimatesDb,
  llmEstimator?: LlmEstimator,
  codeAssessor?: CodeAssessor,
  attachmentAssessor?: AttachmentAssessor,
): EstimationService {
  async function applyLlm(result: EstimateResult, signals: ReturnType<typeof mapJiraIssueToSignals>, withLlm?: boolean): Promise<EstimateResult> {
    // 2026-09-16: withLlm now means "run the LLM" - the escalation flag no
    // longer gates it (the flag depends on the deterministic lenses, which is
    // exactly the path we no longer trust to decide anything).
    if (!llmEstimator || !withLlm) return result;
    try {
      const llm = await llmEstimator.deepDive(signals, result.pert.pertSp);
      return { ...result, llmEstimate: llm, blendedSp: blendEstimates(llm.pertSp, result.pert.pertSp) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[llm] deepDive failed for ${result.issueKey}: ${message}`);
      return { ...result, llmError: message };
    }
  }

  async function applyCodeAssessment(
    result: EstimateResult,
    signals: ReturnType<typeof mapJiraIssueToSignals>,
    opts: RunOpts,
  ): Promise<EstimateResult> {
    if (!codeAssessor || !opts.withCodeAssessment) return result;
    const excerpts = opts.sourceExcerpts ?? [];
    if (excerpts.length === 0) {
      console.warn(`[code-assessor] withCodeAssessment=true but no sourceExcerpts supplied for ${result.issueKey} — skipping`);
      return result;
    }
    try {
      const assessment = await codeAssessor.assess(signals, excerpts);
      return { ...result, codeAssessment: assessment };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[code-assessor] assess failed for ${result.issueKey}: ${message}`);
      return { ...result, codeAssessmentError: message };
    }
  }

  async function applyAttachmentAssessment(
    result: EstimateResult,
    signals: ReturnType<typeof mapJiraIssueToSignals>,
    rawIssue: Awaited<ReturnType<JiraClient['getIssue']>>,
    opts: RunOpts,
  ): Promise<EstimateResult> {
    if (!attachmentAssessor || !opts.withAttachments) return result;
    const attachmentMeta = rawIssue.fields.attachments ?? [];
    if (attachmentMeta.length === 0) {
      console.warn(`[attachment-assessor] withAttachments=true but issue ${result.issueKey} has no attachments — skipping`);
      return result;
    }
    try {
      const rawAttachments: RawAttachment[] = [];
      for (const meta of attachmentMeta) {
        const data = await jira.getAttachmentContent(meta.contentUrl);
        rawAttachments.push({ filename: meta.filename, mimeType: meta.mimeType, data });
      }
      const assessment = await attachmentAssessor.assess(signals, rawAttachments);
      return { ...result, attachmentAssessment: assessment };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[attachment-assessor] assess failed for ${result.issueKey}: ${message}`);
      return { ...result, attachmentAssessmentError: message };
    }
  }

  async function runEstimate(issueKey: string, opts: RunOpts = {}): Promise<EstimateResult> {
    const rawIssue = await jira.getIssue(issueKey);
    const signals = mapJiraIssueToSignals(rawIssue);
    let result = estimate(signals);
    result = await applyLlm(result, signals, opts.withLlm);
    result = await applyCodeAssessment(result, signals, opts);
    result = await applyAttachmentAssessment(result, signals, rawIssue, opts);
    db.saveEstimate(result);

    if (opts.writeBack) {
      const { title, html } = renderConfluencePage(result);
      const page = await confluence.upsertEstimatePage(issueKey, title, html);
      const commentText = renderJiraComment(result, page.url);
      await jira.addComment(issueKey, commentText);
    }

    return result;
  }

  async function runBatch(jql: string, opts: RunOpts = {}): Promise<EstimateResult[]> {
    const issues = await jira.searchByJql(jql);
    const results: EstimateResult[] = [];
    for (const raw of issues) {
      const signals = mapJiraIssueToSignals(raw);
      let result = estimate(signals);
      result = await applyLlm(result, signals, opts.withLlm);
      result = await applyCodeAssessment(result, signals, opts);
      result = await applyAttachmentAssessment(result, signals, raw, opts);
      db.saveEstimate(result);
      if (opts.writeBack) {
        const { title, html } = renderConfluencePage(result);
        const page = await confluence.upsertEstimatePage(raw.key, title, html);
        await jira.addComment(raw.key, renderJiraComment(result, page.url));
      }
      results.push(result);
    }
    return results;
  }

  function getStoredEstimate(issueKey: string): EstimateResult | null {
    return db.getEstimate(issueKey);
  }

  function listEstimates(limit?: number): EstimateResult[] {
    return db.listEstimates(limit);
  }

  return { runEstimate, runBatch, getStoredEstimate, listEstimates };
}
