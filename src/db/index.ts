// ── SQLite access layer ──────────────────────────────────────────────────────
// Zero external infra for v1. Schema: estimates (one row per computed
// estimate, latest wins per issueKey via upsert), historical_comps (recorded
// actuals for future recalibration — seeded empty, grows via
// recordHistoricalComp).

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { EstimateResult } from '../engine/types.js';

export interface EstimatesDb {
  db: Database.Database;
  saveEstimate(result: EstimateResult): void;
  getEstimate(issueKey: string): EstimateResult | null;
  listEstimates(limit?: number): EstimateResult[];
  recordHistoricalComp(issueKey: string, actualSp: number, notes?: string): void;
}

export function openDb(filePath: string): EstimatesDb {
  if (filePath !== ':memory:') {
    mkdirSync(dirname(filePath), { recursive: true });
  }
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS estimates (
      issue_key TEXT PRIMARY KEY,
      result_json TEXT NOT NULL,
      generated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS historical_comps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_key TEXT NOT NULL,
      actual_sp REAL NOT NULL,
      notes TEXT,
      recorded_at TEXT NOT NULL
    );
  `);

  const upsertStmt = db.prepare(`
    INSERT INTO estimates (issue_key, result_json, generated_at)
    VALUES (@issueKey, @resultJson, @generatedAt)
    ON CONFLICT(issue_key) DO UPDATE SET
      result_json = excluded.result_json,
      generated_at = excluded.generated_at
  `);

  const getStmt = db.prepare('SELECT result_json FROM estimates WHERE issue_key = ?');
  const listStmt = db.prepare('SELECT result_json FROM estimates ORDER BY generated_at DESC LIMIT ?');
  const insertCompStmt = db.prepare(`
    INSERT INTO historical_comps (issue_key, actual_sp, notes, recorded_at)
    VALUES (?, ?, ?, ?)
  `);

  return {
    db,
    saveEstimate(result) {
      upsertStmt.run({
        issueKey: result.issueKey,
        resultJson: JSON.stringify(result),
        generatedAt: result.generatedAt,
      });
    },
    getEstimate(issueKey) {
      const row = getStmt.get(issueKey) as { result_json: string } | undefined;
      return row ? (JSON.parse(row.result_json) as EstimateResult) : null;
    },
    listEstimates(limit = 50) {
      const rows = listStmt.all(limit) as { result_json: string }[];
      return rows.map(r => JSON.parse(r.result_json) as EstimateResult);
    },
    recordHistoricalComp(issueKey, actualSp, notes) {
      insertCompStmt.run(issueKey, actualSp, notes ?? null, new Date().toISOString());
    },
  };
}
