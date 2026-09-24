import { sql } from 'kysely';
import type { Database } from './connection';

const equipmentValues = [
  'barbell',
  'dumbbell',
  'machine_plate',
  'machine_stack',
  'cable',
  'bodyweight',
  'other',
] as const;

export type Equipment = (typeof equipmentValues)[number];

// The column's CHECK allows exactly these, so a miss means the schema and this list disagree.
function toEquipment(value: string): Equipment {
  const known = equipmentValues.find((candidate) => candidate === value);
  if (known === undefined) throw new Error(`exercise.equipment outside its CHECK: ${value}`);
  return known;
}

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
    .selectFrom('exercise as e')
    .leftJoin('exerciseSetting as s', (join) =>
      join.onRef('s.exerciseId', '=', 'e.id').on('s.userId', '=', userId),
    )
    .select([
      'e.id',
      'e.name',
      'e.equipment',
      'e.ownerUserId',
      'e.defaultIncrementKg',
      'e.defaultRestSeconds',
      'e.defaultRepLow',
      'e.defaultRepHigh',
      's.incrementKg',
      's.restSeconds',
      's.repLow',
      's.repHigh',
      's.hiddenAt',
    ])
    .where((eb) => eb.or([eb('e.ownerUserId', 'is', null), eb('e.ownerUserId', '=', userId)]))
    .$if(!options.includeHidden, (qb) => qb.where('s.hiddenAt', 'is', null))
    .orderBy(sql`lower(e.name)`)
    .orderBy('e.id')
    .execute();

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    equipment: toEquipment(row.equipment),
    custom: row.ownerUserId !== null,
    hidden: row.hiddenAt !== null,
    incrementKg: Number(row.incrementKg ?? row.defaultIncrementKg),
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
