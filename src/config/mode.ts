// Estimation mode: `legacy` = the original engine, unchanged; `formula` = the scope-fed pipeline.
// Per-request value beats ESTIMATION_MODE, which beats `legacy`.

export type EstimationMode = 'legacy' | 'formula';

export function resolveMode(requested?: string, env: NodeJS.ProcessEnv = process.env): EstimationMode {
  const value = requested || env.ESTIMATION_MODE || 'legacy';
  if (value !== 'legacy' && value !== 'formula') throw new Error(`invalid mode: ${value}`);
  return value;
}
