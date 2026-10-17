import type { BodyweightCount, LastTime, WeightUnit } from '@overload/api-contract';
import type { WorkoutExerciseRecord } from './set-store';
import { formatWeight } from './units';

// Which weigh-in a bodyweight lift was counted at (issue #69, docs/06 2026-10-16). The API names
// the weigh-in; this only words it. A pull-up counts all of the weight plus any kg logged on it.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `12 Nov`, from a local date. */
const shortDate = (date: string) => {
  const [, month = '1', day = '1'] = date.split('-');
  return `${Number(day)} ${MONTHS[Number(month) - 1] ?? ''}`;
};

/** The weigh-in a workout was counted at, as a sentence; the workout's own day is not named. */
export function countedAt(count: BodyweightCount, unit: WeightUnit): string {
  if (count.basis === 'none') return 'No weigh-in · counted as logged';
  const weight = `${formatWeight(count.weightKg, unit)} ${unit}`;
  if (count.basis === 'same_day') return `Counted at ${weight} · that day’s weigh-in`;
  if (count.basis === 'earlier_day') {
    return `Counted at ${weight} · your weigh-in of ${shortDate(count.weighedOn)}`;
  }
  return `Counted at ${weight} · your first weigh-in, ${shortDate(count.weighedOn)}`;
}

/**
 * An open workout's copy of last time, with the counts the API gives in an answer newer than the
 * workout: a weigh-in typed since then moves them. The copy is kept when that answer names another
 * workout, as it does once this one is synced.
 */
export function recountedLastTime(
  exercise: WorkoutExerciseRecord,
  lastTimes: { exercises: LastTime[]; updatedAt: number } | undefined,
  workout: { id: string; startedAt: string },
): WorkoutExerciseRecord {
  const { bodyweight, lastTime, lastTimeOn } = exercise.local;
  if (!bodyweight || lastTimeOn == null || lastTimes === undefined) return exercise;
  if (lastTimes.updatedAt <= new Date(workout.startedAt).getTime()) return exercise;
  const logged = lastTimes.exercises.find((last) => last.exerciseId === exercise.row.exerciseId);
  const last =
    logged?.slots.find((own) => own.routineExerciseId === exercise.row.routineExerciseId) ?? logged;
  if (
    last === undefined ||
    last.workoutId === workout.id ||
    last.performedOn !== lastTimeOn ||
    last.sets.length !== lastTime.length ||
    last.sets.some((set, index) => set.weightKg !== lastTime[index]?.weightKg)
  )
    return exercise;
  return {
    ...exercise,
    local: {
      ...exercise.local,
      lastTimeBodyweight: last.bodyweight,
      lastTime: lastTime.map((set, index) => ({
        ...set,
        countedWeightKg: last.sets[index]?.countedWeightKg ?? set.weightKg,
      })),
    },
  };
}
