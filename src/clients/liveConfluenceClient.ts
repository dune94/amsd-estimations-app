// ── Live Confluence Client ──────────────────────────────────────────────────
// Real Confluence Cloud REST API calls. Same credential convention as the
// live Jira client. Follows the durable "fetch current version, PUT
// version+1" publish pattern already proven in
// the reporting scripts — never hand-edit HTML, always
// go through this client.

import type { ConfluenceClient, ConfluencePageResult } from './types.js';

interface LiveConfluenceConfig {
  siteName: string;
  email: string;
  apiToken: string;
  spaceKey: string;
  parentPageId?: string;
}

export function createLiveConfluenceClient(config: LiveConfluenceConfig): ConfluenceClient {
  const baseUrl = `https://${config.siteName}.atlassian.net`;
  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');
  const headers = {
    Authorization: `Basic ${auth}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  return {
    async upsertEstimatePage(issueKey: string, title: string, htmlBody: string): Promise<ConfluencePageResult> {
      const searchRes = await fetch(
        `${baseUrl}/wiki/rest/api/content?title=${encodeURIComponent(title)}&spaceKey=${config.spaceKey}&expand=version`,
        { headers },
      );
      if (!searchRes.ok) {
        throw new Error(`Confluence search failed: ${searchRes.status} ${await searchRes.text()}`);
      }
      const searchData = (await searchRes.json()) as any;
      const existing = searchData.results?.[0];

      if (existing) {
        const putRes = await fetch(`${baseUrl}/wiki/rest/api/content/${existing.id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            id: existing.id,
            type: 'page',
            title,
            space: { key: config.spaceKey },
            version: { number: existing.version.number + 1 },
            body: { storage: { value: htmlBody, representation: 'storage' } },
          }),
        });
        if (!putRes.ok) {
          throw new Error(`Confluence update failed: ${putRes.status} ${await putRes.text()}`);
        }
        const updated = (await putRes.json()) as any;
        return { pageId: updated.id, url: `${baseUrl}${updated._links.webui}` };
      }

      const postRes = await fetch(`${baseUrl}/wiki/rest/api/content`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: 'page',
          title,
          space: { key: config.spaceKey },
          ...(config.parentPageId ? { ancestors: [{ id: config.parentPageId }] } : {}),
          body: { storage: { value: htmlBody, representation: 'storage' } },
        }),
      });
      if (!postRes.ok) {
        throw new Error(`Confluence create failed: ${postRes.status} ${await postRes.text()}`);
      }
      const created = (await postRes.json()) as any;
      return { pageId: created.id, url: `${baseUrl}${created._links.webui}` };
    },
  };
}
