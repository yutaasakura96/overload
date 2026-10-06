import type { Equipment } from './equipment.js';

/** One working set as last time logged it. Warm-ups never reach the rule (S6). */
export type WorkingSet = { weightKg: number; reps: number };

export type Suggestion = {
  weightKg: number;
  rule: 'top_of_range_hit' | 'repeat';
  /** The reason in plain words, shown under the suggestion (docs/10 §1). */
  reason: string;
};

/**
 * S3's double progression. Last workout's heaviest working weight plus the increment when every
 * working set reached the top of the rep range that workout ran with, otherwise the same weight;
 * either way rounded up to a weight the equipment can make. No working sets, no suggestion.
 */
export function suggest(input: {
  sets: WorkingSet[];
  repHigh: number;
  incrementKg: number;
  equipment: Equipment;
}): Suggestion | undefined {
  const { sets, repHigh, incrementKg, equipment } = input;
  if (sets.length === 0) return undefined;
  const lastKg = Math.max(...sets.map((s) => s.weightKg));
  const missed = sets.findIndex((s) => s.reps < repHigh);
  if (missed === -1) {
    return {
      weightKg: makeable(lastKg + incrementKg, equipment),
      rule: 'top_of_range_hit',
      reason:
        sets.length === 1
          ? `hit ${repHigh} on the only set last time`
          : `hit ${repHigh} on every set last time`,
    };
  }
  return {
    weightKg: makeable(lastKg, equipment),
    rule: 'repeat',
    reason: `set ${missed + 1} stopped at ${sets[missed]?.reps} of ${repHigh} last time`,
  };
}

/**
 * Rounds a weight up to one the equipment can make. A gym's dumbbell rack steps 1 kg to 10 kg, then
 * 2 kg from 12 kg (docs/06, 2026-09-23), so 30 + 1 lands on the real 32 rather than inventing 31.
 * Every other class makes whatever its increment adds, so it is left alone (to the hundredth the
 * column holds).
 */
export function makeable(weightKg: number, equipment: Equipment): number {
  const kg = Math.round(weightKg * 100) / 100;
  if (equipment !== 'dumbbell') return kg;
  if (kg <= 10) return Math.ceil(kg - 1e-9);
  return Math.ceil(kg / 2 - 1e-9) * 2;
}
