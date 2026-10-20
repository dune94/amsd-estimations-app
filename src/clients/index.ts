// ── Client factory ───────────────────────────────────────────────────────────
// Reads JIRA_MODE / CONFLUENCE_MODE ('mock' | 'live', default 'mock') and
// wires up the matching implementation. This is the single switch point —
// nothing else in the app should care which mode is active.

import { createLiveConfluenceClient } from './liveConfluenceClient.js';
import { createLiveJiraClient } from './liveJiraClient.js';
import { createMockConfluenceClient } from './mockConfluenceClient.js';
import { createMockJiraClient } from './mockJiraClient.js';
import type { ConfluenceClient, JiraClient } from './types.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export function createJiraClient(): JiraClient {
  const mode = process.env.JIRA_MODE ?? 'mock';
  if (mode === 'mock') return createMockJiraClient();

  return createLiveJiraClient({
    siteName: requireEnv('ATLASSIAN_SITE_NAME'),
    email: requireEnv('ATLASSIAN_USER_EMAIL'),
    apiToken: requireEnv('ATLASSIAN_API_TOKEN'),
  });
}

export function createConfluenceClient(): ConfluenceClient {
  const mode = process.env.CONFLUENCE_MODE ?? 'mock';
  if (mode === 'mock') return createMockConfluenceClient();

  return createLiveConfluenceClient({
    siteName: requireEnv('ATLASSIAN_SITE_NAME'),
    email: requireEnv('ATLASSIAN_USER_EMAIL'),
    apiToken: requireEnv('ATLASSIAN_API_TOKEN'),
    spaceKey: requireEnv('CONFLUENCE_ESTIMATES_SPACE_KEY'),
    parentPageId: process.env.CONFLUENCE_ESTIMATES_PARENT_PAGE_ID,
  });
}

export * from './types.js';
export { mapJiraIssueToSignals } from './mapIssue.js';
