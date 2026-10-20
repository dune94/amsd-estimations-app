// Usage: npm run learn -- <delivered.json> <baselines.json> <out.json>
// delivered.json: a list of { key, acceptedSp, description?, measured: {...} } for work that has shipped and been measured.
// Writes ONLY <out.json>: proposed baseline rows for a person to review. It never changes the baselines.
import { readFileSync, writeFileSync } from 'node:fs';
import type { BaselineStory } from '../config/index.js';
import { proposeRows, type DeliveredRow } from '../engine/measuredBaselines.js';

const [delivered, base, out] = process.argv.slice(2);
if (!delivered || !base || !out) { console.error('usage: learn <delivered.json> <baselines.json> <out.json>'); process.exit(2); }
const baselines = (JSON.parse(readFileSync(base, 'utf8')) as { stories: BaselineStory[] }).stories;
const rows = proposeRows(JSON.parse(readFileSync(delivered, 'utf8')) as DeliveredRow[], baselines);
writeFileSync(out, JSON.stringify({ proposed: rows }, null, 2) + '\n');
console.log(`wrote ${out}: ${rows.length} proposed row(s) for review`);
