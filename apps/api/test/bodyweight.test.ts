import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
// The web app's offline copy of the rule, checked against this one below.
import * as offline from '../../web/src/bodyweight-count';
import { bodyweightOn, countedLoad, withBodyweight } from '../src/domain/bodyweight';
import { exerciseProgress, type LoggedWorkout } from '../src/domain/progress';
import { strengthOverview, type LoggedLift } from '../src/domain/strength';
import type { DailyWeight } from '../src/domain/weight';
import { sender } from './account-fixture';
import { useTestApp } from './harness';

// Bodyweight on bodyweight lifts (issue #69, docs/06 2026-10-16): which weigh-in counts for a
// workout, the added load, and the lift's e1RM, top set and Strength trend at that load. The pure
// rule first, then the two routes that read weigh-ins, with their cross-user cases (docs/08 §10).

const day = (date: string, weightKg: number): DailyWeight => ({
  date,
  weighInId: randomUUID(),
  weightKg,
  morning: true,
});

const weighed = [day('2026-09-01', 80), day('2026-09-10', 82), day('2026-09-20', 81)];

describe('bodyweightOn', () => {
  it('counts the workout’s own day when it was weighed', () => {
    expect(bodyweightOn(weighed, '2026-09-10')).toEqual({
      basis: 'same_day',
      weightKg: 82,
      weighedOn: '2026-09-10',
    });
  });

  it('counts the latest earlier day when the workout’s day has no reading', () => {
    expect(bodyweightOn(weighed, '2026-09-15')).toEqual({
      basis: 'earlier_day',
      weightKg: 82,
      weighedOn: '2026-09-10',
    });
    expect(bodyweightOn(weighed, '2026-12-01')).toMatchObject({
      basis: 'earlier_day',
      weighedOn: '2026-09-20',
    });
  });

  it('counts the first later weigh-in for a workout older than every weigh-in, and says so', () => {
    expect(bodyweightOn(weighed, '2026-08-15')).toEqual({
      basis: 'later_day',
      weightKg: 80,
      weighedOn: '2026-09-01',
    });
  });

  it('says there was no weigh-in when the lifter has none', () => {
    expect(bodyweightOn([], '2026-09-10')).toEqual({ basis: 'none' });
  });
});

describe('the web app’s offline copy of the rule', () => {
  it('counts every day as bodyweightOn and countedLoad do, in either order of days', () => {
    const dates = [
      '2026-08-31',
      '2026-09-01',
      '2026-09-05',
      '2026-09-10',
      '2026-09-20',
      '2026-09-21',
    ];
    for (const days of [[], [weighed[1]!], weighed, weighed.toReversed()]) {
      for (const date of dates) {
        const count = bodyweightOn(
          days.toSorted((a, b) => a.date.localeCompare(b.date)),
          date,
        );
        expect(offline.bodyweightOn(days, date)).toEqual(count);
        for (const kg of [0, 2.5, 10.25]) {
          expect(offline.countedLoad(kg, count)).toBe(countedLoad(kg, count));
        }
      }
    }
  });
});

describe('withBodyweight', () => {
  const sets = [
    { weightKg: 0, reps: 8, isWarmup: false },
    { weightKg: 10, reps: 5, isWarmup: false },
    { weightKg: 0, reps: 12, isWarmup: true },
  ];

  it('counts all of the bodyweight, and the added load on top of it', () => {
    const count = bodyweightOn(weighed, '2026-09-10');
    // A logged 0 kg is bodyweight only; 10 kg is a belt or a vest.
    expect(withBodyweight(sets, count).map((set) => set.weightKg)).toEqual([82, 92, 82]);
    expect(withBodyweight(sets, count).map((set) => set.reps)).toEqual([8, 5, 12]);
  });

  it('keeps the logged figures when there is no weigh-in', () => {
    expect(withBodyweight(sets, bodyweightOn([], '2026-09-10'))).toEqual(sets);
  });

  it('keeps the hundredths of the weight and the load', () => {
    const count = bodyweightOn([day('2026-09-10', 81.35)], '2026-09-10');
    expect(withBodyweight([{ weightKg: 2.5, reps: 5, isWarmup: false }], count)[0]?.weightKg).toBe(
      83.85,
    );
  });
});

const workout = (date: string, ...sets: { weightKg: number; reps: number }[]): LoggedWorkout => ({
  workoutId: randomUUID(),
  name: 'Pull A',
  date,
  sets: sets.map((set) => ({ ...set, isWarmup: false })),
});

describe('exerciseProgress on a bodyweight lift', () => {
  it('counts the bodyweight and the added load in e1RM, top set, volume and sets', () => {
    const progress = exerciseProgress(
      '12w',
      '2026-09-30',
      [
        workout('2026-09-10', { weightKg: 0, reps: 8 }),
        workout('2026-09-20', { weightKg: 10, reps: 5 }, { weightKg: 0, reps: 9 }),
      ],
      weighed,
    );
    expect(progress.points[0]).toMatchObject({
      // 82 × (1 + 8/30)
      e1rmKg: 103.9,
      topSetKg: 82,
      topSetReps: 8,
      volumeKg: 656,
      sets: [{ weightKg: 82, reps: 8 }],
      bodyweight: { basis: 'same_day', weightKg: 82, weighedOn: '2026-09-10' },
    });
    expect(progress.points[1]).toMatchObject({
      // 91 × (1 + 5/30) beats 81 × (1 + 9/30) = 105.3
      e1rmKg: 106.2,
      topSetKg: 91,
      topSetReps: 5,
      bodyweight: { basis: 'same_day', weightKg: 81, weighedOn: '2026-09-20' },
    });
    expect(progress.stats.topSetKg).toBe(91);
  });

  it('plots a workout older than the first weigh-in at the first later one', () => {
    const progress = exerciseProgress(
      '12w',
      '2026-09-30',
      [workout('2026-08-25', { weightKg: 0, reps: 6 })],
      weighed,
    );
    expect(progress.points[0]).toMatchObject({
      e1rmKg: 96,
      bodyweight: { basis: 'later_day', weighedOn: '2026-09-01' },
    });
  });

  it('keeps the logged zero and says there was no weigh-in without any', () => {
    const progress = exerciseProgress(
      '12w',
      '2026-09-30',
      [workout('2026-09-10', { weightKg: 0, reps: 8 })],
      [],
    );
    expect(progress.points[0]).toMatchObject({
      e1rmKg: 0,
      topSetKg: 0,
      bodyweight: { basis: 'none' },
    });
  });

  it('leaves every other exercise as logged, with no bodyweight', () => {
    const progress = exerciseProgress('12w', '2026-09-30', [
      workout('2026-09-10', { weightKg: 60, reps: 5 }),
    ]);
    expect(progress.points[0]).toMatchObject({ topSetKg: 60, bodyweight: null });
  });
});

const pullUpLift = (...reps: number[]): LoggedLift => ({
  exerciseId: 'pull-up',
  name: 'Pull-Up',
  bodyweight: true,
  workouts: reps.map((rep, index) => ({
    date: `2026-09-${String(1 + index * 7).padStart(2, '0')}`,
    sets: [{ weightKg: 0, reps: rep, isWarmup: false }],
  })),
});

describe('strengthOverview on a bodyweight lift', () => {
  it('gives a lift logged at 0 kg its points and trend once there is a weigh-in', () => {
    const lift = strengthOverview('12w', '2026-09-30', [pullUpLift(8, 10, 12)], weighed).lifts[0];
    expect(lift).toMatchObject({
      status: 'gaining',
      workoutCount: 3,
      bodyweight: { basis: 'earlier_day', weightKg: 82, weighedOn: '2026-09-10' },
    });
    // 80 × (1 + 8/30), the first workout on the day of the first weigh-in.
    expect(lift?.points[0]).toEqual({ date: '2026-09-01', e1rmKg: 101.3 });
  });

  it('keeps `no_weight` for a bodyweight lift when there is no weigh-in', () => {
    const lift = strengthOverview('12w', '2026-09-30', [pullUpLift(8, 10, 12)], []).lifts[0];
    expect(lift).toMatchObject({
      status: 'no_weight',
      points: [],
      bodyweight: { basis: 'none' },
    });
  });

  it('counts a lift of any other equipment as logged', () => {
    const logged: LoggedLift = { ...pullUpLift(8, 10, 12), bodyweight: false };
    const lift = strengthOverview('12w', '2026-09-30', [logged], weighed).lifts[0];
    expect(lift).toMatchObject({ status: 'no_weight', bodyweight: null });
  });
});

const t = useTestApp();

async function member(email: string) {
  const { cookie, user } = await t.createSignedInUser(email);
  const send = sender(t, cookie);
  expect((await send('PATCH', '/api/me/profile', { timezone: 'Asia/Tokyo' })).status).toBe(200);
  return { cookie, user, send };
}

type Send = Awaited<ReturnType<typeof member>>['send'];

async function exerciseId(send: Send, name: string) {
  const res = await send('GET', '/api/exercises');
  const body: { items: { id: string; name: string }[] } = await res.json();
  const found = body.items.find((item) => item.name === name);
  if (found === undefined) throw new Error(`no exercise named ${name}`);
  return found.id;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);
const localDate = (instant: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(instant);

async function weigh(send: Send, instant: Date, weightKg: number) {
  const res = await send('POST', '/api/weigh-ins', {
    id: randomUUID(),
    measuredAt: instant.toISOString(),
    weightKg,
  });
  expect(res.status).toBe(201);
}

async function log(send: Send, exercise: string, startedAt: Date, sets: [number, number][]) {
  const stamp = startedAt.toISOString();
  const workoutId = randomUUID();
  const workoutExerciseId = randomUUID();
  const res = await send('POST', '/api/workouts/sync', {
    workouts: [
      {
        id: workoutId,
        routineId: null,
        name: 'Pull A',
        startedAt: stamp,
        endedAt: null,
        note: null,
        clientUpdatedAt: stamp,
      },
    ],
    workoutExercises: [
      {
        id: workoutExerciseId,
        workoutId,
        exerciseId: exercise,
        routineExerciseId: null,
        position: 0,
        targetSets: 3,
        repLow: 6,
        repHigh: 10,
        incrementKg: 2.5,
        clientUpdatedAt: stamp,
      },
    ],
    sets: sets.map(([weightKg, reps], position) => ({
      id: randomUUID(),
      workoutExerciseId,
      position,
      weightKg,
      reps,
      rir: null,
      rpe: null,
      isWarmup: false,
      performedAt: stamp,
      clientUpdatedAt: stamp,
    })),
  });
  expect(res.status).toBe(200);
  return workoutId;
}

type Bodyweight = { basis: string; weightKg?: number; weighedOn?: string } | null;
type Progress = {
  points: { e1rmKg: number; topSetKg: number; bodyweight: Bodyweight }[];
};
type Strength = {
  lifts: { exerciseId: string; status: string; bodyweight: Bodyweight }[];
};

const progressOf = async (send: Send, exercise: string) => {
  const res = await send('GET', `/api/exercises/${exercise}/progress?span=12w`);
  expect(res.status).toBe(200);
  const body: Progress = await res.json();
  return body;
};

const strengthOf = async (send: Send) => {
  const res = await send('GET', '/api/training/strength');
  expect(res.status).toBe(200);
  const body: Strength = await res.json();
  return body;
};

const lastTimeOf = async (send: Send, exercise: string, exclude?: string) => {
  const res = await send(
    'GET',
    exclude === undefined
      ? '/api/training/last-time'
      : `/api/training/last-time?exclude=${exclude}`,
  );
  expect(res.status).toBe(200);
  const body: {
    exercises: {
      exerciseId: string;
      workoutId: string;
      sets: { weightKg: number; countedWeightKg: number }[];
      bodyweight: Bodyweight;
    }[];
  } = await res.json();
  return body.exercises.find((each) => each.exerciseId === exercise);
};

describe('the routes that count bodyweight', () => {
  it('counts the weigh-in on the chart and on the Strength screen', async () => {
    const { send } = await member('lifter@example.test');
    const pullUp = await exerciseId(send, 'Pull-Up');
    await weigh(send, daysAgo(10), 80);
    await weigh(send, daysAgo(4), 82);
    await log(send, pullUp, daysAgo(10), [[0, 10]]);
    await log(send, pullUp, daysAgo(7), [[5, 8]]);
    await log(send, pullUp, daysAgo(1), [[0, 12]]);

    const chart = await progressOf(send, pullUp);
    expect(chart.points.map((point) => point.topSetKg)).toEqual([80, 85, 82]);
    expect(chart.points.map((point) => point.bodyweight?.basis)).toEqual([
      'same_day',
      'earlier_day',
      'earlier_day',
    ]);
    expect(chart.points[0]).toMatchObject({
      e1rmKg: 106.7,
      bodyweight: { weightKg: 80, weighedOn: localDate(daysAgo(10)) },
    });

    const lift = (await strengthOf(send)).lifts.find((each) => each.exerciseId === pullUp);
    expect(lift).toMatchObject({
      status: 'gaining',
      bodyweight: { basis: 'earlier_day', weightKg: 82, weighedOn: localDate(daysAgo(4)) },
    });
    expect(await lastTimeOf(send, pullUp)).toMatchObject({
      sets: [{ weightKg: 0, countedWeightKg: 82 }],
      bodyweight: { basis: 'earlier_day', weightKg: 82 },
    });
  });

  it('counts a workout before the first weigh-in at the first later one', async () => {
    const { send } = await member('early@example.test');
    const pullUp = await exerciseId(send, 'Pull-Up');
    await log(send, pullUp, daysAgo(10), [[0, 6]]);
    await weigh(send, daysAgo(2), 90);

    expect((await progressOf(send, pullUp)).points[0]?.bodyweight).toEqual({
      basis: 'later_day',
      weightKg: 90,
      weighedOn: localDate(daysAgo(2)),
    });
    expect(await lastTimeOf(send, pullUp)).toMatchObject({
      sets: [{ weightKg: 0, countedWeightKg: 90 }],
      bodyweight: { basis: 'later_day', weightKg: 90 },
    });
  });

  it('adds the logged load in Last time while keeping the suggestion on the logged load', async () => {
    const { send } = await member('loaded@example.test');
    const pullUp = await exerciseId(send, 'Pull-Up');
    await weigh(send, daysAgo(4), 82);
    await log(send, pullUp, daysAgo(3), [[10, 8]]);

    expect(await lastTimeOf(send, pullUp)).toMatchObject({
      sets: [{ weightKg: 10, countedWeightKg: 92 }],
      bodyweight: { basis: 'earlier_day', weightKg: 82 },
      suggestion: { weightKg: 10 },
    });
  });

  it('says there was no weigh-in, and counts the logged 0 kg, without one', async () => {
    const { send } = await member('unweighed@example.test');
    const pullUp = await exerciseId(send, 'Pull-Up');
    await log(send, pullUp, daysAgo(3), [[0, 8]]);

    expect((await progressOf(send, pullUp)).points[0]).toMatchObject({
      e1rmKg: 0,
      bodyweight: { basis: 'none' },
    });
    expect((await strengthOf(send)).lifts[0]).toMatchObject({ status: 'no_weight' });
    expect(await lastTimeOf(send, pullUp)).toMatchObject({
      sets: [{ weightKg: 0, countedWeightKg: 0 }],
      bodyweight: { basis: 'none' },
    });
  });

  it('counts a weigh-in typed mid-workout on last time from the workout before the open one', async () => {
    const { send } = await member('midworkout@example.test');
    const pullUp = await exerciseId(send, 'Pull-Up');
    const previous = await log(send, pullUp, daysAgo(3), [[0, 8]]);
    // Started with no weigh-in; one pull-up set synced before the weigh-in.
    const open = await log(send, pullUp, new Date(), [[0, 9]]);
    await weigh(send, new Date(), 82);

    expect(await lastTimeOf(send, pullUp)).toMatchObject({ workoutId: open });
    expect(await lastTimeOf(send, pullUp, open)).toMatchObject({
      workoutId: previous,
      sets: [{ weightKg: 0, countedWeightKg: 82 }],
      bodyweight: { basis: 'later_day', weightKg: 82 },
    });
  });

  it('leaves a lift of another equipment as logged', async () => {
    const { send } = await member('barbell@example.test');
    const bench = await exerciseId(send, 'Barbell Bench Press');
    await weigh(send, daysAgo(5), 80);
    await log(send, bench, daysAgo(3), [[60, 5]]);

    expect((await progressOf(send, bench)).points[0]).toMatchObject({
      topSetKg: 60,
      bodyweight: null,
    });
    expect((await strengthOf(send)).lifts[0]?.bodyweight).toBeNull();
    expect(await lastTimeOf(send, bench)).toMatchObject({
      sets: [{ weightKg: 60, countedWeightKg: 60 }],
      bodyweight: null,
    });
  });

  describe('across users (docs/08 §10)', () => {
    it('never counts another user’s weigh-ins', async () => {
      const a = await member('a@example.test');
      const b = await member('b@example.test');
      const pullUp = await exerciseId(a.send, 'Pull-Up');
      await weigh(a.send, daysAgo(5), 120);
      await log(a.send, pullUp, daysAgo(3), [[0, 8]]);
      await log(b.send, pullUp, daysAgo(3), [[0, 8]]);

      // B has no weigh-in of their own, so A's 120 kg counts for nothing of B's.
      expect((await progressOf(b.send, pullUp)).points[0]).toMatchObject({
        e1rmKg: 0,
        bodyweight: { basis: 'none' },
      });
      expect(await lastTimeOf(b.send, pullUp)).toMatchObject({
        sets: [{ weightKg: 0, countedWeightKg: 0 }],
        bodyweight: { basis: 'none' },
      });
      expect((await strengthOf(b.send)).lifts[0]).toMatchObject({
        status: 'no_weight',
        bodyweight: { basis: 'none' },
      });
      expect((await progressOf(a.send, pullUp)).points[0]).toMatchObject({
        topSetKg: 120,
        bodyweight: { basis: 'earlier_day', weightKg: 120 },
      });
    });

    it('counts each user at their own weight when both weigh in', async () => {
      const a = await member('heavy@example.test');
      const b = await member('light@example.test');
      const pullUp = await exerciseId(a.send, 'Pull-Up');
      await weigh(a.send, daysAgo(3), 100);
      await weigh(b.send, daysAgo(3), 60);
      await log(a.send, pullUp, daysAgo(3), [[0, 5]]);
      await log(b.send, pullUp, daysAgo(3), [[0, 5]]);

      expect((await progressOf(a.send, pullUp)).points[0]?.topSetKg).toBe(100);
      expect((await progressOf(b.send, pullUp)).points[0]?.topSetKg).toBe(60);
    });
  });
});
