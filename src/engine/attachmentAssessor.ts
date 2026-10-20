// ── Optional LLM attachment-assessment pass ───────────────────────────────────
// Gated on withAttachments: true in RunOpts.
// Fetches raw attachment bytes via JiraClient.getAttachmentContent, then passes
// images as --file args and text/PDF inline to the Claude CLI.  Produces an
// AttachmentAssessment that the estimation service attaches to EstimateResult.

import { spawn } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { JiraAttachment } from '../clients/types.js';
import type { IssueSignals, AttachmentAssessment, AttachmentFinding } from './types.js';

const MODEL = process.env.LLM_MODEL ?? 'claude-opus-4-8';

const SYSTEM_PROMPT = `You are a senior software engineer reviewing Jira issue attachments to identify
information that affects the complexity of a planned story.

Your job is to look at each attachment and describe what it shows, how it relates to the story, and
whether it changes the pessimistic effort scenario.

━━ OUTPUT FORMAT ━━
Respond with ONLY a raw JSON object — no markdown, no prose, no code fences:
{
  "findings": [
    {
      "filename": "<attachment filename>",
      "observation": "<one sentence: what the attachment shows>",
      "estimationRelevance": "<one sentence: how this affects the effort>",
      "severity": "high" | "medium" | "low"
    }
  ],
  "pertImpact": {
    "pessimisticDeltaSp": <signed integer — positive adds to P, 0 means no change>,
    "rationale": "<one sentence explaining the overall delta>"
  }
}

Rules:
- severity "high": attachment reveals scope or complexity not visible in the ticket description
- severity "medium": confirms known scope but adds nuance
- severity "low": informational only, no estimation impact
- pessimisticDeltaSp: a positive integer (or 0) only — never negative
- If no attachments reveal estimation-relevant information, return an empty findings array and delta 0`;

export interface RawAttachment {
  filename: string;
  mimeType: string;
  data: Buffer;
}

/** Injected interface so tests can mock without the filesystem or real Claude. */
export interface AttachmentAssessor {
  assess(signals: IssueSignals, attachments: RawAttachment[]): Promise<AttachmentAssessment>;
}

export function createClaudeCliAttachmentAssessor(opts: { bin?: string; model?: string; timeoutMs?: number } = {}): AttachmentAssessor {
  const bin = opts.bin ?? 'claude';
  const model = opts.model ?? MODEL;
  const timeoutMs = opts.timeoutMs ?? 180_000;

  return {
    async assess(signals: IssueSignals, attachments: RawAttachment[]): Promise<AttachmentAssessment> {
      const tempFiles: string[] = [];
      const fileArgs: string[] = [];
      const inlineTexts: string[] = [];

      try {
        for (const att of attachments) {
          if (att.data.length === 0) continue;

          if (att.mimeType.startsWith('image/')) {
            const ext = att.mimeType.split('/')[1] ?? 'bin';
            const tmpPath = `/tmp/attachment-${randomUUID()}.${ext}`;
            writeFileSync(tmpPath, att.data);
            tempFiles.push(tmpPath);
            fileArgs.push('--file', tmpPath);
          } else {
            // text/plain, application/pdf, etc. — inline first 4000 chars
            inlineTexts.push(`── ${att.filename} ──\n${att.data.toString('utf8').slice(0, 4000)}`);
          }
        }

        const prompt = buildPrompt(signals, attachments.map(a => a.filename), inlineTexts);
        const args = [
          '-p',
          '--output-format', 'json',
          '--model', model,
          '--tools', '',
          '--no-session-persistence',
          '--system-prompt', SYSTEM_PROMPT,
          ...fileArgs,
        ];
        const stdout = await runClaudeCli(bin, args, prompt, timeoutMs);

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
      } finally {
        for (const p of tempFiles) {
          try { unlinkSync(p); } catch { /* ignore cleanup failures */ }
        }
      }
    },
  };
}

function buildPrompt(signals: IssueSignals, filenames: string[], inlineTexts: string[]): string {
  const lines: string[] = [
    `Story: ${signals.key} — ${signals.summary}`,
    `Labels: ${signals.labels.join(', ') || 'none'}`,
    `Attachments: ${filenames.join(', ')}`,
  ];

  if (inlineTexts.length > 0) {
    lines.push('');
    lines.push('Text/PDF attachment content:');
    lines.push(inlineTexts.join('\n\n'));
  }

  lines.push('');
  lines.push('Review the attachments and produce the JSON assessment.');
  return lines.join('\n');
}

function parseAssessment(text: string, model: string): AttachmentAssessment {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  const raw = JSON.parse(stripped) as Record<string, unknown>;

  if (!Array.isArray(raw['findings'])) {
    throw new Error(`Attachment assessor returned unexpected JSON shape: ${JSON.stringify(raw).slice(0, 300)}`);
  }

  const findings: AttachmentFinding[] = (raw['findings'] as unknown[]).map(f => {
    const fObj = f as Record<string, unknown>;
    return {
      filename: String(fObj['filename'] ?? ''),
      observation: String(fObj['observation'] ?? ''),
      estimationRelevance: String(fObj['estimationRelevance'] ?? ''),
      severity: (['high', 'medium', 'low'] as const).includes(fObj['severity'] as 'high' | 'medium' | 'low')
        ? (fObj['severity'] as 'high' | 'medium' | 'low')
        : 'low',
    };
  });

  const impact = raw['pertImpact'] as Record<string, unknown> | undefined;

  return {
    findings,
    pertImpact: {
      pessimisticDeltaSp: typeof impact?.['pessimisticDeltaSp'] === 'number' ? impact['pessimisticDeltaSp'] : 0,
      rationale: typeof impact?.['rationale'] === 'string' ? impact['rationale'] : '',
    },
    model,
  };
}

/** Convert a JiraAttachment metadata record + raw bytes into a RawAttachment. */
export function toRawAttachment(meta: JiraAttachment, data: Buffer): RawAttachment {
  return { filename: meta.filename, mimeType: meta.mimeType, data };
}

function runClaudeCli(bin: string, args: string[], stdin: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env['ANTHROPIC_API_KEY'];
    delete env['ANTHROPIC_AUTH_TOKEN'];
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'], env });
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
