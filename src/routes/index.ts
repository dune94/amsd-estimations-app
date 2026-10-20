// ── Routes ───────────────────────────────────────────────────────────────────

import type { FastifyInstance } from 'fastify';
import type { EstimationService } from '../service/estimationService.js';

export function registerRoutes(app: FastifyInstance, service: EstimationService): void {
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

  app.post<{ Params: { issueKey: string }; Body: { writeBack?: boolean; withLlm?: boolean } }>(
    '/estimates/:issueKey/recompute',
    async (req, reply) => {
      try {
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

  app.post<{ Body: { jql: string; writeBack?: boolean; withLlm?: boolean } }>('/estimates/batch', async (req, reply) => {
    if (!req.body?.jql) {
      reply.code(400);
      return { error: 'Request body must include "jql"' };
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
