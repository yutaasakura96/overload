import { expect, test } from '@playwright/test';
import type { LastTime } from '@overload/api-contract';
import { recountedLastTime } from '../src/bodyweight';
import type { WorkoutExerciseRecord } from '../src/set-store';

const startedAt = '2026-10-11T10:00:00.000Z';
const lastTime: WorkoutExerciseRecord = {
  id: 'exercise',
  userId: 'member',
  workoutId: 'workout',
  state: 'acknowledged',
  table: 'workoutExercises',
  row: {
    id: 'exercise',
    workoutId: 'workout',
    exerciseId: 'pull-up',
    routineExerciseId: null,
    position: 0,
    targetSets: 1,
    repLow: 6,
    repHigh: 10,
    incrementKg: 0,
    clientUpdatedAt: startedAt,
  },
  local: {
    name: 'Pull-Up',
    bodyweight: true,
    restSeconds: 60,
    lastTime: [{ weightKg: 10, countedWeightKg: 92, reps: 8 }],
    lastTimeBodyweight: { basis: 'same_day', weightKg: 82, weighedOn: '2026-10-10' },
    lastTimeOn: '2026-10-10',
    suggestion: { weightKg: 10, rule: 'repeat', reason: 'set 1 stopped at 8 of 10 last time' },
  },
};

const answer = (
  countedKg: number,
  bodyweight: LastTime['bodyweight'],
  changes: Partial<LastTime> = {},
): LastTime => ({
  exerciseId: 'pull-up',
  workoutId: 'last-workout',
  performedOn: '2026-10-10',
  sets: [{ workingSet: 1, weightKg: 10, countedWeightKg: countedKg, reps: 8, rir: null }],
  bodyweight,
  suggestion: { weightKg: 10, rule: 'repeat', reason: 'set 1 stopped at 8 of 10 last time' },
  slots: [],
  ...changes,
});
const after = Date.parse(startedAt) + 1;

test('an open workout takes last time’s counts only from an answer newer than the workout', () => {
  const older = recountedLastTime(
    lastTime,
    {
      exercises: [answer(90, { basis: 'same_day', weightKg: 80, weighedOn: '2026-10-10' })],
      updatedAt: Date.parse(startedAt) - 1,
    },
    startedAt,
  );
  expect(older).toBe(lastTime);

  const weighed = recountedLastTime(
    lastTime,
    {
      exercises: [answer(100, { basis: 'same_day', weightKg: 90, weighedOn: '2026-10-10' })],
      updatedAt: after,
    },
    startedAt,
  );
  expect(weighed.local.lastTime[0]).toMatchObject({ weightKg: 10, countedWeightKg: 100 });
  expect(weighed.local.lastTimeBodyweight).toMatchObject({ weightKg: 90 });
  expect(weighed.local.suggestion?.weightKg).toBe(10);

  const deleted = recountedLastTime(
    lastTime,
    { exercises: [answer(10, { basis: 'none' })], updatedAt: after },
    startedAt,
  );
  expect(deleted.local.lastTime[0]?.countedWeightKg).toBe(10);
  expect(deleted.local.lastTimeBodyweight).toEqual({ basis: 'none' });
});

test('an answer about another workout leaves the open workout’s copy as it is', () => {
  const synced = recountedLastTime(
    lastTime,
    {
      exercises: [
        answer(
          100,
          { basis: 'same_day', weightKg: 90, weighedOn: '2026-10-11' },
          { workoutId: 'newer-workout', performedOn: '2026-10-11' },
        ),
      ],
      updatedAt: after,
    },
    startedAt,
  );
  expect(synced).toBe(lastTime);
});
