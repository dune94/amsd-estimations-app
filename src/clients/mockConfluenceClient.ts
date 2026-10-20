// ── Mock Confluence Client ──────────────────────────────────────────────────
// In-memory fixtures. Default mode for local dev/tests — no network, no
// credentials required.

import type { ConfluenceClient, ConfluencePageResult } from './types.js';

export function createMockConfluenceClient(): ConfluenceClient {
  const pages = new Map<string, ConfluencePageResult & { body: string }>();

  return {
    async upsertEstimatePage(issueKey: string, title: string, htmlBody: string): Promise<ConfluencePageResult> {
      const existing = pages.get(issueKey);
      const pageId = existing?.pageId ?? `mock-page-${issueKey}`;
      const url = existing?.url ?? `https://mock.atlassian.net/wiki/spaces/MOCK/pages/${pageId}`;
      pages.set(issueKey, { pageId, url, body: htmlBody });
      return { pageId, url };
    },
  };
}
