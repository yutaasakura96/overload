import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { DatabaseError } from 'pg';
import type { Database, Queryable } from './connection.js';
import { exercise, routine, set, syncTombstone, workout, workoutExercise } from './schema.js';

// The sync batch (docs/07 §3.4): the only write path for workouts, workout exercises and sets.
// Every row is its own unit, applied parents first, and each is upserted only when the phone's
// `clientUpdatedAt` is newer than the stored one, so a retry or a stale copy changes nothing.
// A deletion leaves a tombstone (docs/04 `sync_tombstone`), which keeps the row from coming back.

export type WorkoutRow = {
  id: string;
  routineId: string | null;
  name: string;
  startedAt: string;
  endedAt: string | null;
  note: string | null;
  clientUpdatedAt: string;
};

export type WorkoutExerciseRow = {
  id: string;
  workoutId: string;
  exerciseId: string;
  routineExerciseId: string | null;
  position: number;
  targetSets: number | null;
  repLow: number;
  repHigh: number;
  incrementKg: number;
  clientUpdatedAt: string;
};

export type SetRow = {
  id: string;
  workoutExerciseId: string;
  position: number;
  weightKg: number;
  reps: number;
  rir: number | null;
  rpe: number | null;
  isWarmup: boolean;
  performedAt: string;
  clientUpdatedAt: string;
};

/** A row the phone deleted. */
export type Deletion = { id: string; deletedAt: string };

type FieldErrors = { path: string; message: string }[];

/** A row that did not match its schema, with the fields at fault. It is refused on its own. */
export type Unreadable = { id: string; errors: FieldErrors };

export type SyncBatch = {
  workouts: (WorkoutRow | Deletion | Unreadable)[];
  workoutExercises: (WorkoutExerciseRow | Deletion | Unreadable)[];
  sets: (SetRow | Deletion | Unreadable)[];
};

export type SyncTable = keyof SyncBatch;

type RefusalCode = 'not_found' | 'parent_missing' | 'validation_failed';

export type SyncResult =
  | {
      table: SyncTable;
      id: string;
      status: 'stored' | 'unchanged';
      row: WorkoutRow | WorkoutExerciseRow | SetRow;
    }
  | { table: SyncTable; id: string; status: 'deleted' }
  | {
      table: SyncTable;
      id: string;
      status: 'refused';
      problem: { code: RefusalCode; status: 404 | 422; errors?: FieldErrors };
    };

const isDeletion = (row: object): row is Deletion => 'deletedAt' in row;
const isUnreadable = (row: object): row is Unreadable => 'errors' in row;

const refusal = (
  table: SyncTable,
  id: string,
  code: RefusalCode,
  errors?: FieldErrors,
): SyncResult => ({
  table,
  id,
  status: 'refused',
  problem: {
    code,
    status: code === 'not_found' ? 404 : 422,
    ...(errors === undefined ? {} : { errors }),
  },
});

const excluded = (column: string) => sql.raw(`excluded.${column}`);

/** Ids of the caller's workouts, for the ownership guard on child rows. */
const ownWorkouts = (userId: string) =>
  sql`(SELECT ${workout.id} FROM ${workout} WHERE ${workout.userId} = ${userId})`;

/** Ids of the caller's workout exercises. */
const ownWorkoutExercises = (userId: string) =>
  sql`(SELECT ${workoutExercise.id} FROM ${workoutExercise} WHERE ${workoutExercise.workoutId} IN ${ownWorkouts(userId)})`;

/** Whether the caller deleted any of these ids through sync. */
async function hasTombstone(db: Queryable, userId: string, ids: string[]) {
  const found = await db
    .select({ id: syncTombstone.id })
    .from(syncTombstone)
    .where(and(eq(syncTombstone.userId, userId), inArray(syncTombstone.id, ids)))
    .limit(1);
  return found.length > 0;
}

/**
 * Applies one device's queued rows for the caller and answers one result per row sent. Another
 * user's id is refused as not found; a child whose parent is refused, unknown or not the caller's is
 * refused as `parent_missing` (docs/07 §3.4, docs/08 §4). A row the caller deleted, or whose parent
 * they deleted, is not stored again: it is answered `deleted`.
 */
export async function syncWorkouts(
  db: Database,
  userId: string,
  batch: SyncBatch,
): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  // Parents this batch refused or deleted: their children follow them.
  const unusable = new Set<string>();
  const deleted = new Set<string>();

  const apply = async <Row extends { id: string }>(
    table: SyncTable,
    row: Row | Deletion | Unreadable,
    // A deletion and an unreadable row carry no parent id; the server finds out for itself.
    parentOf: (row: Row) => string | undefined,
    remove: (tx: Queryable, row: Deletion) => Promise<SyncResult>,
    upsert: (tx: Queryable, row: Row) => Promise<SyncResult>,
  ) => {
    const { id } = row;
    const gone: SyncResult = { table, id, status: 'deleted' };
    const parentId = isDeletion(row) || isUnreadable(row) ? undefined : parentOf(row);
    let result: SyncResult;
    if (isUnreadable(row)) {
      result = refusal(table, id, 'validation_failed', row.errors);
    } else if (parentId !== undefined && deleted.has(parentId)) {
      result = gone;
    } else if (parentId !== undefined && unusable.has(parentId)) {
      result = refusal(table, id, 'parent_missing');
    } else {
      result = await db
        .transaction(async (tx) => {
          // One request at a time works on an id. Otherwise a stale copy and its deletion, sent
          // together from two tabs, could each miss the other and leave the row stored.
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`);
          if (isDeletion(row)) return remove(tx, row);
          const ids = parentId === undefined ? [id] : [id, parentId];
          return (await hasTombstone(tx, userId, ids)) ? gone : upsert(tx, row);
        })
        .catch((error: unknown) => {
          const code = refusalFor(error);
          if (code === undefined) throw error;
          return refusal(table, id, code);
        });
      // The parent was deleted while this row was on its way in: that is `deleted`, not a refusal.
      if (
        result.status === 'refused' &&
        result.problem.code === 'parent_missing' &&
        parentId !== undefined &&
        (await hasTombstone(db, userId, [parentId]))
      ) {
        result = gone;
      }
    }
    if (result.status === 'refused') unusable.add(id);
    if (result.status === 'deleted') deleted.add(id);
    results.push(result);
  };

  for (const row of batch.workouts) {
    await apply(
      'workouts',
      row,
      () => undefined,
      (tx, gone) => deleteWorkout(tx, userId, gone),
      (tx, own: WorkoutRow) => upsertWorkout(tx, userId, own),
    );
  }
  for (const row of batch.workoutExercises) {
    await apply(
      'workoutExercises',
      row,
      (own) => own.workoutId,
      (tx, gone) => deleteWorkoutExercise(tx, userId, gone),
      (tx, own: WorkoutExerciseRow) => upsertWorkoutExercise(tx, userId, own),
    );
  }
  for (const row of batch.sets) {
    await apply(
      'sets',
      row,
      (own) => own.workoutExerciseId,
      (tx, gone) => deleteSet(tx, userId, gone),
      (tx, own: SetRow) => upsertSet(tx, userId, own),
    );
  }
  return results;
}

/** A check or range violation is the row's fault; a missing parent row is `parent_missing`. */
function refusalFor(error: unknown): RefusalCode | undefined {
  const cause = error instanceof DrizzleQueryError ? error.cause : error;
  if (!(cause instanceof DatabaseError)) return undefined;
  if (cause.code === '23503') return 'parent_missing';
  if (cause.code === '23514' || cause.code?.startsWith('22') === true) return 'validation_failed';
  return undefined;
}

async function upsertWorkout(tx: Queryable, userId: string, row: WorkoutRow): Promise<SyncResult> {
  const routineId =
    row.routineId !== null && (await ownsRoutine(tx, userId, row.routineId)) ? row.routineId : null;
  const [written] = await tx
    .insert(workout)
    .values({ ...workoutColumns(row), routineId, id: row.id, userId })
    .onConflictDoUpdate({
      target: workout.id,
      set: {
        routineId: excluded('routine_id'),
        name: excluded('name'),
        startedAt: excluded('started_at'),
        endedAt: excluded('ended_at'),
        note: excluded('note'),
        clientUpdatedAt: excluded('client_updated_at'),
        updatedAt: sql`now()`,
      },
      setWhere: and(
        eq(workout.userId, userId),
        lt(workout.clientUpdatedAt, excluded('client_updated_at')),
      ),
    })
    .returning();
  if (written !== undefined)
    return { table: 'workouts', id: row.id, status: 'stored', row: toWorkoutRow(written) };
  const [stored] = await tx.select().from(workout).where(eq(workout.id, row.id));
  if (stored === undefined || stored.userId !== userId) {
    return refusal('workouts', row.id, 'not_found');
  }
  return { table: 'workouts', id: row.id, status: 'unchanged', row: toWorkoutRow(stored) };
}

async function upsertWorkoutExercise(
  tx: Queryable,
  userId: string,
  row: WorkoutExerciseRow,
): Promise<SyncResult> {
  const parentOwned = await tx
    .select({ id: workout.id })
    .from(workout)
    .where(and(eq(workout.id, row.workoutId), eq(workout.userId, userId)));
  if (parentOwned.length === 0 || !(await canUseExercise(tx, userId, row.exerciseId))) {
    return refusal('workoutExercises', row.id, 'parent_missing');
  }
  const [written] = await tx
    .insert(workoutExercise)
    .values({ ...workoutExerciseColumns(row), id: row.id })
    .onConflictDoUpdate({
      target: workoutExercise.id,
      set: {
        workoutId: excluded('workout_id'),
        exerciseId: excluded('exercise_id'),
        routineExerciseId: excluded('routine_exercise_id'),
        position: excluded('position'),
        targetSets: excluded('target_sets'),
        repLow: excluded('rep_low'),
        repHigh: excluded('rep_high'),
        incrementKg: excluded('increment_kg'),
        clientUpdatedAt: excluded('client_updated_at'),
        updatedAt: sql`now()`,
      },
      setWhere: and(
        sql`${workoutExercise.workoutId} IN ${ownWorkouts(userId)}`,
        lt(workoutExercise.clientUpdatedAt, excluded('client_updated_at')),
      ),
    })
    .returning();
  if (written !== undefined) {
    return {
      table: 'workoutExercises',
      id: row.id,
      status: 'stored',
      row: toWorkoutExerciseRow(written),
    };
  }
  const [stored] = await tx
    .select()
    .from(workoutExercise)
    .where(
      and(
        eq(workoutExercise.id, row.id),
        sql`${workoutExercise.workoutId} IN ${ownWorkouts(userId)}`,
      ),
    );
  if (stored === undefined) return refusal('workoutExercises', row.id, 'not_found');
  return {
    table: 'workoutExercises',
    id: row.id,
    status: 'unchanged',
    row: toWorkoutExerciseRow(stored),
  };
}

async function upsertSet(tx: Queryable, userId: string, row: SetRow): Promise<SyncResult> {
  const parentOwned = await tx
    .select({ id: workoutExercise.id })
    .from(workoutExercise)
    .where(
      and(
        eq(workoutExercise.id, row.workoutExerciseId),
        sql`${workoutExercise.workoutId} IN ${ownWorkouts(userId)}`,
      ),
    );
  if (parentOwned.length === 0) return refusal('sets', row.id, 'parent_missing');
  const [written] = await tx
    .insert(set)
    .values({ ...setColumns(row), id: row.id })
    .onConflictDoUpdate({
      target: set.id,
      set: {
        workoutExerciseId: excluded('workout_exercise_id'),
        position: excluded('position'),
        weightKg: excluded('weight_kg'),
        reps: excluded('reps'),
        rir: excluded('rir'),
        rpe: excluded('rpe'),
        isWarmup: excluded('is_warmup'),
        performedAt: excluded('performed_at'),
        clientUpdatedAt: excluded('client_updated_at'),
        updatedAt: sql`now()`,
      },
      setWhere: and(
        sql`${set.workoutExerciseId} IN ${ownWorkoutExercises(userId)}`,
        lt(set.clientUpdatedAt, excluded('client_updated_at')),
      ),
    })
    .returning();
  if (written !== undefined)
    return { table: 'sets', id: row.id, status: 'stored', row: toSetRow(written) };
  const [stored] = await tx
    .select()
    .from(set)
    .where(
      and(eq(set.id, row.id), sql`${set.workoutExerciseId} IN ${ownWorkoutExercises(userId)}`),
    );
  if (stored === undefined) return refusal('sets', row.id, 'not_found');
  return { table: 'sets', id: row.id, status: 'unchanged', row: toSetRow(stored) };
}

/**
 * Writes the tombstones of a delete, in its transaction: the row's own id and every id the delete
 * cascades to, so none of them is stored again (docs/04 `sync_tombstone`). An id already there
 * stays as it is.
 */
async function bury(
  tx: Queryable,
  userId: string,
  deletedAt: string,
  ids: { tableName: 'workout' | 'workout_exercise' | 'set'; id: string }[],
) {
  if (ids.length === 0) return;
  await tx
    .insert(syncTombstone)
    .values(ids.map((each) => ({ ...each, userId, deletedAt: new Date(deletedAt) })))
    .onConflictDoNothing();
}

/**
 * A deletion removes the workout, and what it holds, when the stored copy is older than
 * `deletedAt`. A newer stored copy wins and is answered as unchanged. One the server never had is
 * answered deleted too, and buried all the same: its copy may still be on its way from another tab.
 */
async function deleteWorkout(tx: Queryable, userId: string, row: Deletion): Promise<SyncResult> {
  const [stored] = await tx.select().from(workout).where(eq(workout.id, row.id)).for('update');
  if (stored !== undefined && stored.userId !== userId) {
    return refusal('workouts', row.id, 'not_found');
  }
  if (stored !== undefined && stored.clientUpdatedAt >= new Date(row.deletedAt)) {
    return { table: 'workouts', id: row.id, status: 'unchanged', row: toWorkoutRow(stored) };
  }
  const exercises = await tx
    .select({ id: workoutExercise.id })
    .from(workoutExercise)
    .where(eq(workoutExercise.workoutId, row.id));
  const sets =
    exercises.length === 0
      ? []
      : await tx
          .select({ id: set.id })
          .from(set)
          .where(
            inArray(
              set.workoutExerciseId,
              exercises.map((each) => each.id),
            ),
          );
  await tx.delete(workout).where(and(eq(workout.id, row.id), eq(workout.userId, userId)));
  await bury(tx, userId, row.deletedAt, [
    { tableName: 'workout', id: row.id },
    ...exercises.map(({ id }) => ({ tableName: 'workout_exercise' as const, id })),
    ...sets.map(({ id }) => ({ tableName: 'set' as const, id })),
  ]);
  return { table: 'workouts', id: row.id, status: 'deleted' };
}

/** The same for one exercise of a workout, and the sets logged under it. */
async function deleteWorkoutExercise(
  tx: Queryable,
  userId: string,
  row: Deletion,
): Promise<SyncResult> {
  const [stored] = await tx
    .select()
    .from(workoutExercise)
    .where(eq(workoutExercise.id, row.id))
    .for('update');
  if (stored !== undefined) {
    const owned = await tx
      .select({ id: workout.id })
      .from(workout)
      .where(and(eq(workout.id, stored.workoutId), eq(workout.userId, userId)));
    if (owned.length === 0) return refusal('workoutExercises', row.id, 'not_found');
    if (stored.clientUpdatedAt >= new Date(row.deletedAt)) {
      return {
        table: 'workoutExercises',
        id: row.id,
        status: 'unchanged',
        row: toWorkoutExerciseRow(stored),
      };
    }
  }
  const sets = await tx.select({ id: set.id }).from(set).where(eq(set.workoutExerciseId, row.id));
  await tx
    .delete(workoutExercise)
    .where(
      and(
        eq(workoutExercise.id, row.id),
        sql`${workoutExercise.workoutId} IN ${ownWorkouts(userId)}`,
      ),
    );
  await bury(tx, userId, row.deletedAt, [
    { tableName: 'workout_exercise', id: row.id },
    ...sets.map(({ id }) => ({ tableName: 'set' as const, id })),
  ]);
  return { table: 'workoutExercises', id: row.id, status: 'deleted' };
}

/** The same for one logged set. */
async function deleteSet(tx: Queryable, userId: string, row: Deletion): Promise<SyncResult> {
  const [stored] = await tx.select().from(set).where(eq(set.id, row.id)).for('update');
  if (stored !== undefined) {
    const owned = await tx
      .select({ id: workoutExercise.id })
      .from(workoutExercise)
      .where(
        and(
          eq(workoutExercise.id, stored.workoutExerciseId),
          sql`${workoutExercise.workoutId} IN ${ownWorkouts(userId)}`,
        ),
      );
    if (owned.length === 0) return refusal('sets', row.id, 'not_found');
    if (stored.clientUpdatedAt >= new Date(row.deletedAt)) {
      return { table: 'sets', id: row.id, status: 'unchanged', row: toSetRow(stored) };
    }
  }
  await tx
    .delete(set)
    .where(
      and(eq(set.id, row.id), sql`${set.workoutExerciseId} IN ${ownWorkoutExercises(userId)}`),
    );
  await bury(tx, userId, row.deletedAt, [{ tableName: 'set', id: row.id }]);
  return { table: 'sets', id: row.id, status: 'deleted' };
}

async function ownsRoutine(tx: Queryable, userId: string, routineId: string) {
  const found = await tx
    .select({ id: routine.id })
    .from(routine)
    .where(and(eq(routine.id, routineId), eq(routine.userId, userId)));
  return found.length > 0;
}

/** Seeded or the caller's own, hidden or not: hiding never blocks logging (docs/07 §3.3). */
async function canUseExercise(tx: Queryable, userId: string, exerciseId: string) {
  const found = await tx
    .select({ id: exercise.id })
    .from(exercise)
    .where(
      and(
        eq(exercise.id, exerciseId),
        or(isNull(exercise.ownerUserId), eq(exercise.ownerUserId, userId)),
      ),
    );
  return found.length > 0;
}

/** Whether any of the caller's workouts names one of these exercises: they have history. */
export async function exercisesWithHistory(db: Queryable, userId: string, exerciseIds: string[]) {
  if (exerciseIds.length === 0) return new Set<string>();
  const rows = await db
    .selectDistinct({ exerciseId: workoutExercise.exerciseId })
    .from(workoutExercise)
    .innerJoin(workout, eq(workout.id, workoutExercise.workoutId))
    .where(and(eq(workout.userId, userId), inArray(workoutExercise.exerciseId, exerciseIds)));
  return new Set(rows.map((row) => row.exerciseId));
}

const instant = (value: string | null) => (value === null ? null : new Date(value));
const iso = (value: Date | null) => (value === null ? null : value.toISOString());

function workoutColumns(row: WorkoutRow) {
  return {
    routineId: row.routineId,
    name: row.name,
    startedAt: new Date(row.startedAt),
    endedAt: instant(row.endedAt),
    note: row.note,
    clientUpdatedAt: new Date(row.clientUpdatedAt),
  };
}

function workoutExerciseColumns(row: WorkoutExerciseRow) {
  return {
    workoutId: row.workoutId,
    exerciseId: row.exerciseId,
    routineExerciseId: row.routineExerciseId,
    position: row.position,
    targetSets: row.targetSets,
    repLow: row.repLow,
    repHigh: row.repHigh,
    incrementKg: row.incrementKg,
    clientUpdatedAt: new Date(row.clientUpdatedAt),
  };
}

function setColumns(row: SetRow) {
  return {
    workoutExerciseId: row.workoutExerciseId,
    position: row.position,
    weightKg: row.weightKg,
    reps: row.reps,
    rir: row.rir,
    rpe: row.rpe,
    isWarmup: row.isWarmup,
    performedAt: new Date(row.performedAt),
    clientUpdatedAt: new Date(row.clientUpdatedAt),
  };
}

function toWorkoutRow(row: typeof workout.$inferSelect): WorkoutRow {
  return {
    id: row.id,
    routineId: row.routineId,
    name: row.name,
    startedAt: row.startedAt.toISOString(),
    endedAt: iso(row.endedAt),
    note: row.note,
    clientUpdatedAt: row.clientUpdatedAt.toISOString(),
  };
}

function toWorkoutExerciseRow(row: typeof workoutExercise.$inferSelect): WorkoutExerciseRow {
  return {
    id: row.id,
    workoutId: row.workoutId,
    exerciseId: row.exerciseId,
    routineExerciseId: row.routineExerciseId,
    position: row.position,
    targetSets: row.targetSets,
    repLow: row.repLow,
    repHigh: row.repHigh,
    incrementKg: row.incrementKg,
    clientUpdatedAt: row.clientUpdatedAt.toISOString(),
  };
}

function toSetRow(row: typeof set.$inferSelect): SetRow {
  return {
    id: row.id,
    workoutExerciseId: row.workoutExerciseId,
    position: row.position,
    weightKg: row.weightKg,
    reps: row.reps,
    rir: row.rir,
    rpe: row.rpe,
    isWarmup: row.isWarmup,
    performedAt: row.performedAt.toISOString(),
    clientUpdatedAt: row.clientUpdatedAt.toISOString(),
  };
}
