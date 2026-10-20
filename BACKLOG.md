# Backlog: estimations app

Each item starts with a spec, then tests from the spec (no invented requirements). IDs are stable; do not reuse them.

| ID | Added | Item | What to do | Owner / needs |
|---|---|---|---|---|
| EST-BL-001 | 2026-10-20 | **Formula-driven estimation pipeline.** The Scope + Complexity + Risk formula (applied by the scope engine, a separate project) drives the estimate and PERT is retained; the previous estimation stays available behind a switch. Baselines increase confidence (shown with reasons; missing acceptance criteria lower it). Human review: accept, or send one story or the whole batch back with notes. Outputs only on instruction; results feed back to improve baselines and calibration. | Design: `docs/superpowers/specs/2026-10-20-scope-fed-estimation-pipeline-design.md` (awaiting approval), then a plan, then tests from its acceptance list. Needs three changes in the scope engine first (`--story-pack`, `schema_version` / `story_hash`, a named PERT block). Jira and Confluence stay read-only. | Implemented on branch `feat/formula-pipeline` (10 tasks, tests green); awaiting the final review and the owner's merge. Needs the scope engine's story-pack and contract changes (done on its own branch) |
