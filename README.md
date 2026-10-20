# Estimations app

PI-planning story-point estimation API. Deterministic by default (no LLM required), with optional Anthropic AI deep-dive for escalated stories.

---

## Prerequisites

- Node.js 20+
- npm 9+

---

## Installation

```bash
npm install
```

---

## Configuration

Copy the example env file and fill in values:

```bash
cp .env.example .env
```

Key settings in `.env`:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DB_PATH` | `./data/estimates.sqlite` | SQLite file path (created on first run) |
| `JIRA_MODE` | `mock` | `mock` = built-in fixtures, no credentials needed; `live` = real Jira Cloud |
| `CONFLUENCE_MODE` | `mock` | `mock` = no-op write, no credentials needed; `live` = real Confluence Cloud |
| `ATLASSIAN_SITE_NAME` | — | Your Atlassian subdomain (e.g. `mysite`) — live mode only |
| `ATLASSIAN_USER_EMAIL` | — | Your Atlassian account email — live mode only |
| `ATLASSIAN_API_TOKEN` | — | Atlassian API token — live mode only |
| `LLM_MODE` | `none` | `none` = fully deterministic; `enabled` = Anthropic deep-dive available |
| `ANTHROPIC_API_KEY` | — | Required only when `LLM_MODE=enabled` |

**Never commit your real `.env` file.** API keys must come from environment variables or Azure Key Vault — never embedded in source.

---

## Running

### Development (hot-reload)

```bash
npm run dev
```

### Production

```bash
npm run build
npm start
```

The server logs the active mode on startup:

```
estimations app listening on :3000 — JIRA_MODE=mock, CONFLUENCE_MODE=mock, LLM_MODE=none
```

---

## API Reference

### Health check

```
GET /health
```

### Estimate a single issue

```
POST /estimates/:issueKey/recompute
```

Body (all optional):

```json
{
  "writeBack": false,
  "withLlm": false
}
```

- `writeBack: true` — writes the estimate as a Confluence page and posts a Jira comment (requires live mode)
- `withLlm: true` — runs an Anthropic LLM deep-dive on escalated stories (requires `LLM_MODE=enabled` and `ANTHROPIC_API_KEY`)

### Retrieve a stored estimate

```
GET /estimates/:issueKey
```

Returns `404` if the issue has never been estimated. Run the `recompute` POST first.

### List all stored estimates

```
GET /estimates?limit=50
```

### Batch estimate by JQL

```
POST /estimates/batch
```

Body:

```json
{
  "jql": "project = KEY AND sprint in openSprints()",
  "writeBack": false,
  "withLlm": false
}
```

### Jira webhook

```
POST /webhooks/jira
```

Triggered by a Jira Automation rule. Set `X-Webhook-Secret` header to match `JIRA_WEBHOOK_SHARED_SECRET`.

---

## Mock mode (no credentials)

In `mock` mode (the default) three built-in Jira fixtures are available:

| Key | Summary | Tier |
|---|---|---|
| `PRJ-9001` | Update footer copyright year | Easy |
| `PRJ-9002` | New multi-step eligibility webform | Medium/Hard |
| `PRJ-9003` | Spike: evaluate vendor identity-verification API | Hard |

Quick test with mock mode:

```bash
# Start the server
npm run dev

# Estimate a single issue
curl -s -X POST http://localhost:3000/estimates/PRJ-9002/recompute | jq .

# Batch estimate all mock fixtures
curl -s -X POST http://localhost:3000/estimates/batch \
  -H 'Content-Type: application/json' \
  -d '{"jql":"project = KEY"}' | jq .

# List stored estimates
curl -s http://localhost:3000/estimates | jq .
```

---

## LLM deep-dive (optional)

When `LLM_MODE=enabled` and `ANTHROPIC_API_KEY` is set, pass `withLlm: true` on a recompute call:

```bash
curl -s -X POST http://localhost:3000/estimates/PRJ-9002/recompute \
  -H 'Content-Type: application/json' \
  -d '{"withLlm": true}' | jq '{pertSp: .pert.pertSp, llmSp: .llmEstimate.pertSp, blendedSp}'
```

The LLM path only activates when the story is **escalated** (flagged by the deterministic engine). Non-escalated stories are unaffected even when `withLlm: true` is passed.

The blended result uses: `blendedSp = (llmSp × 0.4) + (deterministicSp × 0.6)`

---

## Tests

```bash
npm test
```

55 tests, no network or credentials required.

---

## Architecture

```
src/
├── engine/           # Pure deterministic estimation (no I/O)
│   ├── effortClassifier.ts
│   ├── escalationClassifier.ts
│   ├── openSpecLens.ts
│   ├── pert.ts
│   ├── rbuClassifier.ts
│   ├── llmEngine.ts  # Optional Anthropic deep-dive
│   └── types.ts
├── clients/          # Jira + Confluence clients (mock & live)
├── db/               # SQLite persistence (better-sqlite3, WAL mode)
├── service/          # Orchestration layer
├── routes/           # Fastify route handlers
├── reporting/        # Confluence page + Jira comment renderers
├── config/           # thresholds.json, baseline-stories.json
└── server.ts         # Entry point
```

**Hard constraints (from org security policy):**
- No credentials in source — env vars only
- Never writes to Jira story-point fields — human applies estimates after review
