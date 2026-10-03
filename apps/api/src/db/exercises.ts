import { and, asc, eq, isNull, ne, or, sql } from 'drizzle-orm';
import {
  defaultIncrementKg,
  defaultRepRange,
  defaultRestSeconds,
  type Equipment,
} from '../domain/equipment.js';
import type { Database, Queryable } from './connection.js';
import { exercise, exerciseSetting, routine, routineExercise } from './schema.js';
import { exercisesWithHistory } from './workouts.js';

export type { Equipment };

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

/** A custom exercise's own values. For a custom exercise these are its defaults. */
export type ExerciseFields = {
  name: string;
  equipment: Equipment;
  incrementKg: number;
  restSeconds: number;
  repLow: number;
  repHigh: number;
};

/** One user's overrides for one exercise. `null` means the exercise's default. */
export type ExerciseSettingFields = {
  incrementKg: number | null;
  restSeconds: number | null;
  repLow: number | null;
  repHigh: number | null;
  hidden: boolean;
};

/** Seeded exercises and this user's own; never another user's (S8). */
const visibleTo = (userId: string) =>
  or(isNull(exercise.ownerUserId), eq(exercise.ownerUserId, userId));

function selectUserExercises(db: Queryable, userId: string) {
  return db
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
    );
}

type UserExerciseRow = Awaited<ReturnType<typeof selectUserExercises>>[number];

function toUserExercise(row: UserExerciseRow): UserExercise {
  return {
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
  };
}

/**
 * Seeded exercises plus the user's own, never another user's (S8), sorted by name. Hidden ones only
 * when asked.
 */
export async function listExercises(
  db: Database,
  userId: string,
  options: { includeHidden: boolean },
): Promise<UserExercise[]> {
  const rows = await selectUserExercises(db, userId)
    .where(
      and(visibleTo(userId), options.includeHidden ? undefined : isNull(exerciseSetting.hiddenAt)),
    )
    .orderBy(sql`lower(${exercise.name})`, asc(exercise.id));
  return rows.map(toUserExercise);
}

/** One exercise this user can see, hidden or not. */
export async function getExercise(
  db: Database,
  userId: string,
  id: string,
): Promise<UserExercise | undefined> {
  const [row] = await selectUserExercises(db, userId).where(
    and(eq(exercise.id, id), visibleTo(userId)),
  );
  return row === undefined ? undefined : toUserExercise(row);
}

export type CreateExerciseResult =
  | { kind: 'created'; exercise: UserExercise }
  | { kind: 'existing'; exercise: UserExercise }
  | { kind: 'id_conflict' }
  | { kind: 'duplicate_name' }
  | { kind: 'inverted_range' };

/**
 * A custom exercise. The id is the client's, so a retried create lands once: a repeat with the same
 * content returns the stored row, and anything else under that id is a conflict (docs/07 §1.2).
 */
export async function createExercise(
  db: Database,
  userId: string,
  input: { id: string; name: string; equipment: Equipment } & Partial<ExerciseFields>,
): Promise<CreateExerciseResult> {
  const fields: ExerciseFields = {
    name: input.name,
    equipment: input.equipment,
    incrementKg: input.incrementKg ?? defaultIncrementKg[input.equipment],
    restSeconds: input.restSeconds ?? defaultRestSeconds,
    repLow: input.repLow ?? defaultRepRange.low,
    repHigh: input.repHigh ?? defaultRepRange.high,
  };
  if (fields.repLow > fields.repHigh) return { kind: 'inverted_range' };
  // No conflict target: the id's primary key and the one-name-per-owner index both land here, and
  // what follows tells them apart without an error in the transaction.
  const inserted = await db
    .insert(exercise)
    .values({ id: input.id, ownerUserId: userId, ...toColumns(fields) })
    .onConflictDoNothing()
    .returning({ id: exercise.id });
  if (inserted.length > 0) {
    return { kind: 'created', exercise: await mustGetExercise(db, userId, input.id) };
  }

  const [stored] = await db.select().from(exercise).where(eq(exercise.id, input.id));
  if (stored === undefined) return { kind: 'duplicate_name' };
  const same =
    stored.ownerUserId === userId &&
    stored.name === fields.name &&
    stored.equipment === fields.equipment &&
    stored.defaultIncrementKg === fields.incrementKg &&
    stored.defaultRestSeconds === fields.restSeconds &&
    stored.defaultRepLow === fields.repLow &&
    stored.defaultRepHigh === fields.repHigh;
  if (!same) return { kind: 'id_conflict' };
  return { kind: 'existing', exercise: await mustGetExercise(db, userId, input.id) };
}

export type UpdateExerciseResult =
  | { kind: 'updated'; exercise: UserExercise }
  | { kind: 'not_found' }
  | { kind: 'duplicate_name' }
  | { kind: 'inverted_range' };

/** Edits one of the user's custom exercises. A seeded one is nobody's to edit, so it is not found. */
export async function updateExercise(
  db: Database,
  userId: string,
  id: string,
  patch: Partial<ExerciseFields>,
): Promise<UpdateExerciseResult> {
  const [stored] = await db
    .select()
    .from(exercise)
    .where(and(eq(exercise.id, id), eq(exercise.ownerUserId, userId)));
  if (stored === undefined) return { kind: 'not_found' };

  const fields: ExerciseFields = {
    name: patch.name ?? stored.name,
    equipment: patch.equipment ?? stored.equipment,
    incrementKg: patch.incrementKg ?? stored.defaultIncrementKg,
    restSeconds: patch.restSeconds ?? stored.defaultRestSeconds,
    repLow: patch.repLow ?? stored.defaultRepLow,
    repHigh: patch.repHigh ?? stored.defaultRepHigh,
  };
  if (fields.repLow > fields.repHigh) return { kind: 'inverted_range' };
  if (await hasExerciseNamed(db, userId, fields.name, id)) return { kind: 'duplicate_name' };

  await db
    .update(exercise)
    .set({ ...toColumns(fields), updatedAt: sql`now()` })
    .where(and(eq(exercise.id, id), eq(exercise.ownerUserId, userId)));
  return { kind: 'updated', exercise: await mustGetExercise(db, userId, id) };
}

export type DeleteExerciseResult =
  | { kind: 'deleted' }
  | { kind: 'has_history' }
  | { kind: 'in_routine'; routines: { id: string; name: string }[] };

/**
 * Deletes one of the user's custom exercises. Refused once a workout has logged it, since history
 * keeps it (hide it instead), and while a routine uses it, naming the routines. Both are checked
 * here rather than left to the deferred foreign keys, which would fail only at commit (docs/04).
 */
export async function deleteExercise(
  db: Database,
  userId: string,
  id: string,
): Promise<DeleteExerciseResult> {
  if ((await exercisesWithHistory(db, userId, [id])).size > 0) return { kind: 'has_history' };
  const routines = await db
    .selectDistinct({ id: routine.id, name: routine.name, position: routine.position })
    .from(routineExercise)
    .innerJoin(routine, eq(routine.id, routineExercise.routineId))
    .innerJoin(exercise, eq(exercise.id, routineExercise.exerciseId))
    .where(
      and(
        eq(routineExercise.exerciseId, id),
        eq(routine.userId, userId),
        eq(exercise.ownerUserId, userId),
      ),
    )
    .orderBy(asc(routine.position), asc(routine.id));
  if (routines.length > 0) {
    return {
      kind: 'in_routine',
      routines: routines.map((row) => ({ id: row.id, name: row.name })),
    };
  }
  await db.delete(exercise).where(and(eq(exercise.id, id), eq(exercise.ownerUserId, userId)));
  return { kind: 'deleted' };
}

export type PutExerciseSettingResult =
  | { kind: 'saved'; exercise: UserExercise }
  | { kind: 'not_found' }
  | { kind: 'inverted_range' };

/**
 * Replaces the user's setting for any exercise they can see. All-null and not hidden is the same as
 * no setting, so the row is removed (docs/04: written only when the user changes something). The
 * first hidden time is kept on a repeat, so the same body leaves the same row.
 */
export async function putExerciseSetting(
  db: Database,
  userId: string,
  exerciseId: string,
  setting: ExerciseSettingFields,
): Promise<PutExerciseSettingResult> {
  const [stored] = await db
    .select({ repLow: exercise.defaultRepLow, repHigh: exercise.defaultRepHigh })
    .from(exercise)
    .where(and(eq(exercise.id, exerciseId), visibleTo(userId)));
  if (stored === undefined) return { kind: 'not_found' };
  if ((setting.repLow ?? stored.repLow) > (setting.repHigh ?? stored.repHigh)) {
    return { kind: 'inverted_range' };
  }

  const empty =
    setting.incrementKg === null &&
    setting.restSeconds === null &&
    setting.repLow === null &&
    setting.repHigh === null &&
    !setting.hidden;
  if (empty) {
    await db
      .delete(exerciseSetting)
      .where(and(eq(exerciseSetting.userId, userId), eq(exerciseSetting.exerciseId, exerciseId)));
  } else {
    const values = {
      incrementKg: setting.incrementKg,
      restSeconds: setting.restSeconds,
      repLow: setting.repLow,
      repHigh: setting.repHigh,
    };
    await db
      .insert(exerciseSetting)
      .values({ userId, exerciseId, ...values, hiddenAt: setting.hidden ? sql`now()` : null })
      .onConflictDoUpdate({
        target: [exerciseSetting.userId, exerciseSetting.exerciseId],
        set: {
          ...values,
          hiddenAt: setting.hidden ? sql`coalesce(${exerciseSetting.hiddenAt}, now())` : null,
          updatedAt: sql`now()`,
        },
      });
  }
  return { kind: 'saved', exercise: await mustGetExercise(db, userId, exerciseId) };
}

/**
 * The ids among `ids` that this user may put in a routine: seeded or their own, and not hidden
 * unless the routine already holds it (`held`). Anything else is refused as if it did not exist
 * (docs/07 §1.3, docs/08 §4).
 */
export async function usableExerciseIds(
  db: Queryable,
  userId: string,
  ids: string[],
  held: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await selectUserExercises(db, userId).where(
    and(
      sql`${exercise.id} = ANY(${sql.param(ids)}::uuid[])`,
      visibleTo(userId),
      or(isNull(exerciseSetting.hiddenAt), sql`${exercise.id} = ANY(${sql.param(held)}::uuid[])`),
    ),
  );
  return new Set(rows.map((row) => row.id));
}

async function hasExerciseNamed(db: Database, userId: string, name: string, exceptId: string) {
  const [row] = await db
    .select({ id: exercise.id })
    .from(exercise)
    .where(
      and(
        eq(exercise.ownerUserId, userId),
        sql`lower(${exercise.name}) = lower(${name})`,
        ne(exercise.id, exceptId),
      ),
    );
  return row !== undefined;
}

async function mustGetExercise(db: Database, userId: string, id: string) {
  const found = await getExercise(db, userId, id);
  if (found === undefined) throw new Error('exercise vanished between write and read');
  return found;
}

function toColumns(fields: ExerciseFields) {
  return {
    name: fields.name,
    equipment: fields.equipment,
    defaultIncrementKg: fields.incrementKg,
    defaultRestSeconds: fields.restSeconds,
    defaultRepLow: fields.repLow,
    defaultRepHigh: fields.repHigh,
  };
}
