import type { Equipment } from '@overload/api-contract';

// How the load-increment classes read on screen (docs/04 `exercise`, docs/06 2026-09-23).
export const equipmentLabels: Record<Equipment, string> = {
  barbell: 'Barbell',
  dumbbell: 'Dumbbell',
  machine_plate: 'Plate-loaded machine',
  machine_stack: 'Stack machine',
  cable: 'Cable',
  bodyweight: 'Bodyweight',
  other: 'Other',
};

/**
 * What the new-exercise form fills in before the user types anything: docs/04's seeded increment per
 * class and S3/S5's defaults. The API applies the same values to a field left out; the form sends
 * them so the user sees what will be stored.
 */
export const classIncrementKg: Record<Equipment, number> = {
  barbell: 2.5,
  dumbbell: 1,
  machine_plate: 2.5,
  machine_stack: 5,
  cable: 2.5,
  bodyweight: 0,
  other: 2.5,
};
export const newExerciseDefaults = { restSeconds: 120, repLow: 6, repHigh: 10 } as const;
