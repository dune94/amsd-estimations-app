// ── Routes ───────────────────────────────────────────────────────────────────

import type { FastifyInstance } from 'fastify';
import { resolveMode } from '../config/mode.js';
import type { EstimationService } from '../service/estimationService.js';

/** Present only when the formula pipeline is configured; `mode: "formula"` requests then create a batch instead of an inline estimate. */
export interface FormulaHooks {
  createBatch(keys: string[], source: string): string;
  searchKeys(jql: string): Promise<string[]>;
}

export function registerRoutes(app: FastifyInstance, service: EstimationService, formula?: FormulaHooks): void {
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  app.get<{ Querystring: { limit?: string } }>('/estimates', async (req) => {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    return { estimates: service.listEstimates(limit) };
  });

  app.get<{ Params: { issueKey: string } }>('/estimates/:issueKey', async (req, reply) => {
    const result = service.getStoredEstimate(req.params.issueKey);
    if (!result) {
      reply.code(404);
      return { error: `No stored estimate for ${req.params.issueKey}. POST /estimates/${req.params.issueKey}/recompute first.` };
    }
    return result;
  });

  app.post<{ Params: { issueKey: string }; Body: { writeBack?: boolean; withLlm?: boolean; mode?: string } }>(
    '/estimates/:issueKey/recompute',
    async (req, reply) => {
      try {
        if (resolveMode(req.body?.mode) === 'formula') {
          if (!formula) throw new Error('formula mode is not configured (set SCOPE_HOME)');
          reply.code(202);
          return { batchId: formula.createBatch([req.params.issueKey], 'recompute') };
        }
        const result = await service.runEstimate(req.params.issueKey, {
          writeBack: req.body?.writeBack ?? false,
          withLlm: req.body?.withLlm ?? false,
        });
        return result;
      } catch (err) {
        reply.code(400);
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  app.post<{ Body: { jql: string; writeBack?: boolean; withLlm?: boolean; mode?: string } }>('/estimates/batch', async (req, reply) => {
    if (!req.body?.jql) {
      reply.code(400);
      return { error: 'Request body must include "jql"' };
    }
    try {
      if (resolveMode(req.body.mode) === 'formula') {
        if (!formula) throw new Error('formula mode is not configured (set SCOPE_HOME)');
        reply.code(202);
        return { batchId: formula.createBatch(await formula.searchKeys(req.body.jql), 'jql') };
      }
    } catch (err) {
      reply.code(400);
      return { error: err instanceof Error ? err.message : String(err) };
    }
    const results = await service.runBatch(req.body.jql, {
      writeBack: req.body.writeBack ?? false,
      withLlm: req.body.withLlm ?? false,
    });
    return { count: results.length, results };
  });

  // Inbound Jira webhook. Verifies a shared-secret header (Jira Cloud has no
  // built-in HMAC signing for Automation-triggered webhooks) rather than
  // trusting the payload; always re-fetches the issue via runEstimate.
  app.post<{
    Headers: { 'x-webhook-secret'?: string };
    Body: { issue?: { key?: string } };
  }>('/webhooks/jira', async (req, reply) => {
    const expected = process.env.JIRA_WEBHOOK_SHARED_SECRET;
    if (expected && req.headers['x-webhook-secret'] !== expected) {
      reply.code(401);
      return { error: 'Invalid webhook secret' };
    }

    const issueKey = req.body?.issue?.key;
    if (!issueKey) {
      reply.code(400);
      return { error: 'Payload missing issue.key' };
    }

    const result = await service.runEstimate(issueKey, { writeBack: true });
    return { received: true, issueKey, pertSp: result.pert.pertSp };
  });
}
