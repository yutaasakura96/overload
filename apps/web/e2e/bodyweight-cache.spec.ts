import { expect, test } from '@playwright/test';
import type { WeightDay } from '@overload/api-contract';
import { countedLastTime } from '../src/bodyweight';
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

const day = (weightKg: number): WeightDay => ({
  date: '2026-10-10',
  weighInId: 'weigh-in',
  weightKg,
  morning: true,
  trendKg: null,
});

test('an older weigh-in cache cannot replace the API count in an open workout', () => {
  const restored = countedLastTime(lastTime, { days: [day(80)] }, startedAt);
  expect(restored.local.lastTime[0]?.countedWeightKg).toBe(92);

  const stale = countedLastTime(
    lastTime,
    { days: [day(80)], requestedAt: Date.parse(startedAt) - 1 },
    startedAt,
  );
  expect(stale.local.lastTime[0]?.countedWeightKg).toBe(92);
  expect(stale.local.lastTimeBodyweight).toMatchObject({ weightKg: 82 });

  const fresh = countedLastTime(
    lastTime,
    { days: [day(90)], requestedAt: Date.parse(startedAt) + 1 },
    startedAt,
  );
  expect(fresh.local.lastTime[0]).toMatchObject({ weightKg: 10, countedWeightKg: 100 });
  expect(fresh.local.lastTimeBodyweight).toMatchObject({ weightKg: 90 });
  expect(fresh.local.suggestion?.weightKg).toBe(10);

  const deleted = countedLastTime(
    lastTime,
    { days: [], requestedAt: Date.parse(startedAt) + 2 },
    startedAt,
  );
  expect(deleted.local.lastTime[0]?.countedWeightKg).toBe(10);
  expect(deleted.local.lastTimeBodyweight).toEqual({ basis: 'none' });
});
