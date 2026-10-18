import type { BodyweightCount, LastTime, WeightDay, WeightUnit } from '@overload/api-contract';
import { bodyweightOn, countedLoad } from './bodyweight-count';
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
 * An open workout's copy of last time, counted from the newest of three: the answer it copied, a
 * Last time answer fetched since, and the weigh-ins cached since (issue #69). The API counts the
 * first two; the weigh-ins are counted here only offline, when they are newer than any answer. A
 * later answer is used only when it is about the workout the copy was made from. A copy kept
 * before its answer's time was carried is not recounted from weigh-ins.
 */
export function recountedLastTime(
  exercise: WorkoutExerciseRecord,
  lastTimes: { exercises: LastTime[]; updatedAt: number } | undefined,
  weighIns: { days: WeightDay[]; updatedAt: number } | undefined,
  startedAt: string,
): WorkoutExerciseRecord {
  const { bodyweight, lastTime, lastTimeOn, lastTimeAt } = exercise.local;
  if (!bodyweight || lastTimeOn == null || lastTime.length === 0) return exercise;
  const answered = answeredSince(
    exercise,
    lastTimes,
    Math.max(Date.parse(startedAt), lastTimeAt ?? 0),
  );
  if (lastTimeAt === undefined || weighIns === undefined) return answered?.exercise ?? exercise;
  if (weighIns.updatedAt <= Math.max(lastTimeAt, answered?.at ?? 0)) {
    return answered?.exercise ?? exercise;
  }
  const count = bodyweightOn(weighIns.days, lastTimeOn);
  return counted(
    exercise,
    count,
    lastTime.map((set) => countedLoad(set.weightKg, count)),
  );
}

/** The copy as a Last time answer newer than `since` counts it, when it is about the same sets. */
function answeredSince(
  exercise: WorkoutExerciseRecord,
  lastTimes: { exercises: LastTime[]; updatedAt: number } | undefined,
  since: number,
): { exercise: WorkoutExerciseRecord; at: number } | undefined {
  const { lastTime, lastTimeOn } = exercise.local;
  if (lastTimes === undefined || lastTimes.updatedAt <= since) return undefined;
  const logged = lastTimes.exercises.find((last) => last.exerciseId === exercise.row.exerciseId);
  const last =
    logged?.slots.find((own) => own.routineExerciseId === exercise.row.routineExerciseId) ?? logged;
  if (
    last === undefined ||
    last.performedOn !== lastTimeOn ||
    last.sets.length !== lastTime.length ||
    last.sets.some((set, index) => set.weightKg !== lastTime[index]?.weightKg)
  )
    return undefined;
  return {
    exercise: counted(
      exercise,
      last.bodyweight,
      lastTime.map((set, index) => last.sets[index]?.countedWeightKg ?? set.weightKg),
    ),
    at: lastTimes.updatedAt,
  };
}

const counted = (
  exercise: WorkoutExerciseRecord,
  count: BodyweightCount | null,
  countedKg: number[],
): WorkoutExerciseRecord => ({
  ...exercise,
  local: {
    ...exercise.local,
    lastTimeBodyweight: count,
    lastTime: exercise.local.lastTime.map((set, index) => ({
      ...set,
      countedWeightKg: countedKg[index] ?? set.weightKg,
    })),
  },
});
