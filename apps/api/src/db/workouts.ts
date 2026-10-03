import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { DatabaseError } from 'pg';
import type { Database, Queryable } from './connection.js';
import { exercise, routine, set, workout, workoutExercise } from './schema.js';

// The sync batch (docs/07 §3.4): the only write path for workouts, workout exercises and sets.
// Every row is its own unit, applied parents first, and each is upserted only when the phone's
// `clientUpdatedAt` is newer than the stored one, so a retry or a stale copy changes nothing.
// Tombstones, which keep a deleted row from coming back, are slice 4's (docs/04 `sync_tombstone`).

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

export type SyncBatch = {
  workouts: (WorkoutRow | Deletion)[];
  workoutExercises: (WorkoutExerciseRow | Deletion)[];
  sets: (SetRow | Deletion)[];
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
      problem: { code: RefusalCode; status: 404 | 422 };
    };

const isDeletion = (row: WorkoutRow | WorkoutExerciseRow | SetRow | Deletion): row is Deletion =>
  'deletedAt' in row;

const refusal = (table: SyncTable, id: string, code: RefusalCode): SyncResult => ({
  table,
  id,
  status: 'refused',
  problem: { code, status: code === 'not_found' ? 404 : 422 },
});

const excluded = (column: string) => sql.raw(`excluded.${column}`);

/** Ids of the caller's workouts, for the ownership guard on child rows. */
const ownWorkouts = (userId: string) =>
  sql`(SELECT ${workout.id} FROM ${workout} WHERE ${workout.userId} = ${userId})`;

/** Ids of the caller's workout exercises. */
const ownWorkoutExercises = (userId: string) =>
  sql`(SELECT ${workoutExercise.id} FROM ${workoutExercise} WHERE ${workoutExercise.workoutId} IN ${ownWorkouts(userId)})`;

/**
 * Applies one device's queued rows for the caller and answers one result per row sent. Another
 * user's id is refused as not found; a child whose parent is refused, unknown or not the caller's is
 * refused as `parent_missing` (docs/07 §3.4, docs/08 §4).
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

  const apply = async (
    table: SyncTable,
    id: string,
    parentId: string | undefined,
    write: (tx: Queryable) => Promise<SyncResult>,
  ) => {
    let result: SyncResult;
    if (parentId !== undefined && deleted.has(parentId)) {
      result = { table, id, status: 'deleted' };
    } else if (parentId !== undefined && unusable.has(parentId)) {
      result = refusal(table, id, 'parent_missing');
    } else {
      result = await db
        .transaction((tx) => write(tx))
        .catch((error: unknown) => {
          const code = refusalFor(error);
          if (code === undefined) throw error;
          return refusal(table, id, code);
        });
    }
    if (result.status === 'refused') unusable.add(id);
    if (result.status === 'deleted') deleted.add(id);
    results.push(result);
  };

  for (const row of batch.workouts) {
    await apply('workouts', row.id, undefined, (tx) =>
      isDeletion(row) ? deleteWorkout(tx, userId, row) : upsertWorkout(tx, userId, row),
    );
  }
  for (const row of batch.workoutExercises) {
    await apply('workoutExercises', row.id, isDeletion(row) ? undefined : row.workoutId, (tx) =>
      isDeletion(row)
        ? deleteWorkoutExercise(tx, userId, row)
        : upsertWorkoutExercise(tx, userId, row),
    );
  }
  for (const row of batch.sets) {
    await apply('sets', row.id, isDeletion(row) ? undefined : row.workoutExerciseId, (tx) =>
      isDeletion(row) ? deleteSet(tx, userId, row) : upsertSet(tx, userId, row),
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
  if (row.routineId !== null && !(await ownsRoutine(tx, userId, row.routineId))) {
    return refusal('workouts', row.id, 'parent_missing');
  }
  const [written] = await tx
    .insert(workout)
    .values({ ...workoutColumns(row), id: row.id, userId })
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
 * A deletion removes the row when the stored copy is older than `deletedAt`, and counts as deleted
 * when the row is already gone. A newer stored copy wins and is answered as unchanged.
 */
async function deleteWorkout(tx: Queryable, userId: string, row: Deletion): Promise<SyncResult> {
  return deleteRow(row, {
    table: 'workouts',
    remove: () =>
      tx
        .delete(workout)
        .where(
          and(
            eq(workout.id, row.id),
            eq(workout.userId, userId),
            lt(workout.clientUpdatedAt, new Date(row.deletedAt)),
          ),
        )
        .returning({ id: workout.id }),
    stored: async () => {
      const [stored] = await tx.select().from(workout).where(eq(workout.id, row.id));
      if (stored === undefined) return 'gone';
      return stored.userId === userId ? toWorkoutRow(stored) : 'other_user';
    },
  });
}

async function deleteWorkoutExercise(
  tx: Queryable,
  userId: string,
  row: Deletion,
): Promise<SyncResult> {
  const owned = sql`${workoutExercise.workoutId} IN ${ownWorkouts(userId)}`;
  return deleteRow(row, {
    table: 'workoutExercises',
    remove: () =>
      tx
        .delete(workoutExercise)
        .where(
          and(
            eq(workoutExercise.id, row.id),
            owned,
            lt(workoutExercise.clientUpdatedAt, new Date(row.deletedAt)),
          ),
        )
        .returning({ id: workoutExercise.id }),
    stored: async () => {
      const [stored] = await tx
        .select({ row: workoutExercise, owned: sql<boolean>`${owned}` })
        .from(workoutExercise)
        .where(eq(workoutExercise.id, row.id));
      if (stored === undefined) return 'gone';
      return stored.owned ? toWorkoutExerciseRow(stored.row) : 'other_user';
    },
  });
}

async function deleteSet(tx: Queryable, userId: string, row: Deletion): Promise<SyncResult> {
  const owned = sql`${set.workoutExerciseId} IN ${ownWorkoutExercises(userId)}`;
  return deleteRow(row, {
    table: 'sets',
    remove: () =>
      tx
        .delete(set)
        .where(and(eq(set.id, row.id), owned, lt(set.clientUpdatedAt, new Date(row.deletedAt))))
        .returning({ id: set.id }),
    stored: async () => {
      const [stored] = await tx
        .select({ row: set, owned: sql<boolean>`${owned}` })
        .from(set)
        .where(eq(set.id, row.id));
      if (stored === undefined) return 'gone';
      return stored.owned ? toSetRow(stored.row) : 'other_user';
    },
  });
}

async function deleteRow(
  row: Deletion,
  steps: {
    table: SyncTable;
    remove: () => Promise<{ id: string }[]>;
    stored: () => Promise<'gone' | 'other_user' | WorkoutRow | WorkoutExerciseRow | SetRow>;
  },
): Promise<SyncResult> {
  const removed = await steps.remove();
  if (removed.length > 0) return { table: steps.table, id: row.id, status: 'deleted' };
  const stored = await steps.stored();
  if (stored === 'gone') return { table: steps.table, id: row.id, status: 'deleted' };
  if (stored === 'other_user') return refusal(steps.table, row.id, 'not_found');
  return { table: steps.table, id: row.id, status: 'unchanged', row: stored };
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
