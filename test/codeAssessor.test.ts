import { describe, expect, it } from 'vitest';
import type { CodeAssessor, SourceExcerpt } from '../src/engine/codeAssessor.js';
import type { IssueSignals } from '../src/engine/types.js';
import { createEstimationService } from '../src/service/estimationService.js';
import { createMockJiraClient } from '../src/clients/mockJiraClient.js';
import { createMockConfluenceClient } from '../src/clients/mockConfluenceClient.js';
import { openDb } from '../src/db/index.js';

const db = () => openDb(':memory:');

// ── Minimal IssueSignals fixture ──────────────────────────────────────────────

function makeSignals(overrides: Partial<IssueSignals> = {}): IssueSignals {
  return {
    key: 'PRJ-9999',
    issueType: 'Story',
    summary: 'Accessibility test story',
    description: 'Some description',
    acceptanceCriteria: ['Given X, when Y, then Z'],
    labels: ['GO', 'PI-12'],
    priority: 'Medium',
    rbuValue: null,
    linkedIssuesCount: 0,
    subtasksCount: 0,
    subtaskEstimatesSp: [],
    components: ['GO'],
    previousSp: null,
    ...overrides,
  };
}

const TOAST_EXCERPT: SourceExcerpt = {
  path: 'src/components/ToastNotification/ToastNotification.tsx',
  content: `import { ToastContainer } from 'react-toastify';
export function ToastNotification() {
  return (
    <ToastContainer
      position="BOTTOM_RIGHT"
      autoClose={5000}
      hideProgressBar
      pauseOnFocusLoss
      pauseOnHover
    />
  );
}
// No aria-live, no role="status", no aria-label anywhere in this file.`,
  note: 'call sites: 83',
};

// ── Mock assessor ─────────────────────────────────────────────────────────────

function makeMockAssessor(response: Awaited<ReturnType<CodeAssessor['assess']>>): CodeAssessor {
  return {
    async assess(_signals, _excerpts) {
      return response;
    },
  };
}

function makeThrowingAssessor(message: string): CodeAssessor {
  return {
    async assess() {
      throw new Error(message);
    },
  };
}

const MOCK_ASSESSMENT = {
  componentSummary: 'Shared ToastNotification wrapping react-toastify, used at 83 call sites across GO/MX/UP.',
  callSiteCount: 83,
  findings: [
    {
      title: 'Missing ARIA live region',
      standard: 'WCAG 2.2 SC 4.1.3',
      detail: 'No role="status" or aria-live attribute — screen readers will not announce notifications.',
      severity: 'high' as const,
    },
    {
      title: 'Fixed auto-close, no timing control',
      standard: 'WCAG 2.2 SC 2.2.1',
      detail: 'autoClose={5000} is hardcoded with no API for the caller to adjust or disable it.',
      severity: 'high' as const,
    },
  ],
  pertImpact: {
    pessimisticDeltaSp: 2,
    rationale: 'Two high-severity gaps affect the shared component and all 83 call sites; regression testing scope widens the pessimistic scenario.',
  },
  model: 'mock',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('codeAssessor integration (via estimationService)', () => {
  it('attaches codeAssessment to the result when withCodeAssessment=true and excerpts are provided', async () => {
    const svc = createEstimationService(
      createMockJiraClient(),
      createMockConfluenceClient(),
      db(),
      undefined,
      makeMockAssessor(MOCK_ASSESSMENT),
    );

    const result = await svc.runEstimate('PRJ-9001', {
      withCodeAssessment: true,
      sourceExcerpts: [TOAST_EXCERPT],
    });

    expect(result.codeAssessment).toBeDefined();
    expect(result.codeAssessment?.callSiteCount).toBe(83);
    expect(result.codeAssessment?.findings).toHaveLength(2);
    expect(result.codeAssessment?.findings[0].severity).toBe('high');
    expect(result.codeAssessment?.pertImpact.pessimisticDeltaSp).toBe(2);
    expect(result.codeAssessmentError).toBeUndefined();
  });

  it('does not run the assessor when withCodeAssessment is false', async () => {
    let called = false;
    const assessor: CodeAssessor = {
      async assess() {
        called = true;
        return MOCK_ASSESSMENT;
      },
    };

    const svc = createEstimationService(
      createMockJiraClient(),
      createMockConfluenceClient(),
      db(),
      undefined,
      assessor,
    );

    const result = await svc.runEstimate('PRJ-9001', { withCodeAssessment: false });

    expect(called).toBe(false);
    expect(result.codeAssessment).toBeUndefined();
  });

  it('does not run the assessor when no codeAssessor is supplied', async () => {
    const svc = createEstimationService(
      createMockJiraClient(),
      createMockConfluenceClient(),
      db(),
    );

    const result = await svc.runEstimate('PRJ-9001', {
      withCodeAssessment: true,
      sourceExcerpts: [TOAST_EXCERPT],
    });

    expect(result.codeAssessment).toBeUndefined();
    expect(result.codeAssessmentError).toBeUndefined();
  });

  it('sets codeAssessmentError and does not throw when the assessor fails', async () => {
    const svc = createEstimationService(
      createMockJiraClient(),
      createMockConfluenceClient(),
      db(),
      undefined,
      makeThrowingAssessor('network timeout'),
    );

    const result = await svc.runEstimate('PRJ-9001', {
      withCodeAssessment: true,
      sourceExcerpts: [TOAST_EXCERPT],
    });

    expect(result.codeAssessment).toBeUndefined();
    expect(result.codeAssessmentError).toContain('network timeout');
  });

  it('skips the assessor with a warning when sourceExcerpts is empty', async () => {
    let called = false;
    const assessor: CodeAssessor = {
      async assess() {
        called = true;
        return MOCK_ASSESSMENT;
      },
    };

    const svc = createEstimationService(
      createMockJiraClient(),
      createMockConfluenceClient(),
      db(),
      undefined,
      assessor,
    );

    const result = await svc.runEstimate('PRJ-9001', {
      withCodeAssessment: true,
      sourceExcerpts: [],
    });

    expect(called).toBe(false);
    expect(result.codeAssessment).toBeUndefined();
  });
});
