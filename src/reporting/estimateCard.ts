// ── Estimate card rendering ─────────────────────────────────────────────────
// Renders an EstimateResult into (a) a Confluence storage-format HTML page
// body (full detail) and (b) a short Jira comment (summary + link), per the
// write-back rule: comment + Confluence link only, never a direct field
// write.

import type { EstimateResult, LlmPertEstimate } from '../engine/types.js';

export function renderConfluencePage(result: EstimateResult): { title: string; html: string } {
  const { issueKey, effort, rbu, pert, tshirt, baselineComparator, escalation, previousSp, deltaSp } = result;

  const title = `Estimate: ${issueKey}`;

  const llmSection = result.llmEstimate
    ? renderLlmSection(result.llmEstimate, result.blendedSp)
    : '';

  const html = `
<h1>Estimation Card: ${issueKey}</h1>
<p><strong>Generated:</strong> ${result.generatedAt}</p>
<p><strong>Effort Tier:</strong> ${effort.tier} &nbsp; <strong>RBU:</strong> ${rbu.category} (${rbu.matchedValue ?? 'unmapped/empty'})</p>

<h2>PERT Inputs</h2>
<table>
  <tr><th>Lens</th><th>Value (SP)</th><th>Rationale</th></tr>
  <tr><td>Optimistic (O) — SpecKit</td><td>${pert.optimistic.value}</td><td>${pert.optimistic.rationale.join('<br/>')}</td></tr>
  <tr><td>Most Likely (M) — OpenSpec</td><td>${pert.mostLikely.value}</td><td>${pert.mostLikely.rationale.join('<br/>')}</td></tr>
  <tr><td>Pessimistic (P) — Brownfield</td><td>${pert.pessimistic.value}</td><td>${pert.pessimistic.rationale.join('<br/>')}</td></tr>
</table>

<h2>PERT Result</h2>
<p><strong>PERT weighted SP:</strong> ${pert.pertSp}<br/>
<strong>Standard deviation:</strong> ${pert.sd}<br/>
<strong>68% CI:</strong> ${pert.ci68[0]}–${pert.ci68[1]} SP<br/>
<strong>95% CI:</strong> ${pert.ci95[0]}–${pert.ci95[1]} SP<br/>
<strong>T-Shirt:</strong> ${tshirt}</p>

<h2>Baseline Comparator</h2>
<p>${baselineComparator ? `${baselineComparator.key} (${baselineComparator.sp} SP, similarity ${(baselineComparator.similarityScore * 100).toFixed(0)}%) — ${baselineComparator.description}` : 'None found'}</p>

<h2>Effort Classification Rationale</h2>
<ul>${effort.reasons.map(r => `<li>${r}</li>`).join('')}</ul>
<p><strong>AC Status:</strong> ${effort.acStatus}</p>

<h2>Convergence</h2>
<p>${pert.convergence.converged ? '✅ Converged' : '⚠️ Diverged'} (gap: ${pert.convergence.gapPct}%, threshold basis: ${pert.convergence.basis})</p>

<h2>Escalation</h2>
<p><strong>${escalation.flagged ? '⚠️ Flagged for LLM deep-dive' : '✅ Not needed'}</strong></p>
<ul>${escalation.reasons.map(r => `<li>${r}</li>`).join('')}</ul>

${llmSection}

<h2>Previous SP / Delta</h2>
<p>Previous: ${previousSp ?? 'Not set'} &nbsp; Delta: ${deltaSp !== null ? (deltaSp >= 0 ? `+${deltaSp}` : deltaSp) : 'New'}</p>

<p><em>⚠️ Draft estimate pending human review. Story Points must be applied manually in Jira — this tool never writes that field directly.</em></p>
`.trim();

  return { title, html };
}

function renderLlmSection(llm: LlmPertEstimate, blendedSp: number | undefined): string {
  const openSpecHtml = llm.openSpec
    ? `
<h3>OpenSpec — Elaborated ACs</h3>
<ol>${llm.openSpec.elaboratedAcs.map(ac => `<li>${ac}</li>`).join('')}</ol>
${llm.openSpec.splitSuggested ? `<p>⚠️ <strong>Split recommended:</strong> ${llm.openSpec.splitRationale ?? ''}</p>` : ''}
` : '';

  const specKitHtml = llm.specKit
    ? `
<h3>SpecKit — Coverage Analysis</h3>
${llm.specKit.missingAcs.length > 0 ? `<p><strong>Missing ACs:</strong></p><ul>${llm.specKit.missingAcs.map(a => `<li>${a}</li>`).join('')}</ul>` : ''}
${llm.specKit.coverageRisks.length > 0 ? `<p><strong>Coverage risks:</strong></p><ul>${llm.specKit.coverageRisks.map(r => `<li>${r}</li>`).join('')}</ul>` : ''}
${llm.specKit.interfaceContracts.length > 0 ? `<p><strong>Interface contracts to validate:</strong></p><ul>${llm.specKit.interfaceContracts.map(c => `<li>${c}</li>`).join('')}</ul>` : ''}
` : '';

  return `
<h2>LLM Deep-Dive (${llm.model})</h2>
${openSpecHtml}
${specKitHtml}
<h3>PERT Sizing</h3>
<table>
  <tr><th>O</th><th>M</th><th>P</th><th>PERT SP</th><th>Blended SP</th></tr>
  <tr><td>${llm.optimistic}</td><td>${llm.mostLikely}</td><td>${llm.pessimistic}</td><td>${llm.pertSp}</td><td>${blendedSp ?? '—'}</td></tr>
</table>
<p><strong>Rationale:</strong></p>
<ul>${llm.rationale.map(r => `<li>${r}</li>`).join('')}</ul>
${llm.thinkingSummary ? `<details><summary>Thinking summary</summary><pre>${llm.thinkingSummary}</pre></details>` : ''}
`.trim();
}

export function renderJiraComment(result: EstimateResult, confluenceUrl: string): string {
  const { pert, tshirt, effort, escalation } = result;
  const lines = [
    `PI-Estimation (deterministic v1): ${tshirt} tier, ${pert.pertSp} SP (68% CI ${pert.ci68[0]}-${pert.ci68[1]}).`,
    `Effort: ${effort.tier}. Convergence: ${pert.convergence.converged ? 'converged' : `diverged ${pert.convergence.gapPct}%`}.`,
    escalation.flagged ? `Escalation recommended: ${escalation.reasons[0]}` : 'No escalation needed.',
    `Full detail: ${confluenceUrl}`,
    `⚠️ Draft estimate pending human review — Story Points not updated automatically.`,
  ];
  return lines.join('\n');
}
