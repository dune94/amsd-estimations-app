import Fastify from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMockConfluenceClient } from '../src/clients/mockConfluenceClient.js';
import { createMockJiraClient } from '../src/clients/mockJiraClient.js';
import { openDb } from '../src/db/index.js';
import { registerRoutes } from '../src/routes/index.js';
import { createEstimationService } from '../src/service/estimationService.js';

function buildApp() {
  const app = Fastify();
  const jira = createMockJiraClient();
  const confluence = createMockConfluenceClient();
  const db = openDb(':memory:');
  const service = createEstimationService(jira, confluence, db);
  registerRoutes(app, service);
  return app;
}

describe('routes', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
  });

  it('GET /health returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
  });

  it('GET /estimates/:issueKey returns 404 before any recompute', async () => {
    const res = await app.inject({ method: 'GET', url: '/estimates/PRJ-9001' });
    expect(res.statusCode).toBe(404);
  });

  it('POST /estimates/:issueKey/recompute computes and persists an estimate', async () => {
    const res = await app.inject({ method: 'POST', url: '/estimates/PRJ-9001/recompute' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.issueKey).toBe('PRJ-9001');
    expect(body.pert.pertSp).toBeGreaterThan(0);

    const getRes = await app.inject({ method: 'GET', url: '/estimates/PRJ-9001' });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().issueKey).toBe('PRJ-9001');
  });

  it('POST /estimates/:issueKey/recompute returns 400 for an unknown issue', async () => {
    const res = await app.inject({ method: 'POST', url: '/estimates/NOPE-1/recompute' });
    expect(res.statusCode).toBe(400);
  });

  it('POST /estimates/batch computes across all mock fixtures', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/estimates/batch',
      payload: { jql: 'project = KEY' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().count).toBeGreaterThanOrEqual(3);
  });

  it('POST /webhooks/jira rejects a bad shared secret when one is configured', async () => {
    process.env.JIRA_WEBHOOK_SHARED_SECRET = 'expected-secret';
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/jira',
      headers: { 'x-webhook-secret': 'wrong' },
      payload: { issue: { key: 'PRJ-9001' } },
    });
    expect(res.statusCode).toBe(401);
    delete process.env.JIRA_WEBHOOK_SHARED_SECRET;
  });

  it('POST /webhooks/jira runs an estimate with writeBack when secret matches (or none configured)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/jira',
      payload: { issue: { key: 'PRJ-9002' } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().issueKey).toBe('PRJ-9002');
  });

  it('POST /webhooks/jira returns 400 when issue.key is missing', async () => {
    const res = await app.inject({ method: 'POST', url: '/webhooks/jira', payload: {} });
    expect(res.statusCode).toBe(400);
  });
});
