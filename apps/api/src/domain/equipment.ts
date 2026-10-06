import type { equipmentValues } from '../db/schema.js';

export type Equipment = (typeof equipmentValues)[number];

/**
 * The load step a new exercise starts with when none is given: the seeded increment for its
 * equipment class (docs/04 `exercise`, docs/06 2026-09-23). `other` has no class figure, so it takes
 * the column default. A user's `exercise_setting` overrides any of these.
 */
export const defaultIncrementKg: Record<Equipment, number> = {
  barbell: 2.5,
  dumbbell: 1,
  machine_plate: 2.5,
  machine_stack: 5,
  cable: 2.5,
  bodyweight: 0,
  other: 2.5,
};

/** S3's rep range and S5's rest, the fallbacks for a new exercise (docs/04 `exercise`). */
export const defaultRestSeconds = 120;
export const defaultRepRange = { low: 6, high: 10 } as const;
