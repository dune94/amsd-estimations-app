// ── Review routes ──────────────────────────────────────────────────────────
// Batches, progress, the review page and the review actions. Conflicts (wrong state) are 409, bad input is 400.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { JiraClient } from '../clients/types.js';
import type { ReviewStore } from '../db/reviewStore.js';
import { renderReviewPage } from '../reporting/reviewPage.js';
import type { BatchWorker } from '../service/batchWorker.js';
import { ConflictError, ValidationError, type ReviewService } from '../service/reviewService.js';

export interface ReviewRouteDeps { worker: BatchWorker; review: ReviewService; store: ReviewStore; jira: JiraClient }

type Handler = (req: FastifyRequest<{ Params: Record<string, string>; Body: Record<string, unknown> | undefined }>, reply: FastifyReply) => Promise<unknown>;

export function registerReviewRoutes(app: FastifyInstance, deps: ReviewRouteDeps): void {
  const { worker, review, store } = deps;

  // Plain HTML forms post urlencoded bodies.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  const guard = (fn: Handler) => async (req: Parameters<Handler>[0], reply: FastifyReply) => {
    try {
      return await fn(req, reply);
    } catch (err) {
      if (err instanceof ConflictError) { reply.code(409); return { error: err.message }; }
      if (err instanceof ValidationError) { reply.code(400); return { error: err.message }; }
      throw err;
    }
  };
  const isForm = (req: FastifyRequest) => String(req.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded');
  const respond = (req: FastifyRequest, reply: FastifyReply, batchId: string | null | undefined, payload: unknown) => {
    if (isForm(req) && batchId) return reply.code(303).header('location', `/review/${batchId}`).send('');
    return payload;
  };
  const notesOf = (req: { body: Record<string, unknown> | undefined }) => String(req.body?.notes ?? '');

  app.post('/batches', guard(async (req, reply) => {
    const body = req.body ?? {};
    let keys: string[] | null = null;
    if (Array.isArray(body.keys)) {
      if (!body.keys.every(k => typeof k === 'string' && k.trim())) throw new ValidationError('"keys" must be a list of issue keys');
      keys = body.keys as string[];
    } else if (typeof body.jql === 'string' && body.jql.trim()) {
      keys = (await deps.jira.searchByJql(body.jql, 100)).map(i => i.key);
    }
    if (!keys) throw new ValidationError('Request body must include "keys" or "jql"');
    const batchId = worker.createBatch(keys, Array.isArray(body.keys) ? 'keys' : 'jql');
    reply.code(202);
    return { batchId };
  }));

  app.get<{ Params: { id: string } }>('/batches/:id', async (req, reply) => {
    const p = worker.progress(req.params.id);
    if (p.total === 0) { reply.code(404); return { error: 'unknown batch' }; }
    return p;
  });

  app.get<{ Params: { batchId: string } }>('/review/:batchId', async (req, reply) => {
    if (store.batchItems(req.params.batchId).length === 0) { reply.code(404); return { error: 'unknown batch' }; }
    const rows = store.listBatchLatest(req.params.batchId).map(v => ({ version: v, history: store.listVersions(v.issueKey) }));
    reply.type('text/html; charset=utf-8');
    return renderReviewPage(req.params.batchId, rows, store.batchItems(req.params.batchId));
  });

  const batchOfKey = (key: string) => store.getVersion(key)?.batchId;

  app.post('/review/:key/accept', guard(async (req, reply) => {
    const key = req.params.key; review.accept(key);
    return respond(req, reply, batchOfKey(key), { ok: true });
  }));
  app.post('/review/:key/send-back', guard(async (req, reply) => {
    const key = req.params.key; const batchId = batchOfKey(key);
    review.sendBack(key, notesOf(req));
    return respond(req, reply, batchId, { ok: true });
  }));
  app.post('/review/:key/reopen', guard(async (req, reply) => {
    const key = req.params.key; review.reopen(key);
    return respond(req, reply, batchOfKey(key), { ok: true });
  }));
  app.post('/review/:key/use-legacy', guard(async (req, reply) => {
    const key = req.params.key; const batchId = batchOfKey(key);
    await review.useLegacy(key);
    return respond(req, reply, batchId, { ok: true });
  }));
  app.post('/batches/:id/accept-high', guard(async (req, reply) => {
    const accepted = review.acceptAllHigh(req.params.id);
    return respond(req, reply, req.params.id, { accepted });
  }));
  app.post('/batches/:id/send-back', guard(async (req, reply) => {
    const sentBack = review.sendBackBatch(req.params.id, notesOf(req));
    return respond(req, reply, req.params.id, { sentBack });
  }));
}
