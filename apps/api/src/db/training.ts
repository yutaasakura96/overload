import { sql } from 'drizzle-orm';
import { suggest, type Suggestion } from '../domain/progression.js';
import type { Database } from './connection.js';
import { listExercises } from './exercises.js';

type Last = {
  workoutId: string;
  /** The workout's local date, read in the user's time zone. */
  performedOn: string;
  sets: { workingSet: number; weightKg: number; reps: number }[];
  suggestion: Suggestion;
};

/** Last time for one exercise (S2) and today's suggestion from it (S3), docs/07 §3. */
export type LastTime = Last & {
  exerciseId: string;
  /**
   * Where a routine's last workout ran the exercise in more than one slot: each slot's own sets,
   * judged against its own rep range. `slot` counts the exercise's slots in that workout from 0.
   */
  slots: (Last & { routineId: string; slot: number })[];
};

type Row = {
  exercise_id: string;
  workout_id: string;
  started_at: Date;
  rep_high: number;
  weight_kg: number;
  reps: number;
};

type SlotRow = Row & { routine_id: string; slot: number };

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) grouped.set(key(row), [...(grouped.get(key(row)) ?? []), row]);
  return grouped;
}

/**
 * For every exercise the user has logged a working set of: the most recent such workout's working
 * sets, numbered 1…n in `position` order with warm-ups left out (docs/04 `set`), and the suggestion.
 * The rule reads the rep range that workout ran with and the increment the user has today. An
 * exercise a routine's last workout ran in several slots also answers slot by slot.
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
           s.weight_kg::float8 AS weight_kg, s.reps
    FROM latest l
    JOIN workout_exercise we ON we.workout_id = l.workout_id AND we.exercise_id = l.exercise_id
    JOIN "set" s ON s.workout_exercise_id = we.id AND NOT s.is_warmup
    ORDER BY l.exercise_id, we.position, we.id, s.position, s.id
  `);
  if (rows.length === 0) return [];
  const { rows: slotRows } = await db.execute<SlotRow>(sql`
    WITH latest AS (
      SELECT DISTINCT ON (w.routine_id, we.exercise_id)
             w.routine_id, we.exercise_id, w.id AS workout_id, w.started_at
      FROM workout w
      JOIN workout_exercise we ON we.workout_id = w.id
      WHERE w.user_id = ${userId}
        AND w.routine_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM "set" s WHERE s.workout_exercise_id = we.id AND NOT s.is_warmup
        )
      ORDER BY w.routine_id, we.exercise_id, w.started_at DESC, w.id DESC
    ),
    slots AS (
      SELECT l.routine_id, l.exercise_id, l.workout_id, l.started_at, we.id, we.rep_high,
             (row_number() OVER slot_order - 1)::int AS slot,
             count(*) OVER (PARTITION BY l.routine_id, l.exercise_id) AS slot_count
      FROM latest l
      JOIN workout_exercise we ON we.workout_id = l.workout_id AND we.exercise_id = l.exercise_id
      WINDOW slot_order AS (PARTITION BY l.routine_id, l.exercise_id ORDER BY we.position, we.id)
    )
    SELECT sl.routine_id, sl.exercise_id, sl.slot, sl.workout_id, sl.started_at, sl.rep_high,
           s.weight_kg::float8 AS weight_kg, s.reps
    FROM slots sl
    JOIN "set" s ON s.workout_exercise_id = sl.id AND NOT s.is_warmup
    WHERE sl.slot_count > 1
    ORDER BY sl.routine_id, sl.exercise_id, sl.slot, s.position, s.id
  `);

  const exercises = new Map(
    (await listExercises(db, userId, { includeHidden: true })).map((e) => [e.id, e]),
  );
  const localDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const lastOf = (sets: Row[]): Last[] => {
    const first = sets[0];
    const settings = first === undefined ? undefined : exercises.get(first.exercise_id);
    if (first === undefined || settings === undefined) return [];
    const working = sets.map((s) => ({ weightKg: s.weight_kg, reps: s.reps }));
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
        performedOn: localDate.format(new Date(first.started_at)),
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
      slots: [
        ...groupBy(slots.get(exerciseId) ?? [], (row) => `${row.routine_id} ${row.slot}`).values(),
      ].flatMap((own) => {
        const [first] = own;
        if (first === undefined) return [];
        return lastOf(own).map((ran) => ({
          routineId: first.routine_id,
          slot: first.slot,
          ...ran,
        }));
      }),
    })),
  );
}
