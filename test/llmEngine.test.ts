import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockConfluenceClient } from '../src/clients/mockConfluenceClient.js';
import { createMockJiraClient } from '../src/clients/mockJiraClient.js';
import { openDb } from '../src/db/index.js';
import { blendEstimates, LLM_BLEND_WEIGHT, DETERMINISTIC_BLEND_WEIGHT, type LlmEstimator } from '../src/engine/llmEngine.js';
import type { IssueSignals, LlmPertEstimate } from '../src/engine/types.js';
import { registerRoutes } from '../src/routes/index.js';
import { createEstimationService } from '../src/service/estimationService.js';

// ── Mock LLM estimator ──────────────────────────────────────────────────────

function makeMockEstimator(response: LlmPertEstimate): LlmEstimator {
  return { deepDive: vi.fn().mockResolvedValue(response) };
}

function makeFailingEstimator(): LlmEstimator {
  return { deepDive: vi.fn().mockRejectedValue(new Error('Anthropic API error')) };
}

const MOCK_LLM_ESTIMATE: LlmPertEstimate = {
  optimistic: 3,
  mostLikely: 5,
  pessimistic: 8,
  pertSp: 5.2,
  rationale: ['Multi-state form logic', 'External dependency on auth service'],
  model: 'claude-opus-4-8',
  thinkingSummary: 'Considered complexity of AC set',
};

// ── blendEstimates unit tests ────────────────────────────────────────────────

describe('blendEstimates', () => {
  it('returns the LLM estimate unblended (weights 1.0 / 0.0)', () => {
    const blended = blendEstimates(10, 5);
    expect(blended).toBe(Math.round((10 * LLM_BLEND_WEIGHT + 5 * DETERMINISTIC_BLEND_WEIGHT) * 10) / 10);
    expect(blended).toBe(10);
  });

  it('returns deterministicSp when llmSp equals it', () => {
    const blended = blendEstimates(8, 8);
    expect(blended).toBe(8);
  });

  it('rounds to one decimal place', () => {
    const blended = blendEstimates(3.33, 7);
    // unblended: LLM value only, rounded to one decimal
    expect(blended).toBe(3.3);
  });
});

// ── Service + LLM integration ────────────────────────────────────────────────

describe('estimationService with LLM estimator', () => {
  it('populates llmEstimate and blendedSp when story is escalated and withLlm=true', async () => {
    const jira = createMockJiraClient();
    const confluence = createMockConfluenceClient();
    const db = openDb(':memory:');
    const mockEstimator = makeMockEstimator(MOCK_LLM_ESTIMATE);
    const service = createEstimationService(jira, confluence, db, mockEstimator);

    // PRJ-9001 is the mock escalated fixture (Hard tier — escalation.flagged will be true)
    // We use any valid mock key and check the escalation gate in the service
    const result = await service.runEstimate('PRJ-9001', { withLlm: true });

    if (result.escalation.flagged) {
      expect(result.llmEstimate).toBeDefined();
      expect(result.blendedSp).toBeDefined();
      expect(result.llmEstimate?.model).toBe('claude-opus-4-8');
      expect(result.blendedSp).toBe(
        blendEstimates(MOCK_LLM_ESTIMATE.pertSp, result.pert.pertSp),
      );
      expect(mockEstimator.deepDive).toHaveBeenCalledOnce();
    } else {
      // Non-escalated story — LLM should not have been called
      expect(result.llmEstimate).toBeUndefined();
      expect(mockEstimator.deepDive).not.toHaveBeenCalled();
    }
  });

  it('skips LLM when withLlm is false even if estimator is provided', async () => {
    const jira = createMockJiraClient();
    const confluence = createMockConfluenceClient();
    const db = openDb(':memory:');
    const mockEstimator = makeMockEstimator(MOCK_LLM_ESTIMATE);
    const service = createEstimationService(jira, confluence, db, mockEstimator);

    const result = await service.runEstimate('PRJ-9001', { withLlm: false });

    expect(result.llmEstimate).toBeUndefined();
    expect(result.blendedSp).toBeUndefined();
    expect(mockEstimator.deepDive).not.toHaveBeenCalled();
  });

  it('skips LLM when no estimator is provided even if withLlm=true', async () => {
    const jira = createMockJiraClient();
    const confluence = createMockConfluenceClient();
    const db = openDb(':memory:');
    const service = createEstimationService(jira, confluence, db); // no llmEstimator

    const result = await service.runEstimate('PRJ-9001', { withLlm: true });

    expect(result.llmEstimate).toBeUndefined();
    expect(result.blendedSp).toBeUndefined();
  });

  it('returns deterministic result when LLM fails (graceful degradation)', async () => {
    const jira = createMockJiraClient();
    const confluence = createMockConfluenceClient();
    const db = openDb(':memory:');
    const failingEstimator = makeFailingEstimator();
    const service = createEstimationService(jira, confluence, db, failingEstimator);

    // Should not throw even when LLM throws
    const result = await service.runEstimate('PRJ-9001', { withLlm: true });

    expect(result.issueKey).toBe('PRJ-9001');
    expect(result.pert.pertSp).toBeGreaterThan(0);
    expect(result.llmEstimate).toBeUndefined();
    expect(result.blendedSp).toBeUndefined();
  });
});

// ── Routes with LLM ──────────────────────────────────────────────────────────

describe('POST /estimates/:issueKey/recompute with withLlm', () => {
  it('accepts withLlm=true in the body and returns a valid result', async () => {
    const app = Fastify();
    const jira = createMockJiraClient();
    const confluence = createMockConfluenceClient();
    const db = openDb(':memory:');
    const mockEstimator = makeMockEstimator(MOCK_LLM_ESTIMATE);
    const service = createEstimationService(jira, confluence, db, mockEstimator);
    registerRoutes(app, service);

    const res = await app.inject({
      method: 'POST',
      url: '/estimates/PRJ-9001/recompute',
      payload: { withLlm: true },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.issueKey).toBe('PRJ-9001');
    // blendedSp and llmEstimate are present only when escalation.flagged
    if (body.escalation?.flagged) {
      expect(body.llmEstimate).toBeDefined();
      expect(body.blendedSp).toBeDefined();
    }
  });
});

// ── GET /estimates list endpoint ─────────────────────────────────────────────

describe('GET /estimates', () => {
  it('returns empty list before any estimates are computed', async () => {
    const app = Fastify();
    const service = createEstimationService(
      createMockJiraClient(),
      createMockConfluenceClient(),
      openDb(':memory:'),
    );
    registerRoutes(app, service);

    const res = await app.inject({ method: 'GET', url: '/estimates' });
    expect(res.statusCode).toBe(200);
    expect(res.json().estimates).toEqual([]);
  });

  it('returns stored estimates after recompute', async () => {
    const app = Fastify();
    const service = createEstimationService(
      createMockJiraClient(),
      createMockConfluenceClient(),
      openDb(':memory:'),
    );
    registerRoutes(app, service);

    await app.inject({ method: 'POST', url: '/estimates/PRJ-9001/recompute' });
    const res = await app.inject({ method: 'GET', url: '/estimates' });
    expect(res.statusCode).toBe(200);
    expect(res.json().estimates).toHaveLength(1);
    expect(res.json().estimates[0].issueKey).toBe('PRJ-9001');
  });

  it('respects the ?limit query parameter', async () => {
    const app = Fastify();
    const service = createEstimationService(
      createMockJiraClient(),
      createMockConfluenceClient(),
      openDb(':memory:'),
    );
    registerRoutes(app, service);

    // Seed two estimates
    await app.inject({ method: 'POST', url: '/estimates/PRJ-9001/recompute' });
    await app.inject({ method: 'POST', url: '/estimates/PRJ-9002/recompute' });

    const res = await app.inject({ method: 'GET', url: '/estimates?limit=1' });
    expect(res.statusCode).toBe(200);
    expect(res.json().estimates).toHaveLength(1);
  });
});
