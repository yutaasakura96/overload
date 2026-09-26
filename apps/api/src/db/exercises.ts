import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';
import type { Database } from './connection';
import { exercise, exerciseSetting, type equipmentValues } from './schema';

export type Equipment = (typeof equipmentValues)[number];

/** One exercise as one user sees it: their setting where they have one, else its default. */
export type UserExercise = {
  id: string;
  name: string;
  equipment: Equipment;
  custom: boolean;
  hidden: boolean;
  incrementKg: number;
  restSeconds: number;
  repLow: number;
  repHigh: number;
  overrides: { incrementKg: boolean; restSeconds: boolean; repLow: boolean; repHigh: boolean };
};

/**
 * Seeded exercises plus the user's own, never another user's (S8), sorted by name. Hidden ones only
 * when asked.
 */
export async function listExercises(
  db: Database,
  userId: string,
  options: { includeHidden: boolean },
): Promise<UserExercise[]> {
  const rows = await db
    .select({
      id: exercise.id,
      name: exercise.name,
      equipment: exercise.equipment,
      ownerUserId: exercise.ownerUserId,
      defaultIncrementKg: exercise.defaultIncrementKg,
      defaultRestSeconds: exercise.defaultRestSeconds,
      defaultRepLow: exercise.defaultRepLow,
      defaultRepHigh: exercise.defaultRepHigh,
      incrementKg: exerciseSetting.incrementKg,
      restSeconds: exerciseSetting.restSeconds,
      repLow: exerciseSetting.repLow,
      repHigh: exerciseSetting.repHigh,
      hiddenAt: exerciseSetting.hiddenAt,
    })
    .from(exercise)
    .leftJoin(
      exerciseSetting,
      and(eq(exerciseSetting.exerciseId, exercise.id), eq(exerciseSetting.userId, userId)),
    )
    .where(
      and(
        or(isNull(exercise.ownerUserId), eq(exercise.ownerUserId, userId)),
        options.includeHidden ? undefined : isNull(exerciseSetting.hiddenAt),
      ),
    )
    .orderBy(sql`lower(${exercise.name})`, asc(exercise.id));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    equipment: row.equipment,
    custom: row.ownerUserId !== null,
    hidden: row.hiddenAt !== null,
    incrementKg: row.incrementKg ?? row.defaultIncrementKg,
    restSeconds: row.restSeconds ?? row.defaultRestSeconds,
    repLow: row.repLow ?? row.defaultRepLow,
    repHigh: row.repHigh ?? row.defaultRepHigh,
    overrides: {
      incrementKg: row.incrementKg !== null,
      restSeconds: row.restSeconds !== null,
      repLow: row.repLow !== null,
      repHigh: row.repHigh !== null,
    },
  }));
}
