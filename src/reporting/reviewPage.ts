// ── Review page ────────────────────────────────────────────────────────────
// A server-rendered page for one batch: every story with its number and range, confidence and reasons, measured facts,
// drivers with their quotes, inputs that were not read, the baselines it is compared to, the version history, and the
// review actions as plain forms. Pure function; every interpolated value is HTML-escaped.

import type { BatchItem, EstimateVersion } from '../db/reviewStore.js';

export interface ReviewRow { version: EstimateVersion; history: EstimateVersion[] }

interface Est {
  sp?: number | null;
  reason?: string;
  noCodeFacts?: boolean;
  pert?: { o_sp: number; m_sp: number; p_sp: number; expected_sp: number } | null;
  levels?: { scope: string; complexity: string; risk: string } | null;
  scope?: { planning?: { base_br: number; upper_br: number; planning_br: number } } | null;
  drivers?: { complexity?: Driver[]; risk?: Driver[] } | null;
  inputs?: { attachments_not_read?: { filename: string; reason: string }[] } | null;
  confidence?: { level: string; reasons: { code: string; severity: string; text: string }[] };
  baseline?: { support: number; medianObservedSp: number | null; closest: { key: string; sp: number; blastRadius: number }[] };
  pertSp?: number;
}
interface Driver { driver: number; name?: string; date?: string; source?: string; quote: string }

const esc = (v: unknown): string =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const REVIEWABLE = ['DRAFT', 'IN_REVIEW'];

function driverList(label: string, ds: Driver[] | undefined): string {
  if (!ds || ds.length === 0) return `<p><b>${label}:</b> none</p>`;
  return `<p><b>${label}:</b></p><ul>${ds.map(d => `<li>${esc(d.driver)}. ${esc(d.name)} <small>(${esc(d.date)}, ${esc(d.source)})</small><blockquote>${esc(d.quote)}</blockquote></li>`).join('')}</ul>`;
}

function card(row: ReviewRow): string {
  const v = row.version;
  const e = (v.estimate ?? {}) as Est;
  const key = esc(v.issueKey);
  const body: string[] = [];

  if (v.mode === 'legacy') {
    body.push(`<p class="num"><b>${esc(e.pertSp ?? e.sp)} SP</b> (legacy engine)</p>`);
  } else if (v.noCodeFacts || e.sp === null || e.sp === undefined) {
    body.push(`<p class="num"><b>No code facts</b>: ${esc(e.reason ?? 'the code could not be measured')}</p>`);
  } else {
    const p = e.pert; const pl = e.scope?.planning;
    body.push(`<p class="num"><b>${esc(e.sp)} SP</b>${p ? ` &middot; range ${esc(p.o_sp)} / ${esc(p.m_sp)} / ${esc(p.p_sp)} SP, expected ${esc(p.expected_sp)} SP` : ''}</p>`);
    if (pl) body.push(`<p>Measured: BASE ${esc(pl.base_br)} &middot; UPPER ${esc(pl.upper_br)} &middot; planning ${esc(pl.planning_br)}${e.levels ? ` &middot; Scope ${esc(e.levels.scope)}, Complexity ${esc(e.levels.complexity)}, Risk ${esc(e.levels.risk)}` : ''}</p>`);
  }

  if (e.confidence) {
    body.push(`<p>Confidence: <b class="conf ${esc(e.confidence.level)}">${esc(e.confidence.level)}</b></p>`);
    if (e.confidence.reasons.length) body.push(`<ul>${e.confidence.reasons.map(r => `<li class="${esc(r.severity)}">${esc(r.text)}</li>`).join('')}</ul>`);
  }
  if (e.drivers) body.push(driverList('Complexity drivers', e.drivers.complexity), driverList('Risk drivers', e.drivers.risk));
  const unread = e.inputs?.attachments_not_read ?? [];
  if (unread.length) body.push(`<p><b>Not read:</b></p><ul>${unread.map(a => `<li>${esc(a.filename)} &mdash; ${esc(a.reason)}</li>`).join('')}</ul>`);
  if (e.baseline) {
    const b = e.baseline;
    body.push(`<p><b>Compared to:</b> ${b.support} delivered baseline(s) at the same levels${b.medianObservedSp !== null ? `, median ${esc(b.medianObservedSp)} SP` : ''}</p>`);
    if (b.closest.length) body.push(`<ul>${b.closest.map(c => `<li>${esc(c.key)}: ${esc(c.sp)} SP, blast radius ${esc(c.blastRadius)}</li>`).join('')}</ul>`);
  }

  body.push(`<table><tr><th>Version</th><th>Status</th><th>Mode</th><th>Notes</th><th>Created</th></tr>${row.history.map(h =>
    `<tr><td>${esc(h.version)}</td><td>${esc(h.status)}</td><td>${esc(h.mode)}</td><td>${esc(h.notes)}</td><td>${esc(h.createdAt)}</td></tr>`).join('')}</table>`);

  const forms: string[] = [];
  if (REVIEWABLE.includes(v.status)) {
    forms.push(`<form method="post" action="/review/${key}/accept"><button>Accept</button></form>`);
    forms.push(`<form method="post" action="/review/${key}/send-back"><textarea name="notes" rows="2" placeholder="Notes for the re-run" required></textarea><button>Send back</button></form>`);
  }
  if (v.status === 'ACCEPTED') forms.push(`<form method="post" action="/review/${key}/reopen"><button>Reopen</button></form>`);
  if (v.noCodeFacts && ['DRAFT', 'IN_REVIEW', 'SENT_BACK'].includes(v.status)) forms.push(`<form method="post" action="/review/${key}/use-legacy"><button>Use the legacy engine for this story</button></form>`);

  return `<section class="story" id="${key}"><h2>${key} <span class="st">${esc(v.status)}</span> <small>version ${esc(v.version)}</small></h2>${body.join('')}<div class="actions">${forms.join('')}</div></section>`;
}

/** Stories of the batch with no estimate to show yet (queued, running) or none to show at all (failed), with the reason. */
function waiting(items: BatchItem[], rows: ReviewRow[]): string {
  const shown = new Set(rows.map(r => r.version.issueKey));
  const open = items.filter(i => (i.state === 'QUEUED' || i.state === 'RUNNING' || i.state === 'FAILED') && !(i.state !== 'FAILED' && shown.has(i.issueKey)));
  if (open.length === 0) return '';
  return `<section class="story"><h2>Not estimated yet</h2><ul>${open.map(i =>
    `<li id="waiting-${esc(i.issueKey)}">${esc(i.issueKey)} <span class="st">${esc(i.state)}</span>${i.state === 'FAILED' && i.notes ? ` &mdash; ${esc(i.notes)}` : ''}</li>`).join('')}</ul></section>`;
}

export function renderReviewPage(batchId: string, rows: ReviewRow[], items: BatchItem[] = []): string {
  const b = esc(batchId);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Review ${b}</title><style>
body{font:14px/1.5 system-ui,sans-serif;max-width:980px;margin:0 auto;padding:16px;color:#1b1f24;background:#fff}
.story{border:1px solid #c8d0d8;border-radius:10px;padding:12px 16px;margin:0 0 16px}.st{font-size:12px;background:#eef;border-radius:999px;padding:2px 10px}
.num{font-size:16px}.conf.High{color:#1a7f37}.conf.Medium{color:#9a6700}.conf.Low{color:#cf222e}li.major{color:#cf222e}
blockquote{margin:2px 0 6px 12px;color:#4a5560}table{border-collapse:collapse;width:100%;font-size:12px}td,th{border:1px solid #d0d7de;padding:3px 6px;text-align:left}
.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:10px}form{display:flex;gap:6px;align-items:flex-start}textarea{width:260px}
</style></head><body><h1>Batch ${b}</h1>
<div class="actions"><form method="post" action="/batches/${b}/accept-high"><button>Accept all High-confidence stories</button></form>
<form method="post" action="/batches/${b}/send-back"><textarea name="notes" rows="2" placeholder="Notes for the whole batch" required></textarea><button>Send the whole batch back</button></form></div>
${waiting(items, rows)}${rows.length ? rows.map(card).join('') : '<p>No estimates yet; the batch is still running.</p>'}
</body></html>`;
}
