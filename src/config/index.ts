// ── Config loader ─────────────────────────────────────────────────────────
// Loads all engine config from JSON files at runtime (fs, not ESM JSON
// import) so it works identically under `tsx` (dev, reads src/config) and
// compiled `node dist/server.js` (prod, reads dist/config — copied there by
// the build script). All values here are intentionally data, not code, per
// the manifest's "config-driven, not hardcoded" requirement.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const CONFIG_DIR = dirname(fileURLToPath(import.meta.url));

// Organisation-specific values live in an untracked folder (CONFIG_LOCAL_DIR, default ./config.local). A file there replaces the
// committed file of the same name; the committed files hold neutral samples.
const LOCAL_DIR = process.env.CONFIG_LOCAL_DIR ?? join(process.cwd(), 'config.local');

function load<T>(filename: string): T {
  const local = join(LOCAL_DIR, filename);
  const raw = readFileSync(existsSync(local) ? local : join(CONFIG_DIR, filename), 'utf-8');
  return JSON.parse(raw) as T;
}

export interface RbuConfig {
  jiraField: string;
  categories: Record<string, { percent: number; rbuValues: (string | null)[] }>;
  monthlyContractTotalSp: number;
}

export interface TshirtScaleEntry {
  tshirt: string;
  minSp: number;
  maxSp: number;
  description: string;
}

export interface SpFieldPriorityEntry {
  priority: number;
  source: string;
  jiraField: string | null;
  description: string;
}

export interface BaselineStory {
  key: string;
  tshirt: string;
  sp: number;
  description: string;
  signals: {
    issueType: string;
    externalDependency: boolean;
    filesImpacted: number;
    newComponent: boolean;
  };
  /** Measured code facts and drivers, present for baselines built from delivered, measured work. */
  measured?: {
    changed: number;
    dependent: number;
    tests: number;
    external: number;
    newFiles: number;
    blastRadius: number;
    scope: string;
    complexity: string;
    risk: string;
    cDrivers: number;
    rDrivers: number;
  };
}

export interface ConfidenceConfig {
  /** Delivered baselines needed at the same Scope/Complexity/Risk levels before the support counts as solid. */
  minSupport: number;
  /** UPPER more than this many times BASE is flagged as a wide range. */
  maxRange: number;
  /** Largest allowed distance, in SP bands, between the estimate and the observed median. */
  bandDistance: number;
  /** Share of attachments not read at or above which confidence is Low. */
  majorUnreadShare: number;
  /** This many minor reasons or more give Low. */
  minorLowThreshold: number;
  /** The SP scale used for band maths. */
  bands: number[];
}

export interface ThresholdsConfig {
  convergenceGapThresholdPct: number;
  escalation: {
    wideDivergenceThresholdPct: number;
    minHistoricalCompsForConfidence: number;
    acAmbiguityVagueTerms: string[];
  };
  openSpecLens: {
    tierScalingFactorPerStep: number;
  };
  brownfieldLens: {
    pessimisticMultiplierByTier: Record<string, number>;
    brownfieldLabelRiskDeltaSp: number;
  };
  specKitLens: {
    perAcSp: number;
    tierFloorSp: Record<string, number>;
  };
}

export interface ClassificationSignalsConfig {
  spikeLabels: string[];
  newServiceLabels: string[];
  crossTeamLabels: string[];
  noPriorExperienceLabels: string[];
  brownfieldRiskLabels: string[];
  externalDependencyLabels: string[];
}

export const rbuConfig = load<RbuConfig>('rbu.json');
export const tshirtToSp = load<Record<string, number>>('tshirt-to-sp.json');
export const tshirtScale = load<{ scale: TshirtScaleEntry[] }>('tshirt-scale.json').scale;
export const spFieldPriority = load<{ priority: SpFieldPriorityEntry[] }>(
  'sp-field-priority.json',
).priority;
export const baselineStories = load<{ stories: BaselineStory[] }>(
  'baseline-stories.json',
).stories;
export const thresholds = load<ThresholdsConfig>('thresholds.json');
export const classificationSignals = load<ClassificationSignalsConfig>(
  'classification-signals.json',
);
export const confidenceConfig = load<ConfidenceConfig>('confidence.json');
export const backtestConfig = load<{ minShare: number }>('backtest.json');
