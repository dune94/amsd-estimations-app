// ── Export HTML artifact — CLI script ─────────────────────────────────────────
// Usage:
//   npm run export-html -- --jql "project = KEY AND sprint in openSprints()"
//   npm run export-html -- --jql "project = KEY" --pi "PI-10" --out ./generated_artifacts
//
// Reads JIRA_MODE, ATLASSIAN_* and LLM_MODE from .env (or env vars).
// Writes a self-contained HTML file to --out (default: ./generated_artifacts).
// No server required.

import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createJiraClient } from '../clients/index.js';
import { mapJiraIssueToSignals } from '../clients/mapIssue.js';
import { estimate } from '../engine/index.js';
import { renderHtmlArtifact } from '../reporting/htmlArtifact.js';

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const tokens: string[] = [];
      while (argv[i + 1] && !argv[i + 1].startsWith('--')) {
        i++;
        tokens.push(argv[i]);
      }
      args[key] = tokens.length > 0 ? tokens.join(' ') : 'true';
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const jql = args['jql'];
  const piName = args['pi'] ?? args['piName'] ?? 'PI Estimations';
  const outputDir = resolve(args['out'] ?? args['outputDir'] ?? './generated_artifacts');

  if (!jql) {
    console.error('Usage: npm run export-html -- --jql "<JQL>" [--pi "PI-10"] [--out ./generated_artifacts]');
    console.error('');
    console.error('Examples:');
    console.error('  npm run export-html -- --jql "project = KEY AND sprint in openSprints()"');
    console.error('  npm run export-html -- --jql "project = KEY" --pi "PI-10" --out ./output');
    process.exit(1);
  }

  const jira = createJiraClient();
  const mode = process.env.JIRA_MODE ?? 'mock';
  console.log(`Fetching issues (JIRA_MODE=${mode})…`);

  const rawIssues = await jira.searchByJql(jql, 100);
  console.log(`  ${rawIssues.length} issues returned`);

  const results = rawIssues.map(raw => {
    const signals = mapJiraIssueToSignals(raw);
    return estimate(signals);
  });

  const totalSp = Math.round(results.reduce((s, r) => s + r.pert.pertSp, 0) * 10) / 10;
  const escalated = results.filter(r => r.escalation.flagged).length;
  console.log(`  Estimated: ${results.length} stories, ${totalSp} SP total, ${escalated} escalated`);

  const html = renderHtmlArtifact(results, {
    piName,
    jql,
    siteName: process.env.ATLASSIAN_SITE_NAME,
  });

  mkdirSync(outputDir, { recursive: true });
  const filename = `pi-estimations-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.html`;
  const outputPath = resolve(outputDir, filename);
  writeFileSync(outputPath, html, 'utf-8');

  console.log(`\nHTML artifact written to:`);
  console.log(`  ${outputPath}`);
}

main().catch(err => {
  console.error('Error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
