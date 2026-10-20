// ── Review store ───────────────────────────────────────────────────────────
// Versioned drafts, review events and batch queues for the formula pipeline. Lives in the same SQLite file as the
// legacy `estimates` table, which is not touched. Every re-run is a new version; nothing is overwritten.

import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

export type VersionStatus =
  | 'DRAFT' | 'IN_REVIEW' | 'ACCEPTED' | 'SENT_BACK' | 'PRESENTED' | 'OUTPUT_WRITTEN' | 'DELIVERED' | 'CALIBRATED';
export type ItemState = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';

export interface NewVersion {
  issueKey: string;
  batchId: string | null;
  mode: 'legacy' | 'formula';
  noCodeFacts: boolean;
  storyHash: string | null;
  estimate: unknown;
  notes: string | null;
}

export interface EstimateVersion extends NewVersion {
  version: number;
  status: VersionStatus;
  createdAt: string;
}

export interface ReviewEvent { id: number; issueKey: string; version: number; event: string; notes: string | null; at: string }
export interface BatchItem { issueKey: string; state: ItemState; notes: string | null }

export interface ReviewStore {
  createBatch(keys: string[], source: string): string;
  batchItems(batchId: string): BatchItem[];
  setItemState(batchId: string, key: string, state: ItemState, notes?: string): void;
  addVersion(v: NewVersion): EstimateVersion;
  getVersion(key: string, version?: number): EstimateVersion | null;
  listVersions(key: string): EstimateVersion[];
  listBatchLatest(batchId: string): EstimateVersion[];
  setStatus(key: string, version: number, status: VersionStatus, event: string, notes?: string): void;
  events(key: string): ReviewEvent[];
  /** The oldest queued batch item (older batches first, then in batch order), or null. */
  nextQueued(): { batchId: string; issueKey: string; notes: string | null } | null;
  /** Puts items left RUNNING by a crash or restart back in the queue; returns how many. */
  resetRunning(): number;
}

interface Row {
  issue_key: string; version: number; batch_id: string | null; status: VersionStatus; mode: 'legacy' | 'formula';
  no_code_facts: number; story_hash: string | null; estimate_json: string; notes: string | null; created_at: string;
}

const toVersion = (r: Row): EstimateVersion => ({
  issueKey: r.issue_key, version: r.version, batchId: r.batch_id, status: r.status, mode: r.mode,
  noCodeFacts: r.no_code_facts === 1, storyHash: r.story_hash, estimate: JSON.parse(r.estimate_json),
  notes: r.notes, createdAt: r.created_at,
});

export function openReviewStore(db: Database.Database): ReviewStore {
  db.exec(`
    CREATE TABLE IF NOT EXISTS batches (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN'
    );
    CREATE TABLE IF NOT EXISTS batch_items (
      batch_id TEXT NOT NULL, issue_key TEXT NOT NULL, state TEXT NOT NULL, notes TEXT,
      seq INTEGER NOT NULL, PRIMARY KEY (batch_id, issue_key)
    );
    CREATE TABLE IF NOT EXISTS estimate_versions (
      issue_key TEXT NOT NULL, version INTEGER NOT NULL, batch_id TEXT, status TEXT NOT NULL, mode TEXT NOT NULL,
      no_code_facts INTEGER NOT NULL, story_hash TEXT, estimate_json TEXT NOT NULL, notes TEXT, created_at TEXT NOT NULL,
      PRIMARY KEY (issue_key, version)
    );
    CREATE TABLE IF NOT EXISTS review_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, issue_key TEXT NOT NULL, version INTEGER NOT NULL,
      event TEXT NOT NULL, notes TEXT, at TEXT NOT NULL
    );
  `);

  const insertBatch = db.prepare('INSERT INTO batches (id, source, created_at) VALUES (?, ?, ?)');
  const insertItem = db.prepare('INSERT INTO batch_items (batch_id, issue_key, state, seq) VALUES (?, ?, ?, ?)');
  const itemsStmt = db.prepare('SELECT issue_key, state, notes FROM batch_items WHERE batch_id = ? ORDER BY seq');
  const itemState = db.prepare('UPDATE batch_items SET state = ?, notes = COALESCE(?, notes) WHERE batch_id = ? AND issue_key = ?');
  const maxVersion = db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM estimate_versions WHERE issue_key = ?');
  const insertVersion = db.prepare(`
    INSERT INTO estimate_versions (issue_key, version, batch_id, status, mode, no_code_facts, story_hash, estimate_json, notes, created_at)
    VALUES (@issueKey, @version, @batchId, 'DRAFT', @mode, @noCodeFacts, @storyHash, @estimateJson, @notes, @createdAt)`);
  const getLatest = db.prepare('SELECT * FROM estimate_versions WHERE issue_key = ? ORDER BY version DESC LIMIT 1');
  const getOne = db.prepare('SELECT * FROM estimate_versions WHERE issue_key = ? AND version = ?');
  const listAll = db.prepare('SELECT * FROM estimate_versions WHERE issue_key = ? ORDER BY version');
  const batchLatest = db.prepare(`
    SELECT v.* FROM estimate_versions v
    JOIN (SELECT issue_key, MAX(version) AS mv FROM estimate_versions WHERE batch_id = ? GROUP BY issue_key) m
      ON v.issue_key = m.issue_key AND v.version = m.mv
    ORDER BY v.issue_key`);
  const setStatusStmt = db.prepare('UPDATE estimate_versions SET status = ? WHERE issue_key = ? AND version = ?');
  const insertEvent = db.prepare('INSERT INTO review_events (issue_key, version, event, notes, at) VALUES (?, ?, ?, ?, ?)');
  const nextQueuedStmt = db.prepare(`
    SELECT i.batch_id, i.issue_key, i.notes FROM batch_items i JOIN batches b ON b.id = i.batch_id
    WHERE i.state = 'QUEUED' ORDER BY b.rowid, i.seq LIMIT 1`);
  const resetRunningStmt = db.prepare("UPDATE batch_items SET state = 'QUEUED' WHERE state = 'RUNNING'");
  const eventsStmt = db.prepare('SELECT id, issue_key, version, event, notes, at FROM review_events WHERE issue_key = ? ORDER BY id');

  const addVersionTx = db.transaction((v: NewVersion): EstimateVersion => {
    const version = (maxVersion.get(v.issueKey) as { v: number }).v + 1;
    insertVersion.run({
      issueKey: v.issueKey, version, batchId: v.batchId, mode: v.mode, noCodeFacts: v.noCodeFacts ? 1 : 0,
      storyHash: v.storyHash, estimateJson: JSON.stringify(v.estimate), notes: v.notes, createdAt: new Date().toISOString(),
    });
    return toVersion(getOne.get(v.issueKey, version) as Row);
  });

  const createBatchTx = db.transaction((keys: string[], source: string): string => {
    const id = `b_${randomUUID().slice(0, 8)}`;
    insertBatch.run(id, source, new Date().toISOString());
    keys.forEach((k, i) => insertItem.run(id, k, 'QUEUED', i));
    return id;
  });

  const setStatusTx = db.transaction((key: string, version: number, status: VersionStatus, event: string, notes?: string) => {
    setStatusStmt.run(status, key, version);
    insertEvent.run(key, version, event, notes ?? null, new Date().toISOString());
  });

  return {
    createBatch: (keys, source) => createBatchTx(keys, source),
    batchItems: batchId => (itemsStmt.all(batchId) as { issue_key: string; state: ItemState; notes: string | null }[])
      .map(r => ({ issueKey: r.issue_key, state: r.state, notes: r.notes })),
    setItemState: (batchId, key, state, notes) => { itemState.run(state, notes ?? null, batchId, key); },
    addVersion: v => addVersionTx(v),
    getVersion: (key, version) => {
      const r = (version === undefined ? getLatest.get(key) : getOne.get(key, version)) as Row | undefined;
      return r ? toVersion(r) : null;
    },
    listVersions: key => (listAll.all(key) as Row[]).map(toVersion),
    listBatchLatest: batchId => (batchLatest.all(batchId) as Row[]).map(toVersion),
    setStatus: (key, version, status, event, notes) => setStatusTx(key, version, status, event, notes),
    nextQueued: () => {
      const r = nextQueuedStmt.get() as { batch_id: string; issue_key: string; notes: string | null } | undefined;
      return r ? { batchId: r.batch_id, issueKey: r.issue_key, notes: r.notes } : null;
    },
    resetRunning: () => resetRunningStmt.run().changes,
    events: key => (eventsStmt.all(key) as { id: number; issue_key: string; version: number; event: string; notes: string | null; at: string }[])
      .map(r => ({ id: r.id, issueKey: r.issue_key, version: r.version, event: r.event, notes: r.notes, at: r.at })),
  };
}
