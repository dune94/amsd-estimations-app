// ── Local HTML artifact renderer ──────────────────────────────────────────────
// Produces a self-contained, styled HTML estimation artifact matching the
// format of the existing generated_artifacts/ files.
// No external dependencies — all CSS and JS are inlined.

import type { EstimateResult } from '../engine/types.js';

const TSHIRT_COLORS: Record<string, string> = {
  XS: '#6c757d',
  S: '#17a2b8',
  M: '#28a745',
  L: '#fd7e14',
  XL: '#dc3545',
};

const TSHIRT_CARD_CLASS: Record<string, string> = {
  XS: 'card-xs',
  S: 'card-small',
  M: 'card-medium',
  L: 'card-large',
  XL: 'card-xl',
};

const PRIORITY_ORDER = ['Highest', 'High', 'Medium', 'Low', 'Lowest'];

const PRIORITY_BADGE_CLASS: Record<string, string> = {
  Highest: 'priority-highest',
  High: 'priority-high',
  Medium: 'priority-medium',
  Low: 'priority-low',
  Lowest: 'priority-lowest',
};

function esc(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function confidence(r: EstimateResult): { label: string; emoji: string; note: string } {
  if (r.escalation.flagged) {
    return { label: 'Low', emoji: '🔴', note: r.escalation.reasons[0] ?? 'Escalation triggered' };
  }
  if (r.pert.convergence.converged) {
    return { label: 'High', emoji: '🟢', note: 'OpenSpec and SpecKit lenses converged.' };
  }
  return {
    label: 'Medium',
    emoji: '🟡',
    note: `${r.pert.convergence.gapPct}% divergence between OpenSpec and SpecKit lenses.`,
  };
}

function tshirtBadgeSelect(current: string): string {
  return ['XS', 'S', 'M', 'L', 'XL']
    .map(t => `<option value="${t}"${t === current ? ' selected' : ''}>${t}</option>`)
    .join('');
}

function renderCard(r: EstimateResult, siteName: string): string {
  const key = r.issueKey;
  const summary = r.summary || key;
  const priority = r.priority || 'Medium';
  const issueType = r.issueType || 'Story';
  const { pert, tshirt, effort, rbu, escalation, baselineComparator, previousSp, deltaSp } = r;

  const tshirtColor = TSHIRT_COLORS[tshirt] ?? '#28a745';
  const cardClass = TSHIRT_CARD_CLASS[tshirt] ?? 'card-medium';
  const priorityClass = PRIORITY_BADGE_CLASS[priority] ?? 'priority-medium';
  const conf = confidence(r);

  const maxP = pert.pessimistic.value || 1;
  const oBarPct = Math.min(100, Math.round((pert.optimistic.value / maxP) * 100));
  const mBarPct = Math.min(100, Math.round((pert.mostLikely.value / maxP) * 100));

  // Flags
  const flagHtml: string[] = [];
  if (escalation.flagged) flagHtml.push('<span class="flag" style="background:#dc3545">ESCALATED</span>');
  if (effort.acStatus === 'missing') flagHtml.push('<span class="flag" style="background:#fd7e14">NO ACs</span>');
  if (effort.acStatus === 'ambiguous') flagHtml.push('<span class="flag" style="background:#ffc107;color:#333">AMBIGUOUS ACs</span>');
  if (!pert.convergence.converged) flagHtml.push(`<span class="flag" style="background:#6c757d">DIVERGED ${pert.convergence.gapPct}%</span>`);

  // Delta
  let deltaStr = '';
  if (previousSp !== null && deltaSp !== null) {
    const sign = deltaSp >= 0 ? '+' : '';
    const cls = deltaSp >= 0 ? 'delta-up' : 'delta-down';
    deltaStr = ` <span class="${cls}">${sign}${deltaSp} SP vs prev ${previousSp}</span>`;
  }

  // Rationale bullets — effort reasons + baseline
  const rationaleItems: string[] = [...effort.reasons.slice(0, 4)];
  if (baselineComparator) {
    rationaleItems.push(
      `Nearest baseline: ${baselineComparator.key} (${baselineComparator.sp} SP, ` +
      `${(baselineComparator.similarityScore * 100).toFixed(0)}% similar) — ${baselineComparator.description}`,
    );
  }

  // LLM block (optional)
  const llmHtml = r.llmEstimate
    ? `<div class="llm-block">🤖 <strong>AI deep-dive:</strong> ` +
      `PERT ${r.llmEstimate.pertSp} SP (O:${r.llmEstimate.optimistic} / M:${r.llmEstimate.mostLikely} / P:${r.llmEstimate.pessimistic}) &nbsp;·&nbsp; ` +
      `Blended: <strong>${r.blendedSp} SP</strong> &nbsp;` +
      `<em>${esc(r.llmEstimate.rationale[0] ?? '')}</em></div>`
    : '';

  return `
<div class="card ${cardClass}" id="card-${esc(key)}">
  <div class="card-header">
    <div class="card-meta">
      <span class="priority-badge ${priorityClass}">${esc(priority)}</span>
      <a class="jira-link" href="https://${esc(siteName)}.atlassian.net/browse/${esc(key)}" target="_blank">${esc(key)}</a>
      <span class="story-type">${esc(issueType.toLowerCase())}</span>
      ${flagHtml.join(' ')}
    </div>
    <h3>${esc(summary)}</h3>
    <div class="card-meta" style="margin-top:4px">
      <span class="rbu-tag">${esc(rbu.category)}</span>
      <span class="effort-tag">Effort: <strong>${esc(effort.tier)}</strong></span>
      <span class="ac-tag">AC: ${esc(effort.acStatus)}${deltaStr}</span>
    </div>
  </div>
  <div class="card-body">
    <div class="sizing-panel">
      <div class="tshirt-badge" style="background:${tshirtColor}">${esc(tshirt)}</div>
      <div class="pert-block">
        <div class="pert-row">
          <span class="pert-label">PERT</span>
          <strong>${pert.pertSp} SP</strong>
          <span class="pert-range">O:${pert.optimistic.value} / M:${pert.mostLikely.value} / P:${pert.pessimistic.value}</span>
        </div>
        <div class="pert-bar">
          <div class="pert-bar-o" style="width:${oBarPct}%" title="Optimistic ${pert.optimistic.value} SP"></div>
          <div class="pert-bar-m" style="width:${mBarPct}%" title="Most Likely ${pert.mostLikely.value} SP"></div>
        </div>
        <div class="confidence-row">${conf.emoji} <strong>${conf.label}</strong> confidence &mdash; <em>${esc(conf.note)}</em>
          &nbsp;|&nbsp; 68% CI: ${pert.ci68[0]}–${pert.ci68[1]} SP &nbsp;|&nbsp; 95% CI: ${pert.ci95[0]}–${pert.ci95[1]} SP
        </div>
      </div>
    </div>
    <div class="rationale"><strong>Rationale:</strong><ul>${rationaleItems.map(l => `<li>${esc(l)}</li>`).join('')}</ul></div>
    ${llmHtml}
  </div>
  <div class="card-actions">
    <button class="btn btn-confirm" onclick="confirmCard('${esc(key)}','${esc(tshirt)}','${pert.pertSp}')">&#10003; CONFIRM &nbsp; ${esc(tshirt)} / ${pert.pertSp} SP</button>
    <button class="btn btn-adjust" onclick="toggleAdjust('${esc(key)}')">&#9998; ADJUST</button>
    <div class="adjust-form" id="adjust-${esc(key)}">
      <label>T-Shirt: <select id="adj-tshirt-${esc(key)}">${tshirtBadgeSelect(tshirt)}</select></label>
      <label>SP: <input id="adj-sp-${esc(key)}" type="number" value="${pert.pertSp}" min="0" max="55" style="width:60px"></label>
      <label>Note: <input id="adj-note-${esc(key)}" type="text" placeholder="reason" style="width:200px"></label>
      <button class="btn btn-save" onclick="saveAdjust('${esc(key)}')">Save</button>
    </div>
  </div>
</div>`;
}

export interface HtmlArtifactOptions {
  piName?: string;
  jql?: string;
  siteName?: string;
}

export function renderHtmlArtifact(results: EstimateResult[], opts: HtmlArtifactOptions = {}): string {
  const piName = opts.piName ?? 'PI Estimations';
  const siteName = opts.siteName ?? process.env.ATLASSIAN_SITE_NAME ?? '';
  const now = new Date().toISOString().replace('T', ' ').slice(0, 16);

  const totalSp = Math.round(results.reduce((s, r) => s + r.pert.pertSp, 0) * 10) / 10;
  const escalatedCount = results.filter(r => r.escalation.flagged).length;
  const llmCount = results.filter(r => r.llmEstimate).length;

  // T-shirt distribution
  const tsDist: Record<string, number> = { XS: 0, S: 0, M: 0, L: 0, XL: 0 };
  for (const r of results) {
    if (r.tshirt in tsDist) tsDist[r.tshirt]++;
  }
  const tsDistHtml = Object.entries(tsDist)
    .map(([t, n]) => `<span class="ts-count ts-${t.toLowerCase()}">${t}: ${n}</span>`)
    .join(' ');

  // Stats grid
  const statsHtml = `
<div class="stats-grid">
  <div class="stat-card"><div class="stat-num">${results.length}</div><div class="stat-label">Stories estimated</div><div class="stat-sub">${tsDistHtml}</div></div>
  <div class="stat-card"><div class="stat-num">${totalSp}</div><div class="stat-label">Total PERT SP</div><div class="stat-sub">Sum across all stories</div></div>
  <div class="stat-card"><div class="stat-num">${escalatedCount}</div><div class="stat-label">Escalated</div><div class="stat-sub">Wide divergence or vague ACs</div></div>
  ${llmCount > 0 ? `<div class="stat-card"><div class="stat-num">${llmCount}</div><div class="stat-label">AI deep-dived</div><div class="stat-sub">LLM PERT + blended SP</div></div>` : ''}
</div>`;

  // Breakdown table by priority
  const byPriority = new Map<string, EstimateResult[]>();
  for (const r of results) {
    const p = r.priority || 'Unknown';
    if (!byPriority.has(p)) byPriority.set(p, []);
    byPriority.get(p)!.push(r);
  }
  const breakdownRows = [...PRIORITY_ORDER, 'Unknown']
    .filter(p => byPriority.has(p))
    .map(p => {
      const items = byPriority.get(p)!;
      const pSp = Math.round(items.reduce((s, r) => s + r.pert.pertSp, 0) * 10) / 10;
      const minO = Math.min(...items.map(r => r.pert.optimistic.value));
      const maxP = Math.max(...items.map(r => r.pert.pessimistic.value));
      const flagged = items.filter(r => r.escalation.flagged).length;
      return `<tr><td><strong>${esc(p)}</strong></td><td>${items.length}</td><td>${minO}–${maxP}</td><td><strong>${pSp}</strong></td><td>${flagged}</td></tr>`;
    })
    .join('');

  const breakdownHtml = `
<table class="breakdown-table">
  <thead><tr><th>Priority</th><th>Stories</th><th>SP Range (O–P)</th><th>PERT SP</th><th>⚠ Escalated</th></tr></thead>
  <tbody>${breakdownRows}</tbody>
  <tfoot><tr><td><strong>Total</strong></td><td><strong>${results.length}</strong></td><td>—</td><td><strong>${totalSp}</strong></td><td><strong>${escalatedCount}</strong></td></tr></tfoot>
</table>`;

  // Per-story cards grouped by priority
  const cardSections = [...PRIORITY_ORDER, 'Unknown']
    .filter(p => byPriority.has(p))
    .map(p => {
      const items = byPriority.get(p)!;
      const cards = items.map(r => renderCard(r, siteName)).join('\n');
      return `<div class="section-header"><h2>${esc(p)} (${items.length})</h2></div>\n${cards}`;
    })
    .join('\n');

  const jqlLine = opts.jql ? `&nbsp;·&nbsp; JQL: <code>${esc(opts.jql)}</code>` : '';
  const llmLine = llmCount > 0
    ? `&nbsp;·&nbsp; ${llmCount} AI deep-dived (LLM × 0.4 + deterministic × 0.6)`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(piName)} | Estimations</title>
<style>
:root{--bg:#f4f5f7;--card-bg:#fff;--hdr:#0052cc;--text:#172b4d;--border:#dfe1e6;--shadow:0 1px 3px rgba(0,0,0,.12)}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);font-size:14px}
header{background:var(--hdr);color:#fff;padding:20px 32px}
header h1{font-size:22px;font-weight:700}
header p{opacity:.85;margin-top:4px;font-size:13px}
.main{max-width:1100px;margin:0 auto;padding:24px 16px}
.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:24px}
.stat-card{background:#fff;border:1px solid var(--border);border-radius:8px;padding:16px;text-align:center}
.stat-num{font-size:32px;font-weight:700;color:var(--hdr)}
.stat-label{font-size:12px;color:#6b778c;margin-top:2px}
.stat-sub{font-size:11px;color:#6b778c;margin-top:4px}
.ts-count{display:inline-block;padding:1px 6px;border-radius:10px;font-size:11px;font-weight:600;margin:2px}
.ts-xs{background:#e0e0e0;color:#555}
.ts-s{background:#d1ecf1;color:#0c5460}
.ts-m{background:#d4edda;color:#155724}
.ts-l{background:#fff3cd;color:#856404}
.ts-xl{background:#f8d7da;color:#721c24}
.breakdown-table{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;border:1px solid var(--border);margin-bottom:24px;font-size:13px}
.breakdown-table th{background:#f4f5f7;padding:10px 12px;text-align:left;border-bottom:2px solid var(--border)}
.breakdown-table td{padding:9px 12px;border-bottom:1px solid var(--border)}
.breakdown-table tfoot td{background:#e6f0ff;font-weight:700}
#review-summary{background:#fff;border:2px solid var(--hdr);border-radius:8px;padding:20px;margin-bottom:24px}
#review-summary h2{font-size:16px;color:var(--hdr);margin-bottom:12px}
#review-summary table{width:100%;border-collapse:collapse;font-size:13px}
#review-summary th{background:#f4f5f7;padding:8px;text-align:left;border-bottom:2px solid var(--border)}
#review-summary td{padding:7px 8px;border-bottom:1px solid var(--border)}
.empty-note{color:#6b778c;font-style:italic;font-size:13px;margin:8px 0}
.section-header{margin:28px 0 12px;padding:10px 0;border-bottom:2px solid var(--hdr)}
.section-header h2{font-size:16px;color:var(--hdr);font-weight:700}
.card{background:var(--card-bg);border-radius:8px;box-shadow:var(--shadow);margin-bottom:16px;border-left:5px solid #dfe1e6;transition:.2s}
.card.confirmed{border-left-color:#28a745;opacity:.85}
.card-xs{border-left-color:#6c757d}
.card-small{border-left-color:#17a2b8}
.card-medium{border-left-color:#28a745}
.card-large{border-left-color:#fd7e14}
.card-xl{border-left-color:#dc3545}
.card-header{padding:14px 16px 10px;border-bottom:1px solid var(--border)}
.card-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px}
.card-header h3{font-size:14px;font-weight:600;line-height:1.4}
.priority-badge{padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;text-transform:uppercase}
.priority-highest{background:#ffebe6;color:#bf2600}
.priority-high{background:#fff0b3;color:#974f0c}
.priority-medium{background:#e3fcef;color:#006644}
.priority-low{background:#f4f5f7;color:#42526e}
.priority-lowest{background:#f4f5f7;color:#6b778c}
.jira-link{color:var(--hdr);font-weight:600;text-decoration:none;font-size:12px}
.jira-link:hover{text-decoration:underline}
.story-type{font-size:11px;color:#6b778c;background:#f4f5f7;padding:2px 6px;border-radius:4px}
.rbu-tag{font-size:11px;color:#6b778c}
.effort-tag{font-size:11px;color:#42526e}
.ac-tag{font-size:11px;color:#42526e}
.flag{padding:2px 7px;border-radius:10px;font-size:10px;font-weight:700;color:#fff}
.delta-up{color:#bf2600;font-weight:600}
.delta-down{color:#006644;font-weight:600}
.card-body{padding:14px 16px}
.sizing-panel{display:flex;align-items:flex-start;gap:16px;margin-bottom:12px;flex-wrap:wrap}
.tshirt-badge{width:52px;height:52px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;color:#fff;flex-shrink:0}
.pert-block{flex:1;min-width:200px}
.pert-row{display:flex;align-items:baseline;gap:10px;margin-bottom:6px;flex-wrap:wrap}
.pert-label{font-size:11px;color:#6b778c;text-transform:uppercase}
.pert-row strong{font-size:18px}
.pert-range{font-size:12px;color:#6b778c}
.pert-bar{height:6px;background:#f4f5f7;border-radius:3px;margin-bottom:6px;position:relative;overflow:hidden}
.pert-bar-o{position:absolute;height:100%;background:#17a2b8;border-radius:3px;opacity:.5}
.pert-bar-m{position:absolute;height:100%;background:#28a745;border-radius:3px;opacity:.7}
.confidence-row{font-size:12px;color:#6b778c}
.rationale{font-size:13px;margin-bottom:10px;line-height:1.5}
.rationale ul{padding-left:18px;margin-top:4px}
.rationale li{margin-bottom:3px}
.llm-block{font-size:12px;color:#42526e;background:#f0f4ff;border-left:3px solid #0052cc;padding:8px 10px;border-radius:0 4px 4px 0;margin-bottom:10px}
.card-actions{padding:12px 16px;border-top:1px solid var(--border);display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.btn{padding:6px 14px;border:none;border-radius:4px;font-size:12px;font-weight:600;cursor:pointer}
.btn-confirm{background:#0052cc;color:#fff}
.btn-confirm:hover{background:#0747a6}
.btn-adjust{background:#f4f5f7;color:#42526e;border:1px solid #dfe1e6}
.btn-adjust:hover{background:#e0e0e0}
.btn-save{background:#28a745;color:#fff}
.adjust-form{display:none;width:100%;margin-top:8px;padding:10px;background:#f4f5f7;border-radius:4px;gap:8px;flex-wrap:wrap;align-items:center}
.adjust-form label{font-size:12px;display:flex;align-items:center;gap:4px}
.adjust-form input,.adjust-form select{padding:4px 6px;border:1px solid #dfe1e6;border-radius:4px;font-size:12px}
.gate-banner{background:#fffae6;border:1px solid #ffe380;border-radius:6px;padding:12px 16px;margin-bottom:20px;font-size:13px}
.gate-banner strong{color:#974f0c}
</style>
</head>
<body>
<header>
  <h1>${esc(piName)}</h1>
  <p>Generated ${esc(now)}${jqlLine} &middot; Three-method PERT &middot; Manifest-only &mdash; no Jira writes${llmLine}</p>
</header>
<div class="main">

<div class="gate-banner">
  <strong>&#9889; HUMAN CONFIRMATION REQUIRED</strong> — Review each card, then use CONFIRM / ADJUST to record your decision.
  Story Points must be applied manually in Jira. This tool never writes Jira fields directly.
</div>

${statsHtml}

${breakdownHtml}

<div id="review-summary">
  <h2>&#128203; Your Decisions</h2>
  <div id="summary-empty" class="empty-note">No decisions yet — use CONFIRM / ADJUST on each card below.</div>
  <table><thead><tr><th>Key</th><th>Decision</th><th>T-Shirt</th><th>SP</th><th>Note</th></tr></thead>
  <tbody id="summary-decisions"></tbody></table>
  <button class="btn btn-confirm" id="copy-btn" onclick="copyDecisions()" style="margin-top:12px">&#8984; Copy to clipboard</button>
</div>

${cardSections}

</div>
<script>
var decisions = {};
function confirmCard(key, tshirt, sp) {
  decisions[key] = {action:'CONFIRM', tshirt:tshirt, sp:sp, note:''};
  var card = document.getElementById('card-'+key);
  if (card) card.classList.add('confirmed');
  updateSummary();
}
function toggleAdjust(key) {
  var el = document.getElementById('adjust-'+key);
  if (!el) return;
  el.style.display = el.style.display === 'flex' ? 'none' : 'flex';
}
function saveAdjust(key) {
  var ts   = (document.getElementById('adj-tshirt-'+key)||{}).value||'';
  var sp   = (document.getElementById('adj-sp-'+key)||{}).value||'';
  var note = (document.getElementById('adj-note-'+key)||{}).value||'';
  decisions[key] = {action:'ADJUST', tshirt:ts, sp:sp, note:note};
  var card = document.getElementById('card-'+key);
  if (card) card.classList.add('confirmed');
  var af = document.getElementById('adjust-'+key);
  if (af) af.style.display = 'none';
  updateSummary();
}
function updateSummary() {
  var tbody = document.getElementById('summary-decisions');
  var empty = document.getElementById('summary-empty');
  if (!tbody) return;
  tbody.innerHTML = '';
  var keys = Object.keys(decisions);
  empty.style.display = keys.length ? 'none' : 'block';
  keys.forEach(function(k) {
    var d = decisions[k];
    var tr = document.createElement('tr');
    tr.innerHTML = '<td><a href="https://${esc(siteName)}.atlassian.net/browse/'+k+'" target="_blank">'+k+'</a></td>'
      +'<td>'+d.action+'</td><td>'+d.tshirt+'</td><td>'+d.sp+'</td><td>'+d.note+'</td>';
    tbody.appendChild(tr);
  });
}
function copyDecisions() {
  var lines = ['Key\tAction\tT-Shirt\tSP\tNote'];
  Object.keys(decisions).forEach(function(k) {
    var d = decisions[k];
    lines.push(k+'\t'+d.action+'\t'+d.tshirt+'\t'+d.sp+'\t'+d.note);
  });
  navigator.clipboard.writeText(lines.join('\n')).then(function() {
    var btn = document.getElementById('copy-btn');
    if (btn) { btn.textContent = 'Copied!'; setTimeout(function(){ btn.textContent = '⌘ Copy to clipboard'; }, 2000); }
  });
}
</script>
</body>
</html>`;
}
