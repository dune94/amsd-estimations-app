// ── Output routes ──────────────────────────────────────────────────────────
// POST /estimates/:key/present and POST /estimates/:key/publish { target, dryRun? } (dry run unless dryRun is false).

import type { FastifyInstance, FastifyReply } from 'fastify';
import { ConflictError, ValidationError } from '../service/reviewService.js';
import type { OutputTarget, Outputs } from '../service/outputs.js';

export function registerOutputRoutes(app: FastifyInstance, outputs: Outputs): void {
  const fail = (err: unknown, reply: FastifyReply) => {
    if (err instanceof ConflictError) { reply.code(409); return { error: err.message }; }
    if (err instanceof ValidationError) { reply.code(400); return { error: err.message }; }
    throw err;
  };

  app.post<{ Params: { key: string } }>('/estimates/:key/present', async (req, reply) => {
    try { const v = outputs.present(req.params.key); return { issueKey: v.issueKey, version: v.version, status: v.status }; } catch (err) { return fail(err, reply); }
  });

  app.post<{ Params: { key: string }; Body: { target?: string; dryRun?: boolean } }>('/estimates/:key/publish', async (req, reply) => {
    try { return await outputs.publish(req.params.key, req.body?.target as OutputTarget, { dryRun: req.body?.dryRun }); } catch (err) { return fail(err, reply); }
  });
}
