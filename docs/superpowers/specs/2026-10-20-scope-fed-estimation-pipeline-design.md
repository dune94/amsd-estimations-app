# Formula-driven estimation pipeline — design

Status: DRAFT for approval. Backlog item EST-BL-001. Written 2026-10-20, revised after the owner interview. Marks: **[decided]** = said or approved by the owner; **[my call]** = a choice made here that the owner has not confirmed.

## 1. Intent and why

The estimations app sizes a story with a three-lens PERT anchored on baseline stories. Its "code facts" are guesses: *files impacted* is the number of Jira components, and *external dependency* and *new component* come from labels.

The organisation is moving to a **Scope + Complexity + Risk formula** for story points. A separate project, the **scope engine**, applies it: it measures the code facts (changed files, files that depend on them, tests, external systems, new files), counts Complexity and Risk drivers from the ticket (each backed by a quoted line) and returns SP and a PERT range.

This design makes **the formula drive the estimate, with PERT retained** **[decided]**, in one pipeline: intake → scope run → estimate with confidence → draft → human review (accept, or send one story or a whole batch back) → present → outputs on instruction → learn. The previous estimation no longer drives the number; it stays available behind a switch so its behaviour is not lost **[decided]**. The baselines are processed PI-10/PI-11 delivered stories; their job is to **increase confidence** in an estimate **[decided]**, not to set it.

## 2. Goals, non-goals, anti-goals

Goals
- G1 The formula result (SP and PERT range) from the scope engine is the estimate.
- G2 Each estimate carries a **confidence** reading with the reasons, built from the baselines and from what the pipeline could and could not see.
- G3 Human review: accept, or send one story or the whole batch back with notes, which re-runs through the pipeline.
- G4 Every re-run is a new saved version; nothing is overwritten silently.
- G5 Outputs (preview page, Jira SP field) are written only when explicitly instructed.
- G6 After delivery, results feed back to improve the baselines and the calibration.
- G7 With the switch set to legacy, the app behaves exactly as it does today.
- G8 Every stage saves its output, so a story can be re-run from the right stage.

Non-goals
- No change to the formula inside the app; the scope engine owns it.
- No automatic writes to Jira or Confluence.
- No parallel batch execution; no logins or multiple user accounts.
- No historical backfill beyond baselines that already have measured facts.

Anti-goals (a failure even if it technically works)
- An estimate that changes between views without a new version.
- A reviewer who cannot see why a number is what it is, or how far to trust it.
- A scope-stage failure that blocks an estimate.
- Organisation-specific content (names, ticket keys, codelines) committed to the repository.
- A run that exhausts memory or disk.

## 3. Constraints

- Jira and Confluence are read-only until the owner lifts that **[decided]**; the existing write-back path stays disabled.
- Every subprocess runs under the memory-cap wrapper; one scope run at a time; scratch files are deleted by the run **[decided]**.
- All organisation-specific values live in untracked local configuration; the repository contains neutral samples only **[decided]**.
- No model or provider names appear in published diagrams or slides **[decided]**.
- Everything tunable is configuration, not code (thresholds, timeouts, paths, penalties).

## 4. The pipeline

### 4.1 Switch
`ESTIMATION_MODE=legacy|formula` (app-wide) and a per-request `mode` **[my call]**. `legacy` = today's engine, unchanged. `formula` = this pipeline. The default stays `legacy` until the owner changes it **[my call]**.

### 4.2 Stage 1 — Intake
Input: a Jira key, or a JQL query (a batch with an id). Output: a **story pack**: title, description, acceptance criteria, comments, attachment text and images, linked-page text, read-only, saved with a content hash. A changed hash on re-run means the ticket changed.

### 4.3 Stage 2 — Scope run
The app writes the story pack to a file and runs the scope engine as a command (`SCOPE_HOME` points at its installed folder) with `--story-pack <file>`, under the memory cap, with a timeout from configuration, and reads its `result.json`. Both stages therefore see exactly the same text, including any reviewer notes **[my call]**.
Contract v1 (the app refuses an unknown version): codelines (required, alternatives); per-codeline BASE and UPPER change sets; blast radius BASE and UPPER broken into changed / dependent / test files / external systems / new files; the Scope, Complexity and Risk levels; Complexity and Risk drivers each with quote, date and source; **planning SP and the PERT range (optimistic, most likely, pessimistic, expected)**; what inputs were read and not read (attachments, linked pages) with reasons; flags; the manifest path; `schema_version`; `story_hash`.
Failure or timeout: no formula estimate can be made. The story is marked `no code facts`, the reason is shown, and the reviewer may run it again or fall back to the legacy engine for that story. It never blocks the rest of a batch.

### 4.4 Stage 3 — The estimate
The estimate is the scope engine's result: Scope (from the blast radius) + Complexity + Risk give a score and an SP band; for planning stories (not yet elaborated) the planning calibration applies (blast radius × a configured multiplier, plus one driver each for Complexity and Risk). **PERT is retained:** optimistic from the BASE blast radius, most likely from BASE with the planning calibration, pessimistic from UPPER with it; the expected value is (O + 4M + P) / 6, converted to SP by the same formula **[decided]**. The app displays these numbers; it does not recompute them.

### 4.5 Baselines and confidence
Baseline stories are the processed delivered PI-10/PI-11 stories. Those with measured facts carry a `measured` block (the same facts) and the observed SP; building these blocks from the processed calibration data is a script that writes to the untracked local configuration.

For each estimate the app builds **confidence: High / Medium / Low, with the list of reasons** **[decided]**. Reasons and default weight (all configurable **[my call]**):
- Major (any one gives Low): acceptance criteria **missing** **[decided: lowers confidence]**; no code facts (stage 2 failed); half or more of the attachments not read.
- Minor (one or two give Medium; three or more give Low): acceptance criteria ambiguous; some attachments not read (each listed with its reason, e.g. unsupported type or over the size cap); driver quotes dropped as too weak; fewer than `minSupport` delivered baselines at the same Scope, Complexity and Risk levels; UPPER more than `maxRange` times BASE; the estimate more than one band from the observed SP of its closest baselines.
- No reasons: High.
Missing acceptance criteria also count as a Risk driver in the formula, so they affect both the number and the confidence.

The baselines are also shown to the reviewer as "compared to": the observed SP at the same levels and the nearest delivered stories by blast radius.

### 4.6 Stage 4 — Draft store
A draft is stored with: estimate, PERT range, confidence and reasons, scope facts, manifest path, baseline evidence, drivers with quotes, inputs read / not read, inputs hash, the configuration and engine versions, version number, batch id. Existing estimate history is kept; new tables are added by migration.

### 4.7 States
`DRAFT → IN_REVIEW → ACCEPTED → PRESENTED → OUTPUT_WRITTEN → DELIVERED → CALIBRATED`, and `IN_REVIEW → SENT_BACK(notes) → RE_RUN → DRAFT (version + 1)`. An accepted version is frozen; changing it needs an explicit reopen.

### 4.8 Review
A human reviews every estimate **[decided]**. The place is a small server-rendered review page per batch, plus the same actions as an API **[my call: the owner did not name a place]**: accept one story; accept all stories with High confidence; send one story back with notes; send the whole batch back with notes. For each story the page shows: the SP and PERT range, the confidence with its reasons, the measured facts, the drivers with their quotes, the inputs not read, the "compared to" baselines, the flags, and the version history.
Send back: re-runs from stage 2 (from stage 1 if the ticket hash changed). The reviewer's notes are added to the story pack under a "reviewer notes" heading, with the date, so the agents see them. The previous version is kept.

### 4.9 Batch execution
A batch runs sequentially in the background with a progress endpoint; a restart resumes unfinished stories **[my call]**. Maximum batch size is configuration. A whole-batch send-back re-runs every story in it.

### 4.10 Present and output
Present: accepted estimates only (card, report, SP and range, confidence, versions used). Outputs: a separate explicit call per target; each defaults to a dry run showing what would be written; real writes require `OUTPUTS_ENABLED=true`, which stays false while the read-only rule stands.

### 4.11 Learn
A command takes delivered stories, measures the real blast radius from their commits with the scope engine's measure, compares with the forecast and the accepted SP, and writes proposed new measured baseline rows for review. It never changes the baselines on its own.

### 4.12 Changes needed in the scope engine (a dependency)
- `--story-pack <file>`: use the supplied story pack (title, text, image paths) instead of fetching from Jira; the fetch path stays the default.
- `result.json` gets `schema_version`, `story_hash`, and the PERT range as a named block (today it is under `planning.pert`).
- Optional later: `--as-of <date>` (scope backlog SC-BL-001). Not required by this design.
These are tracked in the scope engine's own backlog and built and tested there first.

## 5. Acceptance (tests are written from this list)

- A1 With the switch on `legacy`, every existing test passes unchanged and results are identical.
- A2 With `formula`, the displayed SP and PERT range equal the scope result for a fixed sample of results; the app does not recompute them.
- A3 A scope failure or timeout marks the story `no code facts`, does not block the batch, and leaves the story re-runnable.
- A4 An unknown contract version is refused with a clear error.
- A5 Each re-run creates version + 1; earlier versions remain readable; an accepted version cannot change without reopen.
- A6 Send back one story re-runs only that story; send back a batch re-runs all; notes reach the story pack; a changed ticket hash restarts at stage 1.
- A7 Confidence: missing acceptance criteria give Low; attachments not read are listed with reasons; minor reasons combine as in 4.5; thresholds come from configuration.
- A8 No output is written without an explicit call and `OUTPUTS_ENABLED=true`; the default is a dry run.
- A9 Every subprocess starts under the memory cap wrapper.
- A10 Back-test on delivered stories with measured facts: the forecast made from the pre-change ticket and code lands within one band of the formula applied to the real delivered change for at least as many stories as the manual planning calibration did (88% within one band in the earlier fit) **[decided]**; the report also shows error and bias against accepted SP.

## 6. Left to the builder
Module layout; migration mechanics; queue implementation; review page styling; endpoint naming beyond those above; the exact shape of the progress endpoint.

## 7. Open items
- The place of review is **[my call]** (a page in the app). The owner may change it without changing the rest of the design.
- Confidence thresholds (`minSupport`, `maxRange`, penalties) are my defaults, to be tuned on the back-test.
