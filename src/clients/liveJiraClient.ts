// ── Live Jira Client ─────────────────────────────────────────────────────────
// Real Jira Cloud REST API v3 calls. Credentials from env
// (ATLASSIAN_SITE_NAME / ATLASSIAN_USER_EMAIL / ATLASSIAN_API_TOKEN) —
// same convention already used by the reporting scripts. Never
// embeds credentials in source; read only from process.env at call time.

import type { JiraClient, RawJiraIssue } from './types.js';

const RBU_FIELD = 'customfield_10669';
const ORIGINAL_ESTIMATE_FIELD = 'customfield_10410';
const TSHIRT_FIELD = 'customfield_10409';
const STORY_POINTS_FALLBACK_FIELD = 'customfield_10052';

function stripHtml(html: string): string {
  return html
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Builds a minimal Atlassian Document Format body from plain text paragraphs, for comment posting. */
function textToAdf(text: string) {
  const paragraphs = text.split(/\n+/).filter(Boolean);
  return {
    type: 'doc',
    version: 1,
    content: paragraphs.map(p => ({
      type: 'paragraph',
      content: [{ type: 'text', text: p }],
    })),
  };
}

interface LiveJiraConfig {
  siteName: string;
  email: string;
  apiToken: string;
}

export function createLiveJiraClient(config: LiveJiraConfig): JiraClient {
  const baseUrl = `https://${config.siteName}.atlassian.net`;
  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');
  const headers = {
    Authorization: `Basic ${auth}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  const client: JiraClient = {
    async getIssue(key: string): Promise<RawJiraIssue> {
      const fields = [
        'summary',
        'description',
        'issuetype',
        'labels',
        'priority',
        'issuelinks',
        'subtasks',
        'attachment',
        RBU_FIELD,
        ORIGINAL_ESTIMATE_FIELD,
        TSHIRT_FIELD,
        STORY_POINTS_FALLBACK_FIELD,
      ].join(',');

      const res = await fetch(
        `${baseUrl}/rest/api/3/issue/${key}?fields=${fields}&expand=renderedFields`,
        { headers },
      );
      if (!res.ok) {
        throw new Error(`Jira getIssue(${key}) failed: ${res.status} ${await res.text()}`);
      }
      const data = (await res.json()) as any;
      const descriptionHtml: string = data.renderedFields?.description ?? '';

      return {
        key: data.key,
        fields: {
          summary: data.fields?.summary ?? '',
          descriptionText: stripHtml(descriptionHtml),
          issuetype: data.fields?.issuetype,
          labels: data.fields?.labels ?? [],
          priority: data.fields?.priority,
          rbu: data.fields?.[RBU_FIELD]?.value ?? data.fields?.[RBU_FIELD] ?? null,
          linkedIssueKeys: (data.fields?.issuelinks ?? [])
            .map((l: any) => l.outwardIssue?.key ?? l.inwardIssue?.key)
            .filter(Boolean),
          components: (data.fields?.components ?? []).map((c: any) => c.name).filter(Boolean),
          originalEstimateSp: data.fields?.[ORIGINAL_ESTIMATE_FIELD] ?? null,
          tshirtSize: data.fields?.[TSHIRT_FIELD]?.value ?? data.fields?.[TSHIRT_FIELD] ?? null,
          storyPointsFallback: data.fields?.[STORY_POINTS_FALLBACK_FIELD] ?? null,
          attachments: (data.fields?.attachment ?? []).map((a: any) => ({
            id: String(a.id ?? ''),
            filename: String(a.filename ?? ''),
            mimeType: String(a.mimeType ?? 'application/octet-stream'),
            size: Number(a.size ?? 0),
            contentUrl: String(a.content ?? ''),
          })),
        },
      };
    },

    async getAttachmentContent(url: string): Promise<Buffer> {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        throw new Error(`Jira getAttachmentContent failed: ${res.status} ${url}`);
      }
      return Buffer.from(await res.arrayBuffer());
    },

    async addComment(key: string, bodyText: string): Promise<void> {
      const res = await fetch(`${baseUrl}/rest/api/3/issue/${key}/comment`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ body: textToAdf(bodyText) }),
      });
      if (!res.ok) {
        throw new Error(`Jira addComment(${key}) failed: ${res.status} ${await res.text()}`);
      }
    },

    async searchByJql(jql: string, maxResults = 50): Promise<RawJiraIssue[]> {
      const res = await fetch(`${baseUrl}/rest/api/3/search/jql?expand=renderedFields`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jql,
          maxResults,
          fields: [
            'summary',
            'description',
            'issuetype',
            'labels',
            'priority',
            'components',
            'issuelinks',
            'subtasks',
            RBU_FIELD,
            ORIGINAL_ESTIMATE_FIELD,
            TSHIRT_FIELD,
            STORY_POINTS_FALLBACK_FIELD,
          ],
        }),
      });
      if (!res.ok) {
        throw new Error(`Jira searchByJql failed: ${res.status} ${await res.text()}`);
      }
      const data = (await res.json()) as any;
      // FIX (2026-09-16): /search/jql does not honour expand=renderedFields, so
      // renderedFields.description came back empty and every batch estimate was
      // made from the title alone (PRJ-1 batch run: "zero acceptance
      // criteria", 8.5 SP vs 17.7 via /issue/{key}). Re-fetch each hit through
      // getIssue(), which uses /issue/{key}?expand=renderedFields and works.
      const keys: string[] = (data.issues ?? []).map((issue: any) => issue.key);
      const full: RawJiraIssue[] = [];
      for (const key of keys) {
        full.push(await client.getIssue(key));
      }
      return full;
    },
  };
  return client;
}
