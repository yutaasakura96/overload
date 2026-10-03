import { sql } from 'drizzle-orm';
import { suggest, type Suggestion } from '../domain/progression.js';
import type { Database } from './connection.js';
import { listExercises } from './exercises.js';

/** Last time for one exercise (S2) and today's suggestion from it (S3), docs/07 §3. */
export type LastTime = {
  exerciseId: string;
  workoutId: string;
  /** The workout's local date, read in the user's time zone. */
  performedOn: string;
  sets: { workingSet: number; weightKg: number; reps: number }[];
  suggestion: Suggestion;
};

type Row = {
  exercise_id: string;
  workout_id: string;
  started_at: Date;
  rep_high: number;
  weight_kg: number;
  reps: number;
};

/**
 * For every exercise the user has logged a working set of: the most recent such workout's working
 * sets, numbered 1…n in `position` order with warm-ups left out (docs/04 `set`), and the suggestion.
 * The rule reads the rep range that workout ran with and the increment the user has today.
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

  const exercises = new Map(
    (await listExercises(db, userId, { includeHidden: true })).map((e) => [e.id, e]),
  );
  const localDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    grouped.set(row.exercise_id, [...(grouped.get(row.exercise_id) ?? []), row]);
  }
  return [...grouped].flatMap(([exerciseId, sets]) => {
    const first = sets[0];
    const settings = exercises.get(exerciseId);
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
        exerciseId,
        workoutId: first.workout_id,
        performedOn: localDate.format(new Date(first.started_at)),
        sets: working.map((s, index) => ({ workingSet: index + 1, ...s })),
        suggestion,
      },
    ];
  });
}
