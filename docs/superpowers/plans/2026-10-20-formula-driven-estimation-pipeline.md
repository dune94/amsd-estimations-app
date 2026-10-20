# Formula-driven estimation pipeline (estimations app) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In `formula` mode the scope engine's formula result is the estimate (PERT retained), with confidence from baselines, versioned drafts, human review with send-back, and outputs only on instruction; `legacy` mode is unchanged.

**Architecture:** New modules beside the existing service: a scope runner (spawns the scope engine under the memory cap), a review store (new SQLite tables), pure baseline-evidence and confidence functions, a formula estimator that composes them, a review service (state machine), a sequential batch worker, routes and a server-rendered review page. The existing `createEstimationService` and its tests are not changed except for one branch on the mode.

**Tech Stack:** TypeScript (ESM, Node 20), Fastify, better-sqlite3, vitest. Run tests with `~/.claude/bin/bounded --want 2048 -- npx vitest run <file>`.

**Spec:** `docs/superpowers/specs/2026-10-20-scope-fed-estimation-pipeline-design.md` (sections 4.1 to 4.12, acceptance A1 to A10). Depends on the scope-engine plan `2026-10-20-story-pack-and-result-contract.md` for the real engine; this plan's tests use a fake engine.

## Global Constraints

- Jira and Confluence are read-only; the existing write-back path stays disabled (`OUTPUTS_ENABLED` false).
- Every subprocess runs under the memory-cap wrapper; one scope run at a time; scratch files are deleted by the run.
- All organisation-specific values live in untracked local configuration; the repository contains neutral samples only (no names, ticket keys or codelines in code, tests or docs).
- No model or provider names in published diagrams or slides.
- Everything tunable is configuration, not code (thresholds, timeouts, paths, penalties).
- `ESTIMATION_MODE=legacy|formula`, default `legacy`; per-request `mode` overrides it.
- Confidence: High / Medium / Low with reasons; missing acceptance criteria give Low.
- SP scale for band maths: `[1, 2, 3, 5, 8, 13]`; ties go to the higher band.
- Existing tests (103) must keep passing unchanged.

## Review Focus

- A scope result with a missing or unknown `schema_version`: the story is marked "no code facts" with the reason; nothing crashes (Task 3).
- Reviewer notes or driver quotes containing HTML or script text: escaped on the review page; notes over the configured length are rejected with 400 (Task 7).
- Accept or send back on a story that is running, already accepted, or acted on twice: 409, nothing changes (Tasks 6 and 7).
- Batch input that is empty, has duplicate keys, or exceeds the maximum size: 400 with a reason (Task 7).
- Restart in the middle of a batch: finished items are not re-run, a running item is re-queued exactly once (Task 7).

---

### Task 1: Mode switch

**Files:** Create `src/config/mode.ts`, `test/mode.test.ts`.

**Interfaces:** Produces `type EstimationMode = 'legacy' | 'formula'`; `resolveMode(requested?: string, env?: NodeJS.ProcessEnv): EstimationMode` (request beats env beats `legacy`; any other value throws `Error('invalid mode: <value>')`).

- [ ] **Step 1: Write the failing tests:** `test_default_is_legacy`; `test_env_formula`; `test_request_overrides_env` (env `formula`, request `legacy` gives `legacy`); `test_invalid_value_throws` (message contains `invalid mode`).
- [ ] **Step 2: Run** `test/mode.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `resolveMode` in `src/config/mode.ts`.
- [ ] **Step 4: Run** the file, then the whole suite. Expected: PASS, 103 existing tests unchanged.
- [ ] **Step 5: Commit** `feat: estimation mode switch (legacy default)`.

### Task 2: Review store

**Files:** Create `src/db/reviewStore.ts`, `test/reviewStore.test.ts`.

**Interfaces:** Produces `openReviewStore(db: Database.Database): ReviewStore` which creates (if missing) tables `batches(id TEXT PK, source TEXT, created_at TEXT, status TEXT)`, `batch_items(batch_id, issue_key, state TEXT, notes TEXT, PRIMARY KEY(batch_id, issue_key))`, `estimate_versions(issue_key, version INTEGER, batch_id, status TEXT, mode TEXT, no_code_facts INTEGER, story_hash TEXT, estimate_json TEXT, notes TEXT, created_at TEXT, PRIMARY KEY(issue_key, version))`, `review_events(id INTEGER PK AUTOINCREMENT, issue_key, version, event TEXT, notes TEXT, at TEXT)`. `ReviewStore` methods: `createBatch(keys: string[], source: string): string`; `batchItems(batchId): {issueKey; state; notes}[]`; `setItemState(batchId, key, state: 'QUEUED'|'RUNNING'|'DONE'|'FAILED', notes?: string): void`; `addVersion(v: NewVersion): EstimateVersion` (version = highest + 1, status `DRAFT`); `getVersion(key, version?): EstimateVersion | null` (latest when omitted); `listVersions(key): EstimateVersion[]`; `listBatchLatest(batchId): EstimateVersion[]`; `setStatus(key, version, status: VersionStatus, event: string, notes?: string): void` (always appends a `review_events` row); `events(key): ReviewEvent[]`. `VersionStatus = 'DRAFT'|'IN_REVIEW'|'ACCEPTED'|'SENT_BACK'|'PRESENTED'|'OUTPUT_WRITTEN'|'DELIVERED'|'CALIBRATED'`. The existing `estimates` table is not touched.

- [ ] **Step 1: Write the failing tests** (in-memory db): `test_version_increments_per_issue` (1, 2, 3; a different key starts at 1); `test_get_version_defaults_to_latest`; `test_set_status_appends_event` (one event per call, in order); `test_list_batch_latest_returns_one_row_per_key`; `test_open_twice_is_idempotent`; `test_legacy_estimates_table_unchanged` (`saveEstimate`/`getEstimate` still round-trip).
- [ ] **Step 2: Run** `test/reviewStore.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `openReviewStore` with prepared statements; the version insert and number allocation run in one transaction.
- [ ] **Step 4: Run** the file and the suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat: review store tables and repository`.

### Task 3: Scope runner

**Files:** Create `src/scope/scopeRunner.ts`, `test/scopeRunner.test.ts`, `test/fixtures/scope-result-v1.json` (neutral sample), `test/fixtures/fake-scope.sh`.

**Interfaces:** Produces `parseScopeResult(json: unknown): ScopeResultV1` (throws `Error` whose message contains `schema_version` when it is missing or not `1`); `createScopeRunner(opts: { scopeHome: string; boundedBin: string; boundedMb: number; timeoutMs: number }): ScopeRunner`; `ScopeRunner.buildPack(key: string, dir: string): Promise<{ packPath: string } | { error: string }>`; `ScopeRunner.run(key: string, packPath: string): Promise<ScopeOutcome>`; `type ScopeOutcome = { ok: true; result: ScopeResultV1; resultPath: string } | { ok: false; reason: string }`. `ScopeResultV1` has the keys in the scope plan's contract document (`schema_version`, `story_hash`, `required`, `alternatives`, `blast_required`, `planning`, `pert`, `drivers`, `inputs`, `flags`, `codelines`). Commands: `<boundedBin> --want <boundedMb> -- <scopeHome>/.venv/bin/python -u -m scope <KEY> --build-pack <dir>` and `... --run --story-pack <packPath>`, cwd `scopeHome`; the result path is read from the stdout line `result: <path>`.

- [ ] **Step 1: Write the failing tests** using `fake-scope.sh` placed at `<tmp>/.venv/bin/python` and a fake bounded script that execs its arguments: `test_parse_valid_result`; `test_parse_missing_version_throws`; `test_parse_unknown_version_throws`; `test_run_ok_reads_result` (`ok` true, `result.pert` present); `test_run_nonzero_exit_is_not_ok`; `test_run_timeout_is_not_ok` (reason `timeout`, child killed); `test_unknown_version_run_is_not_ok_with_reason` (reason contains `schema_version`); `test_every_command_starts_with_bounded` (recorded argv[0] equals `boundedBin`, argv[1..2] equal `--want`, the MB value).
- [ ] **Step 2: Run** `test/scopeRunner.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with `child_process.spawn`; kill on timeout; never throw for engine failures, return `ok: false`.
- [ ] **Step 4: Run** the file and the suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat: scope runner (pack build, run, contract check)`.

### Task 4: Baseline evidence and confidence

**Files:** Create `src/engine/baselineEvidence.ts`, `src/engine/confidence.ts`, `src/config/confidence.json` (neutral defaults), `test/baselineEvidence.test.ts`, `test/confidence.test.ts`. Modify `src/config/index.ts` (load `confidence.json`; add optional `measured` to `BaselineStory`).

**Interfaces:** Produces `bandDistance(a: number, b: number, bands: number[]): number`; `baselineEvidence(levels: { scope: string; complexity: string; risk: string; blastRadius: number }, baselines: BaselineStory[], k: number): { support: number; observedSp: number[]; medianObservedSp: number | null; closest: { key: string; sp: number; blastRadius: number }[] }` (support = baselines with `measured` at the same three levels; closest = the `k` measured baselines nearest by blast radius); `computeConfidence(input: ConfidenceInput, cfg: ConfidenceConfig): { level: 'High' | 'Medium' | 'Low'; reasons: { code: string; severity: 'major' | 'minor'; text: string }[] }` with `ConfidenceInput = { acStatus: 'complete' | 'ambiguous' | 'missing'; noCodeFacts: boolean; attachmentsRead: number; attachmentsNotRead: { filename: string; reason: string }[]; droppedDrivers: number; support: number; base: number; upper: number; estimateSp: number | null; medianObservedSp: number | null }`. Rules (spec 4.5): major = `ac_missing`, `no_code_facts`, `attachments_unread_majority` (not-read share at or above `majorUnreadShare`); minor = `ac_ambiguous`, `attachments_unread`, `drivers_dropped`, `thin_support` (support below `minSupport`), `wide_range` (upper over `maxRange` times base), `far_from_observed` (band distance to `medianObservedSp` over `bandDistance`). Any major gives Low; otherwise minors: 0 High, 1 to 2 Medium, `minorLowThreshold` or more Low. Defaults: `minSupport 3, maxRange 3, bandDistance 1, majorUnreadShare 0.5, minorLowThreshold 3, bands [1,2,3,5,8,13]`.

- [ ] **Step 1: Write the failing tests:** `test_band_distance` (5 to 8 is 1; 3 to 8 is 2; 10.5 is nearest to 13 because ties go higher); `test_evidence_support_counts_same_levels_only`; `test_evidence_closest_by_blast_radius`; `test_missing_acs_is_low` (A7); `test_no_code_facts_is_low`; `test_unread_attachments_listed_with_reason` (reason text contains the filename and the reason); `test_majority_unread_is_low`; `test_two_minors_is_medium`; `test_three_minors_is_low`; `test_no_reasons_is_high`; `test_thresholds_come_from_config` (changing `minSupport` changes the outcome).
- [ ] **Step 2: Run** both test files. Expected: FAIL.
- [ ] **Step 3: Implement** the pure functions and config loading; no I/O in the two modules.
- [ ] **Step 4: Run** the files and the suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat: baseline evidence and confidence`.

### Task 5: Formula estimator and mode branch

**Files:** Create `src/service/formulaEstimator.ts`, `test/formulaEstimator.test.ts`. Modify `src/service/estimationService.ts` (one branch), `src/engine/types.ts` (add `FormulaEstimate`).

**Interfaces:** Consumes Tasks 2 to 4 and the existing `JiraClient`, `mapJiraIssueToSignals`, `classifyEffort`. Produces `createFormulaEstimator(deps: { jira: JiraClient; scope: ScopeRunner; store: ReviewStore; baselines: BaselineStory[]; confidenceCfg: ConfidenceConfig; workDir: string; now?: () => Date }): FormulaEstimator` with `estimate(issueKey: string, o?: { batchId?: string; notes?: string }): Promise<EstimateVersion>`. The stored `estimate_json` is `FormulaEstimate = { issueKey; mode: 'formula'; sp: number | null; pert: ScopeResultV1['pert'] | null; levels: { scope; complexity; risk }; drivers; scope: ScopeResultV1 | null; inputs; confidence; baseline; noCodeFacts: boolean; reason?: string }`. Behaviour: build the pack (a fresh pack each run, folder `workDir/<key>/`), append `notes` if given, run the scope engine, compute confidence (acStatus from `classifyEffort(mapJiraIssueToSignals(raw))`), store version + 1. The SP and PERT are copied from the scope result, never recomputed (A2). On `ok: false` store a version with `noCodeFacts: true`, `sp: null`, confidence Low with reason `no_code_facts`. In `estimationService.runEstimate`, `opts.mode === 'formula'` delegates to the estimator; otherwise the existing code runs untouched. `src/routes/index.ts` passes `resolveMode(req.body?.mode)` to `runEstimate` and `runBatch` (an invalid `mode` is a 400); `src/server.ts` builds the estimator only when `SCOPE_HOME` is set.

- [ ] **Step 1: Write the failing tests** (fake runner, in-memory store, mock Jira): `test_sp_and_pert_copied_from_scope_result`; `test_missing_acs_gives_low_confidence_with_reason`; `test_scope_failure_stores_no_code_facts_version` (sp null, `noCodeFacts` true, version still created, no throw); `test_rerun_creates_next_version`; `test_notes_are_appended_to_the_pack_before_the_run` (fake runner receives a pack whose text contains the notes); `test_legacy_mode_result_identical` (the existing service with mode `legacy` returns the same object as before); `test_invalid_mode_in_request_is_400` (routes).
- [ ] **Step 2: Run** `test/formulaEstimator.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `createFormulaEstimator` and the branch in `runEstimate`.
- [ ] **Step 4: Run** the file and the suite (all 103 existing tests plus new). Expected: PASS.
- [ ] **Step 5: Commit** `feat: formula estimator (scope result is the estimate)`.

### Task 6: Review service

**Files:** Create `src/service/reviewService.ts`, `test/reviewService.test.ts`.

**Interfaces:** Consumes Task 2 and Task 5. Produces `createReviewService(deps: { store: ReviewStore; estimator: FormulaEstimator; legacyEstimate: (key: string) => Promise<EstimateVersion>; enqueue: (batchId: string, keys: string[], notes?: string) => void; maxNotesChars: number }): ReviewService` with `accept(key: string): void`; `acceptAllHigh(batchId: string): string[]` (keys accepted; only latest versions with confidence High); `sendBack(key: string, notes: string): void`; `sendBackBatch(batchId: string, notes: string): string[]`; `reopen(key: string): void`; `useLegacy(key: string): Promise<EstimateVersion>`. Errors are `class ConflictError extends Error` (maps to 409) and `class ValidationError extends Error` (maps to 400). Rules: accept only from `DRAFT`/`IN_REVIEW`; an `ACCEPTED` version is frozen (accept, send back and edits throw `ConflictError`; `reopen` is the only way back to `IN_REVIEW`); send back sets `SENT_BACK`, records the notes, enqueues a re-run; notes longer than `maxNotesChars` or empty throw `ValidationError`.

- [ ] **Step 1: Write the failing tests:** `test_accept_draft_ok`; `test_accept_twice_conflicts_and_changes_nothing`; `test_accept_all_high_skips_medium_and_low`; `test_send_back_records_notes_and_enqueues_rerun` (A6); `test_send_back_accepted_conflicts`; `test_send_back_batch_enqueues_every_story`; `test_empty_notes_rejected`; `test_notes_over_limit_rejected`; `test_reopen_allows_send_back`; `test_use_legacy_adds_a_legacy_version_and_keeps_the_formula_one` (A5).
- [ ] **Step 2: Run** the file. Expected: FAIL.
- [ ] **Step 3: Implement** the state rules in one transition table (`from -> allowed actions`) so every action checks the same table.
- [ ] **Step 4: Run** the file and the suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat: review service (accept, send back, reopen)`.

### Task 7: Batch worker, routes, review page

**Files:** Create `src/service/batchWorker.ts`, `src/reporting/reviewPage.ts`, `test/batchWorker.test.ts`, `test/reviewRoutes.test.ts`, `test/reviewPage.test.ts`. Modify `src/routes/index.ts`, `src/server.ts` (wire store, runner, worker).

**Interfaces:** Produces `createBatchWorker(deps: { store: ReviewStore; estimator: FormulaEstimator; maxBatchSize: number }): BatchWorker` with `createBatch(keys: string[], source: string): string` (validates: non-empty, unique, at most `maxBatchSize`, else `ValidationError`); `enqueue(batchId: string, keys: string[], notes?: string): void`; `start(): void` (resumes: items `RUNNING` become `QUEUED` once; `DONE` are never re-run); `progress(batchId): { total; done; failed; running: string | null }`; strictly one story at a time; when a story's estimate finishes its version moves `DRAFT` to `IN_REVIEW`. `renderReviewPage(batchId: string, rows: ReviewRow[]): string` (pure HTML; every interpolated value HTML-escaped). Routes: `POST /batches` (body `{ jql?: string; keys?: string[] }`, 202 `{ batchId }`), `GET /batches/:id` (progress), `GET /review/:batchId` (page), `POST /review/:key/accept`, `POST /review/:key/send-back` (`{ notes }`), `POST /review/:key/reopen`, `POST /review/:key/use-legacy`, `POST /batches/:id/accept-high`, `POST /batches/:id/send-back` (`{ notes }`); `ConflictError` maps to 409, `ValidationError` to 400.

- [ ] **Step 1: Write the failing tests:** `test_worker_runs_one_at_a_time` (the fake estimator records overlap; max concurrency 1); `test_worker_resume_skips_done_and_requeues_running_once`; `test_worker_failed_story_does_not_stop_batch`; `test_finished_story_moves_to_in_review`; `test_create_batch_rejects_empty_duplicates_and_oversize`; `test_progress_counts`; `test_review_page_escapes_html_in_notes_and_quotes` (input `<script>alert(1)</script>` appears only escaped); `test_review_page_shows_confidence_reasons_inputs_not_read_analogues_and_version_history`; `test_routes_status_codes` (202, 200, 400, 409 each reached by one request); `test_send_back_over_limit_is_400`.
- [ ] **Step 2: Run** the three files. Expected: FAIL.
- [ ] **Step 3: Implement** worker (loop with a single in-flight promise), page and routes; the review page is plain HTML with forms posting to the routes, no client framework.
- [ ] **Step 4: Run** the files and the suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat: batches, review routes and page`.

### Task 8: Present and outputs guard

**Files:** Create `src/service/outputs.ts`, `test/outputs.test.ts`. Modify `src/routes/index.ts`.

**Interfaces:** Produces `createOutputs(deps: { store: ReviewStore; env: NodeJS.ProcessEnv; render: (v: EstimateVersion) => { title: string; html: string }; write?: (target: 'preview' | 'jiraSp', payload: unknown) => Promise<void> }): Outputs` with `present(key: string): EstimateVersion` (only an `ACCEPTED` version becomes `PRESENTED`, else `ConflictError`) and `publish(key: string, target: 'preview' | 'jiraSp', o?: { dryRun?: boolean }): Promise<{ dryRun: boolean; payload: unknown }>`. Default is a dry run. A real write needs `dryRun: false` and `env.OUTPUTS_ENABLED === 'true'` and a `PRESENTED` version; otherwise a dry run result with the reason (never a write). Routes: `POST /estimates/:key/present`, `POST /estimates/:key/publish`.

- [ ] **Step 1: Write the failing tests:** `test_present_requires_accepted`; `test_publish_defaults_to_dry_run_and_never_writes`; `test_real_write_needs_flag_and_explicit_dry_run_false` (A8: with the flag off, `write` is not called even if `dryRun: false`); `test_publish_refuses_unpresented`; `test_write_called_once_when_all_conditions_hold`.
- [ ] **Step 2: Run** `test/outputs.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the guard in one function used by both targets; the status moves to `OUTPUT_WRITTEN` only after a real write.
- [ ] **Step 4: Run** the file and the suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat: present and guarded outputs`.

### Task 9: Data scripts (measured baselines, learn, back-test)

**Files:** Create `src/scripts/buildMeasuredBaselines.ts`, `src/scripts/learn.ts`, `src/scripts/backtest.ts`, `src/engine/backtestMath.ts`, `test/backtestMath.test.ts`, `test/buildMeasuredBaselines.test.ts`.

**Interfaces:** Produces pure functions `withinOneBand(forecast: number, actual: number, bands: number[]): boolean`, `backtestReport(rows: { key: string; forecastSp: number; formulaSp: number; acceptedSp: number | null }[], bands: number[]): { n: number; withinOneBand: number; share: number; meanErrorVsFormula: number; meanErrorVsAccepted: number | null; passes: boolean }` (`passes` compares `share` with `config backtest.minShare`, default 0.88); `mergeMeasured(baselines: BaselineStory[], calibration: CalibrationRow[]): BaselineStory[]` (adds the `measured` block to matching keys only; leaves others untouched and unflagged-as-proxy); `proposeRows(delivered: DeliveredRow[], baselines: BaselineStory[]): BaselineStory[]` (never writes; returns proposals). Scripts take file paths as arguments, read private data from the untracked local configuration, and write only to a path given on the command line.

- [ ] **Step 1: Write the failing tests:** `test_within_one_band` (5 vs 8 true; 3 vs 8 false); `test_report_share_and_pass_threshold` (7 of 8 within gives share 0.875 and `passes` false at 0.88; 8 of 9 gives true); `test_merge_adds_measured_only_to_matching_keys`; `test_propose_rows_does_not_mutate_input`.
- [ ] **Step 2: Run** both files. Expected: FAIL.
- [ ] **Step 3: Implement** the pure modules, then thin CLI wrappers; the back-test script prints the report and exits non-zero when `passes` is false.
- [ ] **Step 4: Run** the files and the suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat: measured baselines, learn proposals, back-test report`.

### Task 10: Configuration, docs, installer, installed copy

**Files:** Modify `.env.example`, `README.md`, `BACKLOG.md`, `npm-package/estimations-app/install.sh` (only if new keys need the same handling), `docs/superpowers/specs/...-design.md` (status line). Create `test/envExample.test.ts`.

**Interfaces:** New `.env.example` keys (blank values): `ESTIMATION_MODE`, `SCOPE_HOME`, `SCOPE_BOUNDED`, `SCOPE_TIMEOUT_MS`, `SCOPE_WORK_DIR`, `OUTPUTS_ENABLED`, `MAX_BATCH_SIZE`, `MAX_NOTES_CHARS`.

- [ ] **Step 1: Write the failing test** `test_every_env_var_read_in_src_is_in_env_example` (scans `src` for `process.env.NAME`, asserts each is a key in `.env.example`).
- [ ] **Step 2: Run** it. Expected: FAIL (new keys missing).
- [ ] **Step 3: Add** the keys, document the mode switch, the review page, the send-back flow and the confidence reasons in `README.md` (neutral wording), mark EST-BL-001 "implemented" in `BACKLOG.md`.
- [ ] **Step 4: Run** the whole suite, `npx tsc -p tsconfig.json --noEmit`, and the neutrality scan used before each commit. Expected: all pass, clean.
- [ ] **Step 5: Sync the installed copy** (`installed/estimations-app`: copy changed files, `npm run build`, run its tests under the cap), then **Commit** `docs: configuration, README and backlog for the formula pipeline`.
