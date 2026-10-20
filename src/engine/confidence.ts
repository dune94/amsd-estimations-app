// ── Confidence ─────────────────────────────────────────────────────────────
// High / Medium / Low with the reasons, from what the pipeline could and could not see and from the baselines.
// Any major reason gives Low; otherwise minor reasons: none = High, fewer than minorLowThreshold = Medium, else Low.
// Pure function; every threshold comes from the configuration.

import type { ConfidenceConfig } from '../config/index.js';
import { bandDistance } from './baselineEvidence.js';

export interface ConfidenceInput {
  acStatus: 'complete' | 'ambiguous' | 'missing';
  noCodeFacts: boolean;
  attachmentsRead: number;
  attachmentsNotRead: { filename: string; reason: string }[];
  droppedDrivers: number;
  support: number;
  base: number;
  upper: number;
  estimateSp: number | null;
  medianObservedSp: number | null;
}

export interface ConfidenceReason { code: string; severity: 'major' | 'minor'; text: string }
export interface Confidence { level: 'High' | 'Medium' | 'Low'; reasons: ConfidenceReason[] }

export function computeConfidence(i: ConfidenceInput, cfg: ConfidenceConfig): Confidence {
  const reasons: ConfidenceReason[] = [];
  const add = (code: string, severity: 'major' | 'minor', text: string) => reasons.push({ code, severity, text });

  if (i.acStatus === 'missing') add('ac_missing', 'major', 'Acceptance criteria are missing.');
  if (i.acStatus === 'ambiguous') add('ac_ambiguous', 'minor', 'Acceptance criteria are ambiguous.');
  if (i.noCodeFacts) add('no_code_facts', 'major', 'The code could not be measured, so there are no code facts.');

  const unread = i.attachmentsNotRead.length;
  if (unread > 0) {
    const total = unread + i.attachmentsRead;
    const list = i.attachmentsNotRead.map(a => `${a.filename} (${a.reason})`).join(', ');
    if (unread / total >= cfg.majorUnreadShare) add('attachments_unread_majority', 'major', `${unread} of ${total} attachments were not read: ${list}.`);
    else add('attachments_unread', 'minor', `Not read: ${list}.`);
  }
  if (i.droppedDrivers > 0) add('drivers_dropped', 'minor', `${i.droppedDrivers} driver(s) were dropped as too weakly evidenced.`);

  if (!i.noCodeFacts) {
    if (i.support < cfg.minSupport) add('thin_support', 'minor', `Only ${i.support} delivered baseline(s) at the same levels (need ${cfg.minSupport}).`);
    if (i.base > 0 && i.upper > cfg.maxRange * i.base) add('wide_range', 'minor', `UPPER (${i.upper}) is more than ${cfg.maxRange} times BASE (${i.base}).`);
    if (i.estimateSp !== null && i.medianObservedSp !== null && bandDistance(i.estimateSp, i.medianObservedSp, cfg.bands) > cfg.bandDistance) {
      add('far_from_observed', 'minor', `The estimate (${i.estimateSp} SP) is more than ${cfg.bandDistance} band(s) from the median of similar delivered stories (${i.medianObservedSp} SP).`);
    }
  }

  const minors = reasons.filter(r => r.severity === 'minor').length;
  const level = reasons.some(r => r.severity === 'major') ? 'Low' : minors === 0 ? 'High' : minors < cfg.minorLowThreshold ? 'Medium' : 'Low';
  return { level, reasons };
}
