// ── Review service ─────────────────────────────────────────────────────────
// Human review of formula drafts: accept, send back (one story or a whole batch, with notes), reopen, and fall back to the
// legacy engine. One transition table decides what is allowed from each status; an accepted version is frozen.

import type { EstimateVersion, ReviewStore, VersionStatus } from '../db/reviewStore.js';

export class ConflictError extends Error {}   // 409: the action is not allowed in the story's current state
export class ValidationError extends Error {} // 400: the input is not acceptable

export interface ReviewServiceDeps {
  store: ReviewStore;
  /** Queues a re-run of the given stories in a batch; notes are added to the story pack. */
  enqueue: (batchId: string, keys: string[], notes?: string) => void;
  /** Runs the legacy engine for one story and stores the result as a new `legacy` version. */
  legacyEstimate: (key: string) => Promise<EstimateVersion>;
  maxNotesChars: number;
}

export interface ReviewService {
  accept(key: string): void;
  acceptAllHigh(batchId: string): string[];
  sendBack(key: string, notes: string): void;
  sendBackBatch(batchId: string, notes: string): string[];
  reopen(key: string): void;
  useLegacy(key: string): Promise<EstimateVersion>;
}

type Action = 'accept' | 'sendBack' | 'reopen' | 'useLegacy';
const ALLOWED: Record<Action, VersionStatus[]> = {
  accept: ['DRAFT', 'IN_REVIEW'],
  sendBack: ['DRAFT', 'IN_REVIEW'],
  reopen: ['ACCEPTED'],
  useLegacy: ['DRAFT', 'IN_REVIEW', 'SENT_BACK'],
};

export function createReviewService(deps: ReviewServiceDeps): ReviewService {
  const { store } = deps;

  function latest(key: string, action: Action): EstimateVersion {
    const v = store.getVersion(key);
    if (!v) throw new ConflictError(`no estimate for ${key} yet`);
    if (!ALLOWED[action].includes(v.status)) throw new ConflictError(`${key} is ${v.status}; ${action} is not allowed`);
    return v;
  }

  function checkNotes(notes: string): string {
    const text = (notes ?? '').trim();
    if (!text) throw new ValidationError('notes are required');
    if (text.length > deps.maxNotesChars) throw new ValidationError(`notes are longer than ${deps.maxNotesChars} characters`);
    return text;
  }

  /**
   * The notes for the re-run: what the version being sent back already carried (each version stores the full set it ran with)
   * plus the new note, because every re-run rebuilds the pack from the ticket. Over the limit, the oldest text is dropped.
   */
  function accumulated(v: EstimateVersion, notes: string): string {
    const all = [v.notes, notes].filter((n): n is string => !!n).join('\n\n');
    return all.length > deps.maxNotesChars ? all.slice(-deps.maxNotesChars) : all;
  }

  function sendBackOne(v: EstimateVersion, notes: string): void {
    const batchId = v.batchId ?? store.createBatch([v.issueKey], 'send-back');
    store.setStatus(v.issueKey, v.version, 'SENT_BACK', 'send_back', notes);
    store.setItemState(batchId, v.issueKey, 'QUEUED', notes);
    deps.enqueue(batchId, [v.issueKey], accumulated(v, notes));
  }

  return {
    accept(key) {
      const v = latest(key, 'accept');
      store.setStatus(key, v.version, 'ACCEPTED', 'accept');
    },

    acceptAllHigh(batchId) {
      const accepted: string[] = [];
      for (const v of store.listBatchLatest(batchId)) {
        const level = (v.estimate as { confidence?: { level?: string } })?.confidence?.level;
        if (ALLOWED.accept.includes(v.status) && !v.noCodeFacts && level === 'High') {
          store.setStatus(v.issueKey, v.version, 'ACCEPTED', 'accept');
          accepted.push(v.issueKey);
        }
      }
      return accepted;
    },

    sendBack(key, notes) {
      const text = checkNotes(notes);
      sendBackOne(latest(key, 'sendBack'), text);
    },

    sendBackBatch(batchId, notes) {
      const text = checkNotes(notes);
      const sent: string[] = [];
      for (const v of store.listBatchLatest(batchId)) {
        if (!ALLOWED.sendBack.includes(v.status)) continue; // accepted and later stories are frozen; they need an explicit reopen
        sendBackOne(v, text);
        sent.push(v.issueKey);
      }
      return sent;
    },

    reopen(key) {
      const v = latest(key, 'reopen');
      store.setStatus(key, v.version, 'IN_REVIEW', 'reopen');
    },

    async useLegacy(key) {
      latest(key, 'useLegacy');
      return deps.legacyEstimate(key);
    },
  };
}
