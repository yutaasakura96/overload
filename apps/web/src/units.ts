import type { WeightUnit } from '@overload/api-contract';

// Display only (docs/06, 2026-09-23): every weight is stored, sent and computed in kg. A pounds
// lifter sees and types pounds, and what they type is turned to kg, to the hundredth the column
// holds, before it is written anywhere.

const KG_PER_LB = 0.45359237;

/** A stored weight in the user's unit, unrounded, for a figure the screen rounds itself. */
export const fromKg = (kg: number, unit: WeightUnit) => (unit === 'lb' ? kg / KG_PER_LB : kg);

/** A stored weight as the user reads it: kg as stored, pounds to the tenth. */
export function formatWeight(kg: number, unit: WeightUnit): string {
  const shown = unit === 'lb' ? Math.round((kg / KG_PER_LB) * 10) / 10 : Math.round(kg * 100) / 100;
  return String(shown);
}

/** A weight the user typed in their unit, as kilograms to the hundredth. */
export function toKg(typed: number, unit: WeightUnit): number {
  return Math.round((unit === 'lb' ? typed * KG_PER_LB : typed) * 100) / 100;
}

export const unitLabel = (unit: WeightUnit) => (unit === 'lb' ? 'LB' : 'KG');
