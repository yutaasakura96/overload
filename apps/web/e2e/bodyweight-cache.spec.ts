import { expect, test } from '@playwright/test';
import type { LastTime, WeighIn } from '@overload/api-contract';
import { recountedLastTime } from '../src/bodyweight';
import type { WorkoutExerciseRecord } from '../src/set-store';

const startedAt = '2026-10-11T10:00:00.000Z';
// The zone the workout started in.
const zone = 'Asia/Tokyo';
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
    undefined,
    startedAt,
    zone,
  );
  expect(older).toBe(lastTime);

  const weighed = recountedLastTime(
    lastTime,
    {
      exercises: [answer(100, { basis: 'same_day', weightKg: 90, weighedOn: '2026-10-10' })],
      updatedAt: after,
    },
    undefined,
    startedAt,
    zone,
  );
  expect(weighed.local.lastTime[0]).toMatchObject({ weightKg: 10, countedWeightKg: 100 });
  expect(weighed.local.lastTimeBodyweight).toMatchObject({ weightKg: 90 });
  expect(weighed.local.suggestion?.weightKg).toBe(10);

  const deleted = recountedLastTime(
    lastTime,
    { exercises: [answer(10, { basis: 'none' })], updatedAt: after },
    undefined,
    startedAt,
    zone,
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
    undefined,
    startedAt,
    zone,
  );
  expect(synced).toBe(lastTime);
});

// The readings as `GET /api/weigh-ins` lists them, newest first: each at 07:00 in Tokyo.
const weighed = (...days: [string, number][]) =>
  days.map(([date, weightKg]) => reading(`${date}T07:00:00+09:00`, weightKg));
const reading = (at: string, weightKg: number): WeighIn => ({
  id: `weigh-in-${at}`,
  measuredAt: new Date(at).toISOString(),
  weightKg,
  bodyFatPct: null,
  source: 'manual',
});
// Last time was answered at 82 kg the evening before the workout, and copied at the start.
const answeredAt = Date.parse(startedAt) - 60_000;
const copied: WorkoutExerciseRecord = {
  ...lastTime,
  local: { ...lastTime.local, lastTimeAt: answeredAt },
};

test('offline, a weigh-in cached after last time’s answer moves the open workout’s count', () => {
  // 85 kg typed for last time's day after the answer said 82, then the workout started offline.
  const recounted = recountedLastTime(
    copied,
    undefined,
    { readings: weighed(['2026-10-10', 85], ['2026-10-01', 80]), updatedAt: answeredAt + 1 },
    startedAt,
    zone,
  );
  expect(recounted.local.lastTime[0]).toMatchObject({ weightKg: 10, countedWeightKg: 95 });
  expect(recounted.local.lastTimeBodyweight).toEqual({
    basis: 'same_day',
    weightKg: 85,
    weighedOn: '2026-10-10',
  });
  expect(recounted.local.suggestion?.weightKg).toBe(10);

  // No weigh-in on last time's day: the latest earlier one, as the API counts it.
  const earlier = recountedLastTime(
    copied,
    undefined,
    { readings: weighed(['2026-10-12', 86], ['2026-10-08', 85]), updatedAt: answeredAt + 1 },
    startedAt,
    zone,
  );
  expect(earlier.local.lastTime[0]?.countedWeightKg).toBe(95);
  expect(earlier.local.lastTimeBodyweight).toMatchObject({
    basis: 'earlier_day',
    weighedOn: '2026-10-08',
  });

  // Every weigh-in deleted since: counted as logged.
  const none = recountedLastTime(
    copied,
    undefined,
    { readings: [], updatedAt: answeredAt + 1 },
    startedAt,
    zone,
  );
  expect(none.local.lastTime[0]?.countedWeightKg).toBe(10);
  expect(none.local.lastTimeBodyweight).toEqual({ basis: 'none' });
});

test('weigh-ins older than the answer leave the count the API gave', () => {
  const stale = { readings: weighed(['2026-10-10', 85]), updatedAt: answeredAt - 1 };
  expect(recountedLastTime(copied, undefined, stale, startedAt, zone)).toBe(copied);

  // An answer fetched after the weigh-ins were cached is the newer one.
  const answered = recountedLastTime(
    copied,
    {
      exercises: [answer(98, { basis: 'same_day', weightKg: 88, weighedOn: '2026-10-10' })],
      updatedAt: after + 1,
    },
    { readings: weighed(['2026-10-10', 85]), updatedAt: after },
    startedAt,
    zone,
  );
  expect(answered.local.lastTime[0]?.countedWeightKg).toBe(98);

  // A copy kept before the answer's time was carried is never recounted from weigh-ins.
  const fresh = { readings: weighed(['2026-10-10', 85]), updatedAt: after };
  expect(recountedLastTime(lastTime, undefined, fresh, startedAt, zone)).toBe(lastTime);
});

test('offline, cached weigh-ins are dated in the workout’s zone, not a profile zone changed since', () => {
  // Last time was on 10 Oct in Tokyo, the workout's zone. Mid-workout the profile moved to Los
  // Angeles and the weigh-ins were asked again, so the API dated them there: 07:30 Tokyo on the
  // 10th is 15:30 on the 9th in Los Angeles, and 23:30 Tokyo on the 10th is 07:30 on the 10th.
  const readings = [
    reading('2026-10-10T23:30:00+09:00', 88),
    reading('2026-10-10T07:30:00+09:00', 85),
    reading('2026-10-09T23:30:00+09:00', 80),
  ];
  const recounted = recountedLastTime(
    copied,
    undefined,
    { readings, updatedAt: answeredAt + 1 },
    startedAt,
    zone,
  );
  expect(recounted.local.lastTimeBodyweight).toEqual({
    basis: 'same_day',
    weightKg: 85,
    weighedOn: '2026-10-10',
  });
  expect(recounted.local.lastTime[0]?.countedWeightKg).toBe(95);

  // Read in Los Angeles, the same readings would have counted 88 kg for the 10th.
  const elsewhere = recountedLastTime(
    copied,
    undefined,
    { readings, updatedAt: answeredAt + 1 },
    startedAt,
    'America/Los_Angeles',
  );
  expect(elsewhere.local.lastTimeBodyweight).toMatchObject({ weightKg: 88 });
});
