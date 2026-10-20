// ── Deterministic complexity scoring (PI-12 deck v3.9, slide 3) ─────────────
// Rate Complexity / Amount of Work / Risk Low-Medium-High, add the points, read the
// story points from the band table. No arithmetic is left to the LLM, and the result
// is always on the 1/2/3/5/8/13 scale. Familiarity is rated under Risk only.

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

export type Rating = 'L' | 'M' | 'H';

interface ScoringConfig {
  points: Record<'complexity' | 'work' | 'risk', Record<Rating, number>>;
  bands: { min: number; max: number; sp: number }[];
}

const CONFIG: ScoringConfig = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../config/complexity-scoring.json'), 'utf8'),
);

export const SP_SCALE = [1, 2, 3, 5, 8, 13] as const;

export interface ComplexityScore {
  ratings: { complexity: Rating; work: Rating; risk: Rating };
  points: { complexity: number; work: number; risk: number };
  total: number;
  storyPoints: number;
}

function pointsFor(attr: keyof ScoringConfig['points'], rating: Rating): number {
  const v = CONFIG.points[attr][rating];
  if (v === undefined) throw new Error(`Unknown ${attr} rating: ${rating}`);
  return v;
}

export function bandForTotal(total: number): number {
  const band = CONFIG.bands.find(b => total >= b.min && total <= b.max);
  if (!band) throw new Error(`Score total out of range 0-15: ${total}`);
  return band.sp;
}

export function scoreComplexity(complexity: Rating, work: Rating, risk: Rating): ComplexityScore {
  const points = {
    complexity: pointsFor('complexity', complexity),
    work: pointsFor('work', work),
    risk: pointsFor('risk', risk),
  };
  const total = points.complexity + points.work + points.risk;
  return { ratings: { complexity, work, risk }, points, total, storyPoints: bandForTotal(total) };
}

export function formatScoreLine(s: ComplexityScore): string {
  return `Score:  C ${s.ratings.complexity}(${s.points.complexity}) + W ${s.ratings.work}(${s.points.work}) + ` +
    `R ${s.ratings.risk}(${s.points.risk}) = ${s.total} → ${s.storyPoints} SP`;
}
