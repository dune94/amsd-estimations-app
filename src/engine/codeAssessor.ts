// ── Optional LLM code-assessment pass ────────────────────────────────────────
// Gated on withCodeAssessment: true in RunOpts.
// Reads source snippets supplied by the caller, asks the LLM to identify
// implementation gaps, and produces a CodeAssessment that the estimation
// service attaches to the EstimateResult.
//
// Deliberately separate from llmEngine.ts: the estimation call sizes work
// relative to the corpus; the code-assessment call reviews what already exists.
// Keeping them apart makes each prompt focused and the result fields clean.

import { spawn } from 'node:child_process';
import type { IssueSignals } from './types.js';
import type { CodeAssessment, CodeFinding } from './types.js';

const MODEL = process.env.LLM_MODEL ?? 'claude-opus-4-8';

const SYSTEM_PROMPT = `You are a senior software engineer reviewing source code to identify implementation gaps
that affect the complexity of a planned Jira story.

Your job is NOT to size the story — the estimation engine does that. Your job is to read the
source code excerpts provided and report:

1. What the component/module currently does and how widely it is used.
2. Specific implementation gaps relative to the story's stated acceptance criteria.
3. A PERT pessimistic-scenario impact: how many additional SP should the pessimistic value carry
   due to findings not visible from the Jira description alone.

━━ OUTPUT FORMAT ━━
Respond with ONLY a raw JSON object — no markdown, no prose, no code fences:
{
  "componentSummary": "<One short paragraph: what the component is, how it is structured, how widely used>",
  "callSiteCount": <number or null>,
  "findings": [
    {
      "title": "<short label>",
      "standard": "<WCAG SC or quality standard, or null>",
      "detail": "<one sentence: the gap and why it matters>",
      "severity": "high" | "medium" | "low"
    }
  ],
  "pertImpact": {
    "pessimisticDeltaSp": <signed integer — positive means add to P, 0 means no change>,
    "rationale": "<one sentence explaining the delta>"
  }
}

Rules:
- findings: only include genuine gaps visible in the source — do not invent scope
- severity "high": finding is likely to move the pessimistic scenario up by ≥2 SP
- severity "medium": finding adds complexity but is bounded (≤1 SP impact)
- severity "low": note-worthy but unlikely to affect the number
- pessimisticDeltaSp: a positive integer (or 0) only — never negative
- callSiteCount: count of places in the codebase that import or invoke the component, or null if not determinable from the excerpts provided`;

/** Injected interface so tests can mock without touching the filesystem. */
export interface CodeAssessor {
  assess(signals: IssueSignals, sourceExcerpts: SourceExcerpt[]): Promise<CodeAssessment>;
}

/** One source file (or excerpt) passed to the assessor. */
export interface SourceExcerpt {
  /** Repo-relative path, e.g. "src/components/ToastNotification/ToastNotification.tsx". */
  path: string;
  /** The full file text, or a representative excerpt (cap at ~4000 chars per file). */
  content: string;
  /** Optional context note, e.g. "call sites: 83" or "per-brand CSS override". */
  note?: string;
}

export function createClaudeCliCodeAssessor(opts: { bin?: string; model?: string; timeoutMs?: number } = {}): CodeAssessor {
  const bin = opts.bin ?? 'claude';
  const model = opts.model ?? MODEL;
  const timeoutMs = opts.timeoutMs ?? 180_000;

  return {
    async assess(signals: IssueSignals, sourceExcerpts: SourceExcerpt[]): Promise<CodeAssessment> {
      const userContent = buildPrompt(signals, sourceExcerpts);
      const stdout = await runClaudeCli(bin, model, userContent, timeoutMs);

      let envelope: Record<string, unknown>;
      try {
        envelope = JSON.parse(stdout) as Record<string, unknown>;
      } catch {
        throw new Error(`claude CLI returned non-JSON output: ${stdout.slice(0, 200)}`);
      }
      if (envelope['is_error'] === true || typeof envelope['result'] !== 'string') {
        throw new Error(`claude CLI error: ${JSON.stringify(envelope).slice(0, 300)}`);
      }

      return parseAssessment(envelope['result'], `claude-cli:${model}`);
    },
  };
}

function buildPrompt(signals: IssueSignals, excerpts: SourceExcerpt[]): string {
  const lines: string[] = [
    `Story: ${signals.key} — ${signals.summary}`,
    `Components: ${signals.components.join(', ') || 'not specified'}`,
    `Labels: ${signals.labels.join(', ') || 'none'}`,
  ];

  if (signals.acceptanceCriteria.length > 0) {
    lines.push(`Acceptance criteria (${signals.acceptanceCriteria.length}):`);
    signals.acceptanceCriteria.forEach((ac, i) => lines.push(`  ${i + 1}. ${ac}`));
  } else {
    lines.push('Acceptance criteria: none extracted from the ticket');
  }

  lines.push('');
  lines.push(`Source excerpts (${excerpts.length} file${excerpts.length === 1 ? '' : 's'}):`);

  for (const ex of excerpts) {
    lines.push(`\n── ${ex.path}${ex.note ? ` [${ex.note}]` : ''} ──`);
    lines.push(ex.content.slice(0, 4000));
  }

  lines.push('');
  lines.push('Identify implementation gaps and produce the JSON assessment.');

  return lines.join('\n');
}

function parseAssessment(text: string, model: string): CodeAssessment {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  const raw = JSON.parse(stripped) as Record<string, unknown>;

  if (typeof raw['componentSummary'] !== 'string' || !Array.isArray(raw['findings'])) {
    throw new Error(`Code assessor returned unexpected JSON shape: ${JSON.stringify(raw).slice(0, 300)}`);
  }

  const findings: CodeFinding[] = (raw['findings'] as unknown[]).map(f => {
    const fObj = f as Record<string, unknown>;
    return {
      title: String(fObj['title'] ?? ''),
      standard: typeof fObj['standard'] === 'string' ? fObj['standard'] : null,
      detail: String(fObj['detail'] ?? ''),
      severity: (['high', 'medium', 'low'] as const).includes(fObj['severity'] as 'high' | 'medium' | 'low')
        ? (fObj['severity'] as 'high' | 'medium' | 'low')
        : 'low',
    };
  });

  const impact = raw['pertImpact'] as Record<string, unknown> | undefined;

  return {
    componentSummary: raw['componentSummary'],
    callSiteCount: typeof raw['callSiteCount'] === 'number' ? raw['callSiteCount'] : null,
    findings,
    pertImpact: {
      pessimisticDeltaSp: typeof impact?.['pessimisticDeltaSp'] === 'number' ? impact['pessimisticDeltaSp'] : 0,
      rationale: typeof impact?.['rationale'] === 'string' ? impact['rationale'] : '',
    },
    model,
  };
}

function runClaudeCli(bin: string, model: string, stdin: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env['ANTHROPIC_API_KEY'];
    delete env['ANTHROPIC_AUTH_TOKEN'];
    const child = spawn(
      bin,
      ['-p', '--output-format', 'json', '--model', model, '--tools', '', '--no-session-persistence', '--system-prompt', SYSTEM_PROMPT],
      { stdio: ['pipe', 'pipe', 'pipe'], env },
    );
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`claude CLI timed out after ${timeoutMs} ms`)); }, timeoutMs);
    child.stdout.on('data', d => { out += String(d); });
    child.stderr.on('data', d => { err += String(d); });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`claude CLI exited ${code}: ${err.slice(0, 300)}`));
      else resolve(out);
    });
    child.stdin.end(stdin);
  });
}
