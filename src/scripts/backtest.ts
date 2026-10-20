// Usage: npm run backtest -- <rows.json>
// rows.json: a list of { key, forecastSp, formulaSp, acceptedSp|null } — the forecast made before the change, the formula applied to
// the real delivered change, and the accepted SP. Prints the report; exits 1 when the share within one band is below the threshold.
import { readFileSync } from 'node:fs';
import { backtestConfig, confidenceConfig } from '../config/index.js';
import { backtestReport, type BacktestRow } from '../engine/backtestMath.js';

const [file] = process.argv.slice(2);
if (!file) { console.error('usage: backtest <rows.json>'); process.exit(2); }
const r = backtestReport(JSON.parse(readFileSync(file, 'utf8')) as BacktestRow[], confidenceConfig.bands, backtestConfig.minShare);
console.log(JSON.stringify(r, null, 2));
console.log(r.passes ? `PASS: ${(r.share * 100).toFixed(1)}% within one band (needs ${(backtestConfig.minShare * 100).toFixed(0)}%)` : `FAIL: ${(r.share * 100).toFixed(1)}% within one band (needs ${(backtestConfig.minShare * 100).toFixed(0)}%)`);
process.exit(r.passes ? 0 : 1);
