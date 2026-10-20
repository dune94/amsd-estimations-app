import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('.env.example', () => {
  it('documents every environment variable the source reads', () => {
    const root = join(__dirname, '..');
    const used = new Set<string>();
    for (const f of files(join(root, 'src'))) {
      for (const m of readFileSync(f, 'utf8').matchAll(/(?:process\.)?env\.([A-Z][A-Z0-9_]+)/g)) used.add(m[1]);
    }
    const documented = new Set([...readFileSync(join(root, '.env.example'), 'utf8').matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map(m => m[1]));
    const missing = [...used].filter(k => !documented.has(k)).sort();
    expect(missing).toEqual([]);
  });

  it('lists the pipeline settings as active (blank) entries so an installer can fill them', () => {
    const text = readFileSync(join(__dirname, '..', '.env.example'), 'utf8');
    for (const k of ['ESTIMATION_MODE', 'SCOPE_HOME', 'SCOPE_BOUNDED', 'SCOPE_TIMEOUT_MS', 'SCOPE_WORK_DIR', 'OUTPUTS_ENABLED', 'MAX_BATCH_SIZE', 'MAX_NOTES_CHARS']) {
      expect(text).toMatch(new RegExp(`^${k}=$`, 'm'));
    }
  });
});
