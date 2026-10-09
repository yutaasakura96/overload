import type { WeightUnit } from '@overload/api-contract';
import { parseFigure } from './components';
import { toKg } from './units';

// The figures of one set, as typed. What the server would refuse is refused here first, so a set
// the screen writes is never one it turns away (docs/10 §1).

/** Why the figures were not taken, and the one to correct when one is at fault. */
export type FigureRefusal = { field?: 'kg' | 'reps' | 'rir'; message: string };

export type Figures = { weightKg: number; reps: number; rir: number | null };

/** The most `set.weight_kg` holds. */
export const MAX_WEIGHT_KG = 9999.99;

/**
 * Reads the typed figures of a set. A weight left as the field opened, or typed back to it, keeps
 * the stored kilograms, so 62.5 kg shown as 137.8 lb is not logged as 62.51.
 */
export function readFigures(
  typed: { kg: string; reps: string; rir: string },
  unit: WeightUnit,
  opening: { shown: string; kg: number | null },
): FigureRefusal | Figures {
  const weight = parseFigure(typed.kg);
  const reps = parseFigure(typed.reps);
  const rir = parseFigure(typed.rir);
  if (weight === null) return { field: 'kg', message: 'Enter the weight' };
  if (!Number.isFinite(weight) || weight < 0 || toKg(weight, unit) > MAX_WEIGHT_KG) {
    return { field: 'kg', message: 'Enter the weight as a number, in digits only' };
  }
  if (reps === null) return { field: 'reps', message: 'Enter the reps' };
  if (!Number.isInteger(reps) || reps < 1 || reps > 100) {
    return { field: 'reps', message: 'Reps are a whole number, 1 to 100' };
  }
  if (rir !== null && (!Number.isInteger(rir) || rir < 0 || rir > 10)) {
    return { field: 'rir', message: 'RIR is a whole number, 0 to 10, or empty' };
  }
  const weightKg =
    opening.kg !== null && typed.kg === opening.shown ? opening.kg : toKg(weight, unit);
  return { weightKg, reps, rir };
}
