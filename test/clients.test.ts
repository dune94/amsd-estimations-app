import { describe, expect, it } from 'vitest';
import { createMockJiraClient } from '../src/clients/mockJiraClient.js';
import { createMockConfluenceClient } from '../src/clients/mockConfluenceClient.js';
import { mapJiraIssueToSignals } from '../src/clients/mapIssue.js';

describe('createMockJiraClient', () => {
  it('returns a known fixture for a valid key', async () => {
    const client = createMockJiraClient();
    const issue = await client.getIssue('PRJ-9001');
    expect(issue.key).toBe('PRJ-9001');
  });

  it('throws a helpful error for an unknown key', async () => {
    const client = createMockJiraClient();
    await expect(client.getIssue('NOPE-1')).rejects.toThrow(/no fixture/);
  });

  it('maps the spike fixture to a Hard tier via mapJiraIssueToSignals + acceptance-criteria absence', async () => {
    const client = createMockJiraClient();
    const raw = await client.getIssue('PRJ-9003');
    const signals = mapJiraIssueToSignals(raw);
    expect(signals.acceptanceCriteria).toEqual([]);
    expect(signals.labels).toContain('spike');
  });

  it('searchByJql returns all fixtures (mock mode ignores the JQL string)', async () => {
    const client = createMockJiraClient();
    const results = await client.searchByJql('project = KEY');
    expect(results.length).toBeGreaterThanOrEqual(3);
  });
});

describe('createMockConfluenceClient', () => {
  it('creates a page on first upsert and reuses the same pageId on subsequent upserts', async () => {
    const client = createMockConfluenceClient();
    const first = await client.upsertEstimatePage('PRJ-1', 'Estimate: PRJ-1', '<p>v1</p>');
    const second = await client.upsertEstimatePage('PRJ-1', 'Estimate: PRJ-1', '<p>v2</p>');
    expect(second.pageId).toBe(first.pageId);
    expect(second.url).toBe(first.url);
  });
});
