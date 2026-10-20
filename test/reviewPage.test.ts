import { describe, expect, it } from 'vitest';
import type { EstimateVersion } from '../src/db/reviewStore.js';
import { renderReviewPage, type ReviewRow } from '../src/reporting/reviewPage.js';

function version(over: Partial<EstimateVersion> = {}, estimate: Record<string, unknown> = {}): EstimateVersion {
  return {
    issueKey: 'K-1', version: 1, batchId: 'b_1', status: 'IN_REVIEW', mode: 'formula', noCodeFacts: false, storyHash: 'h', notes: null,
    createdAt: '2026-10-20T10:00:00Z',
    estimate: {
      issueKey: 'K-1', mode: 'formula', sp: 5, noCodeFacts: false,
      pert: { o_br: 22, m_br: 31, p_br: 36, expected_br: 30, o_sp: 5, m_sp: 5, p_sp: 8, expected_sp: 5 },
      levels: { scope: 'High', complexity: 'High', risk: 'Low' },
      scope: { planning: { base_br: 22, upper_br: 26, planning_br: 31 } },
      drivers: {
        complexity: [{ driver: 2, name: 'Three or more rules', date: '2026-10-01', source: 'comment', quote: 'three or more rules apply here' }],
        risk: [], dropped: [], c_count: 2, r_count: 0,
      },
      inputs: { attachments_not_read: [{ filename: 'notes.msg', reason: 'type .msg not read' }] },
      confidence: { level: 'Medium', reasons: [{ code: 'attachments_unread', severity: 'minor', text: 'Not read: notes.msg (type .msg not read).' }] },
      baseline: { support: 4, observedSp: [3, 5, 5, 8], medianObservedSp: 5, closest: [{ key: 'B-7', sp: 5, blastRadius: 21 }] },
      ...estimate,
    },
    ...over,
  };
}
const row = (v = version(), history: EstimateVersion[] = [v]): ReviewRow => ({ version: v, history });

describe('review page', () => {
  it('escapes HTML in notes, quotes, reasons and file names', () => {
    const evil = '<script>alert(1)</script>';
    const v = version({ notes: evil }, {
      drivers: { complexity: [{ driver: 2, name: evil, date: 'd', source: 's', quote: evil }], risk: [], dropped: [], c_count: 1, r_count: 0 },
      inputs: { attachments_not_read: [{ filename: evil, reason: evil }] },
      confidence: { level: 'Low', reasons: [{ code: 'x', severity: 'major', text: evil }] },
    });
    const html = renderReviewPage('b_1', [row(v, [v])]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('shows the number, the range, the measured facts and the drivers with their quotes', () => {
    const html = renderReviewPage('b_1', [row()]);
    expect(html).toContain('K-1');
    expect(html).toMatch(/5\s*SP/);
    expect(html).toContain('BASE 22');
    expect(html).toContain('UPPER 26');
    expect(html).toContain('three or more rules apply here');
    expect(html).toContain('2026-10-01');
  });

  it('shows the confidence level with every reason and each unread attachment with its reason', () => {
    const html = renderReviewPage('b_1', [row()]);
    expect(html).toContain('Medium');
    expect(html).toContain('Not read: notes.msg');
    expect(html).toContain('notes.msg');
    expect(html).toContain('type .msg not read');
  });

  it('shows the compared-to baselines and the version history with notes', () => {
    const v1 = version({ version: 1, status: 'SENT_BACK', notes: 'check the second rule' });
    const v2 = version({ version: 2 });
    const html = renderReviewPage('b_1', [row(v2, [v1, v2])]);
    expect(html).toContain('B-7');
    expect(html).toContain('median 5');
    expect(html).toContain('check the second rule');
    expect(html).toContain('SENT_BACK');
  });

  it('offers accept and send back for a story in review, and reopen for an accepted one', () => {
    const open = renderReviewPage('b_1', [row()]);
    expect(open).toContain('action="/review/K-1/accept"');
    expect(open).toContain('action="/review/K-1/send-back"');
    expect(open).not.toContain('/review/K-1/reopen');
    const accepted = renderReviewPage('b_1', [row(version({ status: 'ACCEPTED' }))]);
    expect(accepted).toContain('action="/review/K-1/reopen"');
    expect(accepted).not.toContain('/review/K-1/accept"');
  });

  it('offers the batch actions and the legacy fallback for a story with no code facts', () => {
    const none = version({ noCodeFacts: true }, { sp: null, pert: null, noCodeFacts: true, reason: 'timeout', scope: null, levels: null });
    const html = renderReviewPage('b_1', [row(none)]);
    expect(html).toContain('action="/batches/b_1/accept-high"');
    expect(html).toContain('action="/batches/b_1/send-back"');
    expect(html).toContain('action="/review/K-1/use-legacy"');
    expect(html).toContain('timeout');
  });

  it('lists stories that have no estimate yet with their state and failure reason, escaped', () => {
    const items = [
      { issueKey: 'K-2', state: 'QUEUED' as const, notes: null },
      { issueKey: 'K-3', state: 'FAILED' as const, notes: '<b>engine</b> failed' },
      { issueKey: 'K-4', state: 'RUNNING' as const, notes: null },
      { issueKey: 'K-1', state: 'DONE' as const, notes: null },
    ];
    const html = renderReviewPage('b_1', [row()], items);
    expect(html).toContain('K-2'); expect(html).toContain('QUEUED');
    expect(html).toContain('K-3'); expect(html).toContain('FAILED');
    expect(html).toContain('&lt;b&gt;engine&lt;/b&gt; failed');
    expect(html).toContain('K-4'); expect(html).toContain('RUNNING');
    expect(html).not.toContain('<b>engine</b>');
    expect(html.match(/id="waiting-K-1"/)).toBeNull();
  });
});
