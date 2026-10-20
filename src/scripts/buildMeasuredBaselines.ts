// Usage: npm run build-measured-baselines -- <calibration.json> <baselines.json> <out.json>
// calibration.json: a list of { key, changed, dependent, tests, external, newFiles, blastRadius, scope, complexity, risk, cDrivers, rDrivers }.
// baselines.json: { stories: [...] } as in the baseline-stories config. Writes ONLY <out.json>; the inputs are never changed.
import { readFileSync, writeFileSync } from 'node:fs';
import type { BaselineStory } from '../config/index.js';
import { mergeMeasured, type CalibrationRow } from '../engine/measuredBaselines.js';

const [cal, base, out] = process.argv.slice(2);
if (!cal || !base || !out) { console.error('usage: build-measured-baselines <calibration.json> <baselines.json> <out.json>'); process.exit(2); }
const baselines = JSON.parse(readFileSync(base, 'utf8')) as { stories: BaselineStory[] } & Record<string, unknown>;
const merged = mergeMeasured(baselines.stories, JSON.parse(readFileSync(cal, 'utf8')) as CalibrationRow[]);
writeFileSync(out, JSON.stringify({ ...baselines, stories: merged }, null, 2) + '\n');
console.log(`wrote ${out}: ${merged.filter(s => s.measured).length} of ${merged.length} stories now carry measured facts`);
