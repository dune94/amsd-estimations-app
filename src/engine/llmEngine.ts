// ── Optional LLM deep-dive estimation engine ─────────────────────────────────
// Gated on: (1) story was flagged by the escalation classifier AND
//            (2) LLM_MODE=enabled is set in the environment.
// Failures are non-fatal — the deterministic result is always returned.

import Anthropic from '@anthropic-ai/sdk';
import { spawn } from 'node:child_process';
import type { IssueSignals, LlmPertEstimate, OpenSpecAnalysis, SpecKitAnalysis } from './types.js';
import { baselineStories } from '../config/index.js';

const MODEL = process.env.LLM_MODEL ?? 'claude-opus-4-8';

// Blend weights. 2026-09-16 (user: "drop the anchor and blend"): the LLM
// estimate is no longer averaged with the deterministic PERT - with only a
// signals-based nearest-neighbour lens the deterministic number was governing
// the output. blendedSp now equals the LLM PERT; the deterministic result is
// still returned alongside for comparison.
export const LLM_BLEND_WEIGHT = 1.0;
export const DETERMINISTIC_BLEND_WEIGHT = 0.0;

const SYSTEM_PROMPT_TEMPLATE = `You are a PI planning story-point estimation expert for {{ORG}}.
You run a structured three-phase analysis before producing a PERT estimate.

━━ PHASE 1 — OpenSpec (AC Elaboration) ━━
Review the acceptance criteria provided. For each AC: rewrite it to be complete, ordered, and
testable (Given/When/Then or equivalent). If the story clearly spans independent deliverables or
is likely >20 SP, flag it for a split and provide a brief rationale.

━━ PHASE 2 — SpecKit (Coverage Analysis) ━━
From the elaborated ACs: identify what is MISSING — error handling, edge cases, system-level
coverage, regression scope. List interface contracts that must be validated before development
starts (API shapes, component props, content model fields, dark-mode token availability, etc.).
Flag security or regression risks explicitly.

━━ PHASE 3 — PERT Sizing ━━
Using the enriched AC picture from phases 1 and 2, produce a Three-Method PERT estimate.
Size RELATIVE to the reference stories supplied in the prompt: these are real {{ORG}} tickets
with the story points the team actually planned them at. Pick the 2-4 reference stories whose
shape of work (surfaces touched, systems crossed, new vs modified, external dependencies) is
closest, and reason from their points. Stay within the range the reference set shows unless the
story is clearly larger than anything in it. Name the references you used in "anchors".

PERT formula: (Optimistic + 4 × MostLikely + Pessimistic) / 6
T-shirt scale: XS: 0–1 SP | S: 2–6 SP | M: 7–14 SP | L: 15–24 SP | XL: 25–40 SP

━━ OUTPUT FORMAT ━━
Respond with ONLY a raw JSON object — no markdown, no prose, no code fences:
{
  "openSpec": {
    "elaboratedAcs": ["<complete, testable AC 1>", "..."],
    "splitSuggested": false,
    "splitRationale": null
  },
  "specKit": {
    "missingAcs": ["<coverage gap 1>", "..."],
    "coverageRisks": ["<risk 1>", "..."],
    "interfaceContracts": ["<contract 1>", "..."]
  },
  "optimistic": <number>,
  "mostLikely": <number>,
  "pessimistic": <number>,
  "summary": "<ONE sentence, plain English, framing the estimate for a non-technical reader: what the work is, what drives the size, and the main uncertainty>",
  "anchors": ["<KEY (SP) - why it is comparable>", "..."],
  "rationale": ["<reason referencing phases 1+2>", "..."]
}

Rules:
- optimistic ≤ mostLikely ≤ pessimistic
- Use whole numbers or halves (e.g. 2.5) only
- rationale must have 2–4 strings that reference OpenSpec/SpecKit findings
- The deterministic estimate shown is a sanity anchor, not a constraint
- elaboratedAcs: keep all original intent, improve testability — do NOT invent new scope
- missingAcs: genuine gaps the original ACs did not address
- splitSuggested: true only when deliverables are truly independent`;

// Organisation name comes from ORG_NAME in .env (read when used, after the environment is loaded).
const systemPrompt = (): string => SYSTEM_PROMPT_TEMPLATE.split('{{ORG}}').join(process.env.ORG_NAME ?? 'the client');

/** Injected provider interface — the real implementation uses Anthropic; tests use a mock. */
export interface LlmEstimator {
  deepDive(signals: IssueSignals, deterministicSp: number): Promise<LlmPertEstimate>;
}

export function createAnthropicLlmEstimator(client: Anthropic): LlmEstimator {
  return {
    async deepDive(signals: IssueSignals, deterministicSp: number): Promise<LlmPertEstimate> {
      const userContent = buildPrompt(signals, deterministicSp);

      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 4000,
        thinking: { type: 'adaptive' },
        system: systemPrompt(),
        messages: [{ role: 'user', content: userContent }],
      });

      // Extract thinking summary from the first thinking block (if present)
      let thinkingSummary: string | null = null;
      for (const block of response.content) {
        if (block.type === 'thinking') {
          thinkingSummary = block.thinking.slice(0, 500);
          break;
        }
      }

      // Extract text block and parse JSON
      const textBlock = response.content.find(b => b.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        throw new Error('LLM response contained no text block — cannot parse estimate');
      }

      const raw = parseJsonFromText(textBlock.text);

      const pertSp =
        Math.round(((raw.optimistic + 4 * raw.mostLikely + raw.pessimistic) / 6) * 10) / 10;

      return {
        optimistic: raw.optimistic,
        mostLikely: raw.mostLikely,
        pessimistic: raw.pessimistic,
        pertSp,
        rationale: raw.rationale,
        anchors: raw.anchors,
        summary: raw.summary,
        model: MODEL,
        thinkingSummary,
        openSpec: raw.openSpec,
        specKit: raw.specKit,
      };
    },
  };
}

// ── Claude Code CLI provider (subscription auth, no API key) ─────────────────
// Runs `claude -p` headless (2026-09-16, user: "I do not want to use API KEY -
// that is way too expensive. Change to use subscription token"). Uses the
// machine's Claude Code login (or CLAUDE_CODE_OAUTH_TOKEN from `claude
// setup-token`), so usage is billed against the subscription, not per-token.
// Same system/user prompts and the same JSON contract as the Anthropic path;
// tools are disabled and the session is not persisted. Thinking blocks are not
// exposed by the CLI's json output, so thinkingSummary is always null here.
export interface ClaudeCliOptions {
  /** CLI binary (default "claude"). */
  bin?: string;
  /** Model passed via --model (default: MODEL). */
  model?: string;
  /** Per-call timeout in ms (default 180000). */
  timeoutMs?: number;
}

export function createClaudeCliLlmEstimator(opts: ClaudeCliOptions = {}): LlmEstimator {
  const bin = opts.bin ?? 'claude';
  const model = opts.model ?? MODEL;
  const timeoutMs = opts.timeoutMs ?? 180_000;

  return {
    async deepDive(signals: IssueSignals, deterministicSp: number): Promise<LlmPertEstimate> {
      const userContent = buildPrompt(signals, deterministicSp);
      const stdout = await runClaudeCli(
        bin,
        [
          '-p',
          '--output-format', 'json',
          '--model', model,
          '--tools', '',
          '--no-session-persistence',
          '--system-prompt', systemPrompt(),
        ],
        userContent,
        timeoutMs,
      );

      let envelope: Record<string, unknown>;
      try {
        envelope = JSON.parse(stdout) as Record<string, unknown>;
      } catch {
        throw new Error(`claude CLI returned non-JSON output: ${stdout.slice(0, 200)}`);
      }
      if (envelope['is_error'] === true || typeof envelope['result'] !== 'string') {
        throw new Error(`claude CLI error: ${JSON.stringify(envelope).slice(0, 300)}`);
      }

      const raw = parseJsonFromText(envelope['result']);
      const pertSp =
        Math.round(((raw.optimistic + 4 * raw.mostLikely + raw.pessimistic) / 6) * 10) / 10;

      return {
        optimistic: raw.optimistic,
        mostLikely: raw.mostLikely,
        pessimistic: raw.pessimistic,
        pertSp,
        rationale: raw.rationale,
        anchors: raw.anchors,
        summary: raw.summary,
        model: `claude-cli:${model}`,
        thinkingSummary: null,
        openSpec: raw.openSpec,
        specKit: raw.specKit,
      };
    },
  };
}

function runClaudeCli(bin: string, args: string[], stdin: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    // The engine's own ANTHROPIC_API_KEY (from .env) must not leak into the CLI:
    // an API key takes precedence over the claude.ai subscription login.
    const env = { ...process.env };
    delete env['ANTHROPIC_API_KEY'];
    delete env['ANTHROPIC_AUTH_TOKEN'];
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'], env });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`claude CLI timed out after ${timeoutMs} ms`));
    }, timeoutMs);
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

/** Parse JSON from model text, handling optional markdown code fences. */
function parseJsonFromText(text: string): {
  optimistic: number;
  mostLikely: number;
  pessimistic: number;
  rationale: string[];
  anchors: string[];
  summary: string;
  openSpec?: OpenSpecAnalysis;
  specKit?: SpecKitAnalysis;
} {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  const parsed = JSON.parse(stripped) as Record<string, unknown>;

  if (
    typeof parsed['optimistic'] !== 'number' ||
    typeof parsed['mostLikely'] !== 'number' ||
    typeof parsed['pessimistic'] !== 'number' ||
    !Array.isArray(parsed['rationale'])
  ) {
    throw new Error(`LLM returned unexpected JSON shape: ${JSON.stringify(parsed)}`);
  }

  const openSpec = parseOpenSpec(parsed['openSpec']);
  const specKit = parseSpecKit(parsed['specKit']);

  return {
    optimistic: parsed['optimistic'],
    mostLikely: parsed['mostLikely'],
    pessimistic: parsed['pessimistic'],
    rationale: (parsed['rationale'] as unknown[]).map(r => String(r)),
    anchors: Array.isArray(parsed['anchors']) ? (parsed['anchors'] as unknown[]).map(a => String(a)) : [],
    summary: typeof parsed['summary'] === 'string' ? parsed['summary'] : '',
    openSpec,
    specKit,
  };
}

function parseOpenSpec(raw: unknown): OpenSpecAnalysis | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  return {
    elaboratedAcs: Array.isArray(o['elaboratedAcs']) ? o['elaboratedAcs'].map(String) : [],
    splitSuggested: typeof o['splitSuggested'] === 'boolean' ? o['splitSuggested'] : false,
    splitRationale: typeof o['splitRationale'] === 'string' ? o['splitRationale'] : null,
  };
}

function parseSpecKit(raw: unknown): SpecKitAnalysis | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const s = raw as Record<string, unknown>;
  return {
    missingAcs: Array.isArray(s['missingAcs']) ? s['missingAcs'].map(String) : [],
    coverageRisks: Array.isArray(s['coverageRisks']) ? s['coverageRisks'].map(String) : [],
    interfaceContracts: Array.isArray(s['interfaceContracts']) ? s['interfaceContracts'].map(String) : [],
  };
}

function buildPrompt(signals: IssueSignals, deterministicSp: number): string {
  const lines: string[] = [
    `Issue: ${signals.key}`,
    `Type: ${signals.issueType}`,
    `Summary: ${signals.summary}`,
  ];

  if (signals.description) {
    lines.push(`Description:\n${signals.description.slice(0, 8000)}`);
  }

  if (signals.acceptanceCriteria.length > 0) {
    lines.push(`Acceptance criteria (${signals.acceptanceCriteria.length}):`);
    signals.acceptanceCriteria.forEach((ac, i) => lines.push(`  ${i + 1}. ${ac}`));
  } else {
    lines.push('Acceptance criteria: none found');
  }

  if (signals.labels.length > 0) {
    lines.push(`Labels: ${signals.labels.join(', ')}`);
  }
  lines.push(`Priority: ${signals.priority}`);
  if (signals.components.length > 0) {
    lines.push(`Components: ${signals.components.join(', ')}`);
  }
  if (signals.linkedIssuesCount > 0) {
    lines.push(`Linked issues: ${signals.linkedIssuesCount}`);
  }
  if (signals.subtasksCount > 0) {
    lines.push(`Subtasks with SP estimates: ${signals.subtasksCount} (total SP: ${signals.subtaskEstimatesSp.reduce((a, b) => a + b, 0)})`);
  }

  // deterministicSp is deliberately NOT shown to the model (2026-09-16): it
  // anchored the LLM to the deterministic lens's output.
  void deterministicSp;
  lines.push('');
  lines.push(`Reference stories (actual planned SP; ${baselineStories.length} tickets from PI-10 done work and PI-11 scope):`);
  for (const b of baselineStories) {
    lines.push(`  ${b.key} | ${b.sp} SP | ${b.description}`);
  }
  lines.push('');
  lines.push('Provide your independent PERT estimate as JSON.');

  return lines.join('\n');
}

/** Compute confidence-weighted blend of LLM and deterministic PERT results. */
export function blendEstimates(llmSp: number, deterministicSp: number): number {
  return Math.round((llmSp * LLM_BLEND_WEIGHT + deterministicSp * DETERMINISTIC_BLEND_WEIGHT) * 10) / 10;
}
