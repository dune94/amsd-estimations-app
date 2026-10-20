// ── Present and outputs ────────────────────────────────────────────────────
// Presenting needs an accepted version. Publishing needs a presented one and is a DRY RUN unless every condition holds:
// the caller passes dryRun:false, OUTPUTS_ENABLED is exactly "true", and a writer is configured. One guard for every target.

import type { EstimateVersion, ReviewStore } from '../db/reviewStore.js';
import { ConflictError, ValidationError } from './reviewService.js';

export type OutputTarget = 'preview' | 'jiraSp';
export interface PublishResult { dryRun: boolean; payload: unknown; reason?: string }

export interface OutputsDeps {
  store: ReviewStore;
  env: NodeJS.ProcessEnv;
  render: (v: EstimateVersion) => { title: string; html: string };
  /** Performs the real write. Absent while Jira and Confluence are read-only. */
  write?: (target: OutputTarget, payload: unknown) => Promise<void>;
}

export interface Outputs {
  present(key: string): EstimateVersion;
  publish(key: string, target: OutputTarget, o?: { dryRun?: boolean }): Promise<PublishResult>;
}

export function createOutputs(deps: OutputsDeps): Outputs {
  const { store } = deps;
  return {
    present(key) {
      const v = store.getVersion(key);
      if (!v) throw new ConflictError(`no estimate for ${key} yet`);
      if (v.status !== 'ACCEPTED') throw new ConflictError(`${key} is ${v.status}; only an accepted estimate can be presented`);
      store.setStatus(key, v.version, 'PRESENTED', 'present');
      return store.getVersion(key, v.version)!;
    },

    async publish(key, target, o = {}) {
      if (target !== 'preview' && target !== 'jiraSp') throw new ValidationError(`unknown target: ${String(target)}`);
      const v = store.getVersion(key);
      if (!v) throw new ConflictError(`no estimate for ${key} yet`);
      if (v.status !== 'PRESENTED' && v.status !== 'OUTPUT_WRITTEN') throw new ConflictError(`${key} is ${v.status}; present it before publishing`);

      const sp = (v.estimate as { sp?: number | null } | null)?.sp ?? null;
      const payload = target === 'preview' ? deps.render(v) : { issueKey: key, storyPoints: sp };

      if (o.dryRun !== false) return { dryRun: true, payload };
      if (deps.env.OUTPUTS_ENABLED !== 'true') return { dryRun: true, payload, reason: 'OUTPUTS_ENABLED is not true; nothing was written' };
      if (!deps.write) return { dryRun: true, payload, reason: 'no writer is configured; nothing was written' };

      await deps.write(target, payload);
      store.setStatus(key, v.version, 'OUTPUT_WRITTEN', `publish:${target}`);
      return { dryRun: false, payload };
    },
  };
}
