// ── RBU (Requesting Business Unit) Classifier ───────────────────────────────

import { rbuConfig } from '../config/index.js';
import type { RbuCategory, RbuClassification } from './types.js';

export function classifyRbu(rbuValue: string | null): RbuClassification {
  const normalized = rbuValue?.trim() || null;

  for (const [category, def] of Object.entries(rbuConfig.categories)) {
    if (def.rbuValues.some(v => (v === null || v === '') ? normalized === null : v === normalized)) {
      return { category: category as RbuCategory, matchedValue: normalized };
    }
  }

  // Fallback: per the org's documented rule, unmapped/unknown RBU values default to Operations.
  return { category: 'Operations', matchedValue: normalized };
}
