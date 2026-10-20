// ── Server entrypoint ────────────────────────────────────────────────────────

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import Fastify from 'fastify';
import { createConfluenceClient, createJiraClient } from './clients/index.js';
import { openDb } from './db/index.js';
import { createAnthropicLlmEstimator, createClaudeCliLlmEstimator, type LlmEstimator } from './engine/llmEngine.js';
import { registerRoutes } from './routes/index.js';
import { createEstimationService } from './service/estimationService.js';

const PORT = Number(process.env.PORT ?? 3000);
const DB_PATH = process.env.DB_PATH ?? './data/estimates.sqlite';

// LLM_PROVIDER: "claude-cli" (default — Claude Code subscription via `claude -p`,
// no API key) or "anthropic-api" (Messages API, needs ANTHROPIC_API_KEY credit).
function resolveLlmEstimator(): LlmEstimator | undefined {
  if (process.env.LLM_MODE !== 'enabled') return undefined;
  const provider = process.env.LLM_PROVIDER ?? 'claude-cli';
  if (provider === 'claude-cli' || provider === 'claude') {
    return createClaudeCliLlmEstimator({ bin: process.env.CLAUDE_CLI_BIN, model: process.env.LLM_MODEL });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('LLM_MODE=enabled with LLM_PROVIDER=anthropic-api but ANTHROPIC_API_KEY is not set — LLM path disabled');
    return undefined;
  }
  return createAnthropicLlmEstimator(new Anthropic({ apiKey }));
}

async function main() {
  const app = Fastify({ logger: true });

  const jira = createJiraClient();
  const confluence = createConfluenceClient();
  const db = openDb(DB_PATH);
  const llmEstimator = resolveLlmEstimator();
  const service = createEstimationService(jira, confluence, db, llmEstimator);

  registerRoutes(app, service);

  await app.listen({ port: PORT, host: '0.0.0.0' });
  app.log.info(
    `estimations app listening on :${PORT} — JIRA_MODE=${process.env.JIRA_MODE ?? 'mock'}, CONFLUENCE_MODE=${process.env.CONFLUENCE_MODE ?? 'mock'}, LLM_MODE=${process.env.LLM_MODE ?? 'none'}, LLM_PROVIDER=${process.env.LLM_PROVIDER ?? 'claude-cli'}`,
  );
}

main().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
