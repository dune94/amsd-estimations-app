import { describe, expect, it } from 'vitest';
import type { AttachmentAssessor, RawAttachment } from '../src/engine/attachmentAssessor.js';
import type { IssueSignals } from '../src/engine/types.js';
import { createEstimationService } from '../src/service/estimationService.js';
import { createMockJiraClient } from '../src/clients/mockJiraClient.js';
import { createMockConfluenceClient } from '../src/clients/mockConfluenceClient.js';
import { openDb } from '../src/db/index.js';
import type { JiraClient, RawJiraIssue } from '../src/clients/types.js';
import { rbuConfig } from '../src/config/index.js';

const db = () => openDb(':memory:');

// ── Mock Jira client with attachments ─────────────────────────────────────────

function makeJiraWithAttachments(): JiraClient {
  const base = createMockJiraClient();
  const withAtt: RawJiraIssue = {
    key: 'PRJ-9001',
    fields: {
      summary: 'Update footer copyright year',
      descriptionText: 'Acceptance Criteria:\n- Footer displays the current year\n- No layout shift on any breakpoint',
      issuetype: { name: 'Task' },
      labels: [],
      priority: { name: 'Low' },
      rbu: rbuConfig.categories.Marketing.rbuValues[0],
      linkedIssueKeys: [],
      components: ['footer'],
      originalEstimateSp: null,
      tshirtSize: 'XS',
      storyPointsFallback: null,
      attachments: [
        { id: '1', filename: 'screenshot.png', mimeType: 'image/png', size: 12345, contentUrl: 'https://example.com/att/1' },
      ],
    },
  };
  return {
    ...base,
    async getIssue(key: string) {
      if (key === 'PRJ-9001') return withAtt;
      return base.getIssue(key);
    },
    async getAttachmentContent(_url: string): Promise<Buffer> {
      return Buffer.from('fake-png-bytes');
    },
  };
}

// ── Mock assessor helpers ──────────────────────────────────────────────────────

const MOCK_ASSESSMENT = {
  findings: [
    {
      filename: 'screenshot.png',
      observation: 'Screenshot shows the toast component in its current state with no visible focus ring.',
      estimationRelevance: 'Confirms the missing focus-management scope noted in the acceptance criteria.',
      severity: 'medium' as const,
    },
  ],
  pertImpact: {
    pessimisticDeltaSp: 1,
    rationale: 'Screenshot confirms one medium-severity gap; adds 1 SP to pessimistic scenario.',
  },
  model: 'mock',
};

function makeMockAssessor(response: Awaited<ReturnType<AttachmentAssessor['assess']>>): AttachmentAssessor {
  return {
    async assess(_signals: IssueSignals, _attachments: RawAttachment[]) {
      return response;
    },
  };
}

function makeThrowingAssessor(message: string): AttachmentAssessor {
  return {
    async assess() {
      throw new Error(message);
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('attachmentAssessor integration (via estimationService)', () => {
  it('attaches attachmentAssessment to the result when withAttachments=true and issue has attachments', async () => {
    const svc = createEstimationService(
      makeJiraWithAttachments(),
      createMockConfluenceClient(),
      db(),
      undefined,
      undefined,
      makeMockAssessor(MOCK_ASSESSMENT),
    );

    const result = await svc.runEstimate('PRJ-9001', { withAttachments: true });

    expect(result.attachmentAssessment).toBeDefined();
    expect(result.attachmentAssessment?.findings).toHaveLength(1);
    expect(result.attachmentAssessment?.findings[0].filename).toBe('screenshot.png');
    expect(result.attachmentAssessment?.pertImpact.pessimisticDeltaSp).toBe(1);
    expect(result.attachmentAssessmentError).toBeUndefined();
  });

  it('does not run the assessor when withAttachments is false', async () => {
    let called = false;
    const assessor: AttachmentAssessor = {
      async assess() { called = true; return MOCK_ASSESSMENT; },
    };

    const svc = createEstimationService(
      makeJiraWithAttachments(),
      createMockConfluenceClient(),
      db(),
      undefined,
      undefined,
      assessor,
    );

    const result = await svc.runEstimate('PRJ-9001', { withAttachments: false });

    expect(called).toBe(false);
    expect(result.attachmentAssessment).toBeUndefined();
  });

  it('does not run the assessor when no attachmentAssessor is supplied', async () => {
    const svc = createEstimationService(
      makeJiraWithAttachments(),
      createMockConfluenceClient(),
      db(),
    );

    const result = await svc.runEstimate('PRJ-9001', { withAttachments: true });

    expect(result.attachmentAssessment).toBeUndefined();
    expect(result.attachmentAssessmentError).toBeUndefined();
  });

  it('sets attachmentAssessmentError and does not throw when the assessor fails', async () => {
    const svc = createEstimationService(
      makeJiraWithAttachments(),
      createMockConfluenceClient(),
      db(),
      undefined,
      undefined,
      makeThrowingAssessor('image decode error'),
    );

    const result = await svc.runEstimate('PRJ-9001', { withAttachments: true });

    expect(result.attachmentAssessment).toBeUndefined();
    expect(result.attachmentAssessmentError).toContain('image decode error');
  });

  it('skips the assessor with a warning when the issue has no attachments', async () => {
    let called = false;
    const assessor: AttachmentAssessor = {
      async assess() { called = true; return MOCK_ASSESSMENT; },
    };

    // PRJ-9001 from the default mock has attachments: [] (empty)
    const svc = createEstimationService(
      createMockJiraClient(),
      createMockConfluenceClient(),
      db(),
      undefined,
      undefined,
      assessor,
    );

    const result = await svc.runEstimate('PRJ-9001', { withAttachments: true });

    expect(called).toBe(false);
    expect(result.attachmentAssessment).toBeUndefined();
  });
});
