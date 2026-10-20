// ── Mock Jira Client ─────────────────────────────────────────────────────────
// In-memory fixtures. Default mode for local dev/tests — no network, no
// credentials required.

import type { JiraClient, RawJiraIssue } from './types.js';
import { rbuConfig } from '../config/index.js';

const FIXTURES: Record<string, RawJiraIssue> = {
  'PRJ-9001': {
    key: 'PRJ-9001',
    fields: {
      summary: 'Update footer copyright year',
      descriptionText:
        'Acceptance Criteria:\n- Footer displays the current year\n- No layout shift on any breakpoint',
      issuetype: { name: 'Task' },
      labels: [],
      priority: { name: 'Low' },
      rbu: rbuConfig.categories.Marketing.rbuValues[0] ?? null,
      linkedIssueKeys: [],
      components: ['footer'],
      originalEstimateSp: null,
      tshirtSize: 'XS',
      storyPointsFallback: null,
      attachments: [],
    },
  },
  'PRJ-9002': {
    key: 'PRJ-9002',
    fields: {
      summary: 'New multi-step eligibility webform',
      descriptionText:
        'Acceptance Criteria:\n- 5 failure states handled\n- FR/EN copy included\n- Figma-driven multi-state UI',
      issuetype: { name: 'Story' },
      labels: [],
      priority: { name: 'High' },
      rbu: rbuConfig.categories.Operations.rbuValues[0] ?? null,
      linkedIssueKeys: ['PRJ-8990'],
      components: ['webform', 'eligibility-service'],
      originalEstimateSp: null,
      tshirtSize: null,
      storyPointsFallback: null,
      attachments: [],
    },
  },
  'PRJ-9003': {
    key: 'PRJ-9003',
    fields: {
      summary: 'Spike: evaluate new vendor identity-verification API',
      descriptionText: 'No acceptance criteria yet — this is a research spike.',
      issuetype: { name: 'Spike' },
      labels: ['spike', 'vendor'],
      priority: { name: 'Medium' },
      rbu: null,
      linkedIssueKeys: [],
      components: [],
      originalEstimateSp: null,
      tshirtSize: null,
      storyPointsFallback: null,
      attachments: [],
    },
  },
};

export function createMockJiraClient(): JiraClient {
  const comments: Record<string, string[]> = {};

  return {
    async getIssue(key: string): Promise<RawJiraIssue> {
      const fixture = FIXTURES[key];
      if (!fixture) {
        throw new Error(`Mock Jira: no fixture for issue "${key}". Known fixtures: ${Object.keys(FIXTURES).join(', ')}`);
      }
      return fixture;
    },
    async addComment(key: string, bodyText: string): Promise<void> {
      (comments[key] ??= []).push(bodyText);
    },
    async searchByJql(): Promise<RawJiraIssue[]> {
      return Object.values(FIXTURES);
    },
    async getAttachmentContent(_url: string): Promise<Buffer> {
      return Buffer.alloc(0);
    },
  };
}
