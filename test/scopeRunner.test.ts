import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createScopeRunner, parseScopeResult } from '../src/scope/scopeRunner.js';

const FIX = join(__dirname, 'fixtures');
const sample = () => JSON.parse(readFileSync(join(FIX, 'scope-result-v1.json'), 'utf8'));

let home: string;
let log: string;
const runner = (timeoutMs = 5000) =>
  createScopeRunner({ scopeHome: home, boundedBin: join(home, 'bounded'), boundedMb: 1024, timeoutMs });

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'scope-home-'));
  mkdirSync(join(home, '.venv', 'bin'), { recursive: true });
  copyFileSync(join(FIX, 'fake-scope.sh'), join(home, '.venv', 'bin', 'python'));
  copyFileSync(join(FIX, 'fake-bounded.sh'), join(home, 'bounded'));
  log = join(home, 'bounded.log');
  Object.assign(process.env, {
    FAKE_LOG: log, FAKE_RESULT: join(FIX, 'scope-result-v1.json'), FAKE_PIDFILE: join(home, 'pid'), FAKE_MODE: 'ok',
  });
});

afterEach(() => {
  delete process.env.FAKE_MODE;
  delete process.env.FAKE_RELPACK;
});

describe('parseScopeResult', () => {
  it('accepts a valid v1 result', () => {
    expect(parseScopeResult(sample()).pert?.expected_sp).toBe(5);
  });
  it('throws when schema_version is missing', () => {
    const r = sample(); delete r.schema_version;
    expect(() => parseScopeResult(r)).toThrow('schema_version');
  });
  it('throws when schema_version is unknown', () => {
    expect(() => parseScopeResult({ ...sample(), schema_version: 2 })).toThrow('schema_version');
  });
});

describe('scope runner', () => {
  it('reads the result of a successful run', async () => {
    const out = await runner().run('KEY-1', join(home, 'pack.json'));
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.result.pert?.expected_sp).toBe(5);
      expect(out.resultPath).toBe(join(FIX, 'scope-result-v1.json'));
    }
  });

  it('is not ok on a non-zero exit, with the engine message', async () => {
    process.env.FAKE_MODE = 'exit2';
    const out = await runner().run('KEY-1', join(home, 'pack.json'));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('boom');
  });

  it('times out and kills the whole process group', async () => {
    process.env.FAKE_MODE = 'slow';
    const out = await runner(400).run('KEY-1', join(home, 'pack.json'));
    expect(out).toEqual({ ok: false, reason: 'timeout' });
    const pid = Number(readFileSync(join(home, 'pid'), 'utf8').trim());
    let alive = true;
    for (let i = 0; i < 20 && alive; i++) {
      try { process.kill(pid, 0); await new Promise(r => setTimeout(r, 50)); } catch { alive = false; }
    }
    expect(alive).toBe(false);
  });

  it('is not ok, with a reason, on an unknown schema_version', async () => {
    process.env.FAKE_MODE = 'badversion';
    const out = await runner().run('KEY-1', join(home, 'pack.json'));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('schema_version');
  });

  it('is not ok, with a reason, when schema_version is missing', async () => {
    process.env.FAKE_MODE = 'noversion';
    const out = await runner().run('KEY-1', join(home, 'pack.json'));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('schema_version');
  });

  it('builds a pack and returns its path', async () => {
    const dir = join(home, 'work', 'KEY-1');
    const out = await runner().buildPack('KEY-1', dir);
    expect(out).toEqual({ packPath: join(dir, 'pack.json') });
    expect(existsSync(join(dir, 'pack.json'))).toBe(true);
  });

  it('starts every command under the memory-cap wrapper', async () => {
    await runner().buildPack('KEY-1', join(home, 'work', 'KEY-1'));
    await runner().run('KEY-1', join(home, 'pack.json'));
    const lines = readFileSync(log, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l.startsWith('--want 1024 -- ')).toBe(true);
    expect(lines[0]).toContain('--build-pack');
    expect(lines[1]).toContain('--run --story-pack');
  });

  it('is not ok, with the engine error as the reason, when the result records an error', async () => {
    process.env.FAKE_MODE = 'errorresult';
    const out = await runner().run('KEY-1', join(home, 'pack.json'));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('RuntimeError: drivers agent returned no JSON');
  });

  it('resolves a relative pack path against the engine folder, where the engine ran', async () => {
    process.env.FAKE_RELPACK = '1';
    const out = await runner().buildPack('KEY-1', 'work/KEY-1');
    expect(out).toEqual({ packPath: join(home, 'rel', 'pack.json') });
  });
});
