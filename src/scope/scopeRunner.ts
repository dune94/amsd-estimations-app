// ── Scope runner ───────────────────────────────────────────────────────────
// Runs the scope engine (a separate project) as a command, always under the memory-cap wrapper and a timeout, and reads
// its result.json. Engine failures never throw: they come back as { ok: false, reason } so a batch is never blocked.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface PertBlock {
  o_br: number; m_br: number; p_br: number; expected_br: number;
  o_sp: number; m_sp: number; p_sp: number; expected_sp: number;
}

export interface PlanningBlock {
  base_br: number; upper_br: number; planning_br: number; c_count: number; r_count: number;
  scope: string; complexity: string; risk: string; planning_sp: number; sp_as_measured: number; pert: PertBlock;
}

export interface ScopeDriver { driver: number; name?: string; date?: string; source?: string; quote: string }

export interface ScopeResultV1 {
  schema_version: 1;
  story_hash: string;
  key: string;
  title?: string;
  required: string[];
  alternatives: string[];
  blast_required?: { base: number; upper: number; by_codeline: Record<string, number> };
  planning?: PlanningBlock;
  pert: PertBlock | null;
  drivers: { complexity: ScopeDriver[]; risk: ScopeDriver[]; dropped: unknown[]; c_count: number; r_count: number };
  inputs: {
    comments?: number;
    attachments_read?: { filename: string; note?: string }[];
    attachments_not_read?: { filename: string; reason: string }[];
    confluence_read?: { id: string; title: string }[];
    confluence_not_read?: { id: string; reason: string }[];
  };
  flags: string[];
  codelines?: Record<string, unknown>;
  [key: string]: unknown;
}

export type ScopeOutcome = { ok: true; result: ScopeResultV1; resultPath: string } | { ok: false; reason: string };

export interface ScopeRunnerOptions { scopeHome: string; boundedBin: string; boundedMb: number; timeoutMs: number }
export interface ScopeRunner {
  buildPack(key: string, dir: string): Promise<{ packPath: string } | { error: string }>;
  run(key: string, packPath: string): Promise<ScopeOutcome>;
}

export function parseScopeResult(json: unknown): ScopeResultV1 {
  const v = (json as { schema_version?: unknown } | null)?.schema_version;
  if (v !== 1) throw new Error(`scope result schema_version ${v === undefined ? 'is missing' : `${String(v)} is not supported`} (expected 1)`);
  return json as ScopeResultV1;
}

interface Finished { code: number | null; stdout: string; stderr: string; timedOut: boolean }

function exec(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<Finished> {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let timedOut = false;
    const cap = (s: string) => (s.length > 65536 ? s.slice(-65536) : s);
    child.stdout.on('data', d => { stdout = cap(stdout + String(d)); });
    child.stderr.on('data', d => { stderr = cap(stderr + String(d)); });
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* already gone */ }
    }, timeoutMs);
    child.on('error', err => { clearTimeout(timer); resolve({ code: null, stdout, stderr: stderr + String(err), timedOut }); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
  });
}

export function createScopeRunner(opts: ScopeRunnerOptions): ScopeRunner {
  const python = join(opts.scopeHome, '.venv', 'bin', 'python');
  const command = (extra: string[]) => ({
    cmd: opts.boundedBin,
    args: ['--want', String(opts.boundedMb), '--', python, '-u', '-m', 'scope', ...extra],
  });
  const lastLine = (out: string, prefix: string): string | null => {
    const m = out.split('\n').reverse().find(l => l.startsWith(prefix));
    return m ? m.slice(prefix.length).trim() : null;
  };
  const failure = (f: Finished): string => (f.timedOut ? 'timeout' : `exit code ${f.code}: ${(f.stderr || f.stdout).trim().slice(-300)}`);

  return {
    async buildPack(key, dir) {
      const { cmd, args } = command([key, '--build-pack', dir]);
      const f = await exec(cmd, args, opts.scopeHome, opts.timeoutMs);
      if (f.timedOut || f.code !== 0) return { error: failure(f) };
      const packPath = lastLine(f.stdout, 'pack:');
      return packPath ? { packPath } : { error: 'the scope engine did not report a pack path' };
    },

    async run(key, packPath) {
      const { cmd, args } = command([key, '--run', '--story-pack', packPath]);
      const f = await exec(cmd, args, opts.scopeHome, opts.timeoutMs);
      if (f.timedOut || f.code !== 0) return { ok: false, reason: failure(f) };
      const resultPath = lastLine(f.stdout, 'result:');
      if (!resultPath) return { ok: false, reason: 'the scope engine did not report a result path' };
      try {
        return { ok: true, result: parseScopeResult(JSON.parse(readFileSync(resultPath, 'utf8'))), resultPath };
      } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
