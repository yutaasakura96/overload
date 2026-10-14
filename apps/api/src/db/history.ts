import { and, asc, count, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { topSet } from '../domain/e1rm.js';
import type { Database } from './connection.js';
import { exercise, set, workout, workoutExercise } from './schema.js';
import {
  toSetRow,
  toWorkoutExerciseRow,
  toWorkoutRow,
  type SetRow,
  type WorkoutExerciseRow,
  type WorkoutRow,
} from './workouts.js';

// Reading workouts (docs/07 §3): History's list of finished workouts, and one workout whole. The
// rows are written by the sync batch alone (workouts.ts); nothing here changes one.

/** One finished workout as History lists it. */
export type WorkoutSummary = {
  id: string;
  name: string;
  /** The routine it was started from; null when it came from none, or the routine is gone. */
  routineId: string | null;
  startedAt: string;
  endedAt: string;
  /** Warm-ups are not counted (S6). */
  workingSets: number;
  /** Each exercise that logged a working set, in the workout's order, with its top set. */
  exercises: { name: string; topSetKg: number; topSetReps: number }[];
};

/** Where a page ended: the sort key and the id, so a row inserted during paging is not shown twice. */
export type WorkoutCursor = { startedAt: string; id: string };

/**
 * The user's finished workouts, newest `startedAt` first, one page of them after `after`, with how
 * many there are in all. One still in progress is not history yet.
 */
export async function listWorkouts(
  db: Database,
  userId: string,
  page: { limit: number; after?: WorkoutCursor | undefined },
): Promise<{ items: WorkoutSummary[]; next: WorkoutCursor | null; total: number }> {
  const finished = and(eq(workout.userId, userId), isNotNull(workout.endedAt));
  const { after } = page;
  // One more than the page, to know whether another follows.
  const found = await db
    .select()
    .from(workout)
    .where(
      after === undefined
        ? finished
        : and(
            finished,
            sql`(${workout.startedAt}, ${workout.id}) < (${after.startedAt}::timestamptz, ${after.id}::uuid)`,
          ),
    )
    .orderBy(desc(workout.startedAt), desc(workout.id))
    .limit(page.limit + 1);
  const shown = found.slice(0, page.limit);
  const [counted] = await db.select({ total: count() }).from(workout).where(finished);

  const logged =
    shown.length === 0
      ? []
      : await db
          .select({
            workoutId: workoutExercise.workoutId,
            workoutExerciseId: workoutExercise.id,
            name: exercise.name,
            weightKg: set.weightKg,
            reps: set.reps,
          })
          .from(workoutExercise)
          .innerJoin(workout, eq(workout.id, workoutExercise.workoutId))
          .innerJoin(exercise, eq(exercise.id, workoutExercise.exerciseId))
          .innerJoin(set, eq(set.workoutExerciseId, workoutExercise.id))
          .where(
            and(
              eq(workout.userId, userId),
              inArray(
                workoutExercise.workoutId,
                shown.map((each) => each.id),
              ),
              eq(set.isWarmup, false),
            ),
          )
          .orderBy(asc(workoutExercise.position), asc(workoutExercise.id));

  const items = shown.flatMap((stored): WorkoutSummary[] => {
    const row = toWorkoutRow(stored);
    if (row.endedAt === null) return [];
    const sets = logged.filter((each) => each.workoutId === stored.id);
    const exercises = [...new Set(sets.map((each) => each.workoutExerciseId))].flatMap((id) => {
      const own = sets.filter((each) => each.workoutExerciseId === id);
      const top = topSet(own.map((each) => ({ ...each, isWarmup: false })));
      const name = own[0]?.name;
      if (top === undefined || name === undefined) return [];
      return [{ name, topSetKg: top.weightKg, topSetReps: top.reps }];
    });
    return [
      {
        id: row.id,
        name: row.name,
        routineId: row.routineId,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        workingSets: sets.length,
        exercises,
      },
    ];
  });
  const last = shown.at(-1);
  return {
    items,
    next:
      found.length > page.limit && last !== undefined
        ? { startedAt: last.startedAt.toISOString(), id: last.id }
        : null,
    total: counted?.total ?? 0,
  };
}

/** One workout as the sync batch holds it, with each exercise's name and every set it logged. */
export type WorkoutDetail = WorkoutRow & {
  exercises: (WorkoutExerciseRow & { name: string; sets: SetRow[] })[];
};

/**
 * One of the user's workouts with its exercises and their sets in order, warm-ups included, or
 * `undefined` when it is not theirs to see. An exercise that logged nothing is still listed.
 */
export async function getWorkout(
  db: Database,
  userId: string,
  id: string,
): Promise<WorkoutDetail | undefined> {
  const own = and(eq(workout.id, id), eq(workout.userId, userId));
  const [stored] = await db.select().from(workout).where(own);
  if (stored === undefined) return undefined;
  const exercises = await db
    .select({ row: workoutExercise, name: exercise.name })
    .from(workoutExercise)
    .innerJoin(workout, eq(workout.id, workoutExercise.workoutId))
    .innerJoin(exercise, eq(exercise.id, workoutExercise.exerciseId))
    .where(own)
    .orderBy(asc(workoutExercise.position), asc(workoutExercise.id));
  const sets = await db
    .select({ row: set })
    .from(set)
    .innerJoin(workoutExercise, eq(workoutExercise.id, set.workoutExerciseId))
    .innerJoin(workout, eq(workout.id, workoutExercise.workoutId))
    .where(own)
    .orderBy(asc(set.position), asc(set.id));
  return {
    ...toWorkoutRow(stored),
    exercises: exercises.map(({ row, name }) => ({
      ...toWorkoutExerciseRow(row),
      name,
      sets: sets
        .filter((each) => each.row.workoutExerciseId === row.id)
        .map((each) => toSetRow(each.row)),
    })),
  };
}
