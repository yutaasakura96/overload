import { sql } from 'drizzle-orm';
import type { LoggedWorkout } from '../domain/progress.js';
import { suggest, type Suggestion } from '../domain/progression.js';
import type { Database } from './connection.js';
import { listExercises } from './exercises.js';

type Last = {
  workoutId: string;
  /** The workout's local date, read in the user's time zone. */
  performedOn: string;
  sets: { workingSet: number; weightKg: number; reps: number; rir: number | null }[];
  suggestion: Suggestion;
};

/** Last time for one exercise (S2) and today's suggestion from it (S3), docs/07 §3. */
export type LastTime = Last & {
  exerciseId: string;
  /**
   * Per routine slot that still exists: its own sets from the last workout that ran it, judged
   * against its own rep range.
   */
  slots: (Last & { routineExerciseId: string })[];
};

type Row = {
  exercise_id: string;
  workout_id: string;
  started_at: Date;
  rep_high: number;
  weight_kg: number;
  reps: number;
  rir: number | null;
};

type SlotRow = Row & { routine_exercise_id: string };

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) grouped.set(key(row), [...(grouped.get(key(row)) ?? []), row]);
  return grouped;
}

/**
 * For every exercise the user has logged a working set of: the most recent such workout's working
 * sets, numbered 1…n in `position` order with warm-ups left out (docs/04 `set`), and the suggestion.
 * The rule reads the rep range that workout ran with and the increment the user has today. Each
 * routine slot that still exists also answers from the last workout that ran that slot.
 */
export async function lastTimes(
  db: Database,
  userId: string,
  timezone: string,
): Promise<LastTime[]> {
  const { rows } = await db.execute<Row>(sql`
    WITH latest AS (
      SELECT DISTINCT ON (we.exercise_id) we.exercise_id, w.id AS workout_id, w.started_at
      FROM workout w
      JOIN workout_exercise we ON we.workout_id = w.id
      WHERE w.user_id = ${userId}
        AND EXISTS (
          SELECT 1 FROM "set" s WHERE s.workout_exercise_id = we.id AND NOT s.is_warmup
        )
      ORDER BY we.exercise_id, w.started_at DESC, w.id DESC
    )
    SELECT l.exercise_id, l.workout_id, l.started_at, we.rep_high,
           s.weight_kg::float8 AS weight_kg, s.reps, s.rir
    FROM latest l
    JOIN workout_exercise we ON we.workout_id = l.workout_id AND we.exercise_id = l.exercise_id
    JOIN "set" s ON s.workout_exercise_id = we.id AND NOT s.is_warmup
    ORDER BY l.exercise_id, we.position, we.id, s.position, s.id
  `);
  if (rows.length === 0) return [];
  const { rows: slotRows } = await db.execute<SlotRow>(sql`
    WITH latest AS (
      SELECT DISTINCT ON (we.routine_exercise_id)
             we.routine_exercise_id, we.id, we.exercise_id, we.rep_high,
             w.id AS workout_id, w.started_at
      FROM workout w
      JOIN workout_exercise we ON we.workout_id = w.id
      JOIN routine_exercise re
        ON re.id = we.routine_exercise_id AND re.exercise_id = we.exercise_id
      JOIN routine r ON r.id = re.routine_id AND r.user_id = ${userId}
      WHERE w.user_id = ${userId}
        AND EXISTS (
          SELECT 1 FROM "set" s WHERE s.workout_exercise_id = we.id AND NOT s.is_warmup
        )
      ORDER BY we.routine_exercise_id, w.started_at DESC, w.id DESC, we.position, we.id
    )
    SELECT l.routine_exercise_id, l.exercise_id, l.workout_id, l.started_at, l.rep_high,
           s.weight_kg::float8 AS weight_kg, s.reps, s.rir
    FROM latest l
    JOIN "set" s ON s.workout_exercise_id = l.id AND NOT s.is_warmup
    ORDER BY l.exercise_id, l.routine_exercise_id, s.position, s.id
  `);

  const exercises = new Map(
    (await listExercises(db, userId, { includeHidden: true })).map((e) => [e.id, e]),
  );
  const localDate = localDateIn(timezone);

  const lastOf = (sets: Row[]): Last[] => {
    const first = sets[0];
    const settings = first === undefined ? undefined : exercises.get(first.exercise_id);
    if (first === undefined || settings === undefined) return [];
    const working = sets.map((s) => ({ weightKg: s.weight_kg, reps: s.reps, rir: s.rir }));
    const suggestion = suggest({
      sets: working,
      repHigh: first.rep_high,
      incrementKg: settings.incrementKg,
      equipment: settings.equipment,
    });
    if (suggestion === undefined) return [];
    return [
      {
        workoutId: first.workout_id,
        performedOn: localDate(new Date(first.started_at)),
        sets: working.map((s, index) => ({ workingSet: index + 1, ...s })),
        suggestion,
      },
    ];
  };

  const slots = groupBy(slotRows, (row) => row.exercise_id);
  return [...groupBy(rows, (row) => row.exercise_id)].flatMap(([exerciseId, sets]) =>
    lastOf(sets).map((last) => ({
      exerciseId,
      ...last,
      slots: [...groupBy(slots.get(exerciseId) ?? [], (row) => row.routine_exercise_id)].flatMap(
        ([routineExerciseId, own]) => lastOf(own).map((ran) => ({ routineExerciseId, ...ran })),
      ),
    })),
  );
}

/** A local date, `YYYY-MM-DD`, as the user's time zone reads an instant. */
export const localDateIn = (timezone: string) => {
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return (instant: Date) => format.format(instant);
};

type LoggedRow = {
  workout_id: string;
  started_at: Date;
  weight_kg: number;
  reps: number;
  is_warmup: boolean;
};

/**
 * The user's workouts that logged one exercise, oldest first, each with every set of it, warm-ups
 * included, and its local date (S7, docs/04 *Queries the indexes are for*). `since` is a local
 * date: workouts that started before it are left unread.
 */
export async function loggedWorkouts(
  db: Database,
  userId: string,
  exerciseId: string,
  timezone: string,
  since?: string,
): Promise<LoggedWorkout[]> {
  const { rows } = await db.execute<LoggedRow>(sql`
    SELECT w.id AS workout_id, w.started_at, s.weight_kg::float8 AS weight_kg, s.reps, s.is_warmup
    FROM workout w
    JOIN workout_exercise we ON we.workout_id = w.id
    JOIN "set" s ON s.workout_exercise_id = we.id
    WHERE w.user_id = ${userId}
      AND we.exercise_id = ${exerciseId}
      AND (${since ?? null}::date IS NULL
        OR w.started_at >= (${since ?? null}::date::timestamp AT TIME ZONE ${timezone}))
    ORDER BY w.started_at, w.id, we.position, we.id, s.position, s.id
  `);
  const localDate = localDateIn(timezone);
  return [...groupBy(rows, (row) => row.workout_id)].map(([workoutId, sets]) => ({
    workoutId,
    date: localDate(new Date(sets[0]?.started_at ?? 0)),
    sets: sets.map((set) => ({ weightKg: set.weight_kg, reps: set.reps, isWarmup: set.is_warmup })),
  }));
}
