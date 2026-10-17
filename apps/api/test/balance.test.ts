import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  MUSCLE_GROUPS,
  balanceWindow,
  muscleStatus,
  weeklySets,
  type LoggedExercise,
  type MuscleGroup,
} from '../src/domain/balance';
import { WEB_ORIGIN, useTestApp } from './harness';

// Muscle balance (docs/11 §2, issue #50): weekly working sets per muscle group with indirect work at
// half, the two views and the range's edges, then the route that reads them (docs/07 §3) with its
// cross-user cases (docs/08 §10).

const TODAY = '2026-10-10'; // A Saturday.

let next = 0;
/** One exercise in one workout: `working` working sets, and `warmups` warm-ups before them. */
function entry(
  date: string,
  name: string,
  muscleGroup: MuscleGroup | null,
  secondaryMuscleGroups: MuscleGroup[],
  working: number,
  warmups = 0,
): LoggedExercise {
  next += 1;
  return {
    date,
    exerciseId: `exercise-${name}`,
    name,
    muscleGroup,
    secondaryMuscleGroups,
    sets: [
      ...Array.from({ length: warmups }, () => ({ weightKg: 40, reps: 10, isWarmup: true })),
      ...Array.from({ length: working }, () => ({ weightKg: 80 + next, reps: 8, isWarmup: false })),
    ],
  };
}

const benchOn = (date: string, sets: number) =>
  entry(date, 'Barbell Bench Press', 'chest', ['shoulders', 'triceps'], sets);
const pressOn = (date: string, sets: number) =>
  entry(date, 'Seated Dumbbell Shoulder Press', 'shoulders', ['triceps'], sets);

const group = (balance: ReturnType<typeof weeklySets>, muscleGroup: MuscleGroup) => {
  const found = balance.groups.find((each) => each.muscleGroup === muscleGroup);
  if (found === undefined) throw new Error(`no ${muscleGroup}`);
  return found;
};

describe('weeklySets', () => {
  it('counts a set whole for the group it is filed under and half for each it also trains', () => {
    const balance = weeklySets('week', TODAY, [benchOn('2026-10-06', 4), pressOn('2026-10-08', 3)]);
    expect(group(balance, 'chest')).toMatchObject({ sets: 4, directSets: 4, status: 'low' });
    // 3 of its own and half of bench's 4.
    expect(group(balance, 'shoulders')).toMatchObject({ sets: 5, directSets: 3 });
    // Half of each: 2 + 1.5.
    expect(group(balance, 'triceps')).toMatchObject({ sets: 3.5, directSets: 0, status: 'low' });
  });

  it('does not read triceps as untrained after a week of bench and shoulder press', () => {
    const balance = weeklySets('week', TODAY, [
      benchOn('2026-10-05', 5),
      pressOn('2026-10-05', 4),
      benchOn('2026-10-08', 5),
      pressOn('2026-10-08', 4),
    ]);
    expect(group(balance, 'triceps').status).not.toBe('none');
    expect(group(balance, 'triceps').sets).toBe(9);
  });

  it('names where a group’s sets came from, halves apart, by when each first came up', () => {
    const balance = weeklySets('week', TODAY, [
      benchOn('2026-10-06', 4),
      pressOn('2026-10-06', 3),
      entry('2026-10-08', 'Cable Triceps Pushdown', 'triceps', [], 3),
      benchOn('2026-10-09', 2),
    ]);
    expect(group(balance, 'triceps').sources).toEqual([
      {
        exerciseId: 'exercise-Barbell Bench Press',
        name: 'Barbell Bench Press',
        indirect: true,
        sets: 3,
      },
      {
        exerciseId: 'exercise-Seated Dumbbell Shoulder Press',
        name: 'Seated Dumbbell Shoulder Press',
        indirect: true,
        sets: 1.5,
      },
      {
        exerciseId: 'exercise-Cable Triceps Pushdown',
        name: 'Cable Triceps Pushdown',
        indirect: false,
        sets: 3,
      },
    ]);
    expect(group(balance, 'chest').sources).toEqual([
      {
        exerciseId: 'exercise-Barbell Bench Press',
        name: 'Barbell Bench Press',
        indirect: false,
        sets: 6,
      },
    ]);
  });

  it('leaves warm-ups out, and an exercise of warm-ups alone with them', () => {
    const balance = weeklySets('week', TODAY, [
      entry('2026-10-06', 'Barbell Bench Press', 'chest', ['triceps'], 3, 2),
      entry('2026-10-07', 'Barbell Back Squat', 'quads', ['glutes'], 0, 3),
    ]);
    expect(group(balance, 'chest').sets).toBe(3);
    expect(group(balance, 'triceps').sets).toBe(1.5);
    expect(group(balance, 'quads')).toMatchObject({ sets: 0, status: 'none', sources: [] });
    expect(group(balance, 'glutes').sources).toEqual([]);
  });

  it('counts an unfiled exercise only where it says it trains', () => {
    const balance = weeklySets('week', TODAY, [
      entry('2026-10-06', 'Landmine Press', null, ['shoulders', 'triceps'], 4),
    ]);
    expect(group(balance, 'shoulders')).toMatchObject({ sets: 2, directSets: 0 });
    expect(balance.groups.filter((each) => each.sets > 0)).toHaveLength(2);
  });

  it('never counts a group twice for one set, or half where it counts whole', () => {
    const balance = weeklySets('week', TODAY, [
      entry('2026-10-06', 'Odd Press', 'chest', ['chest', 'triceps', 'triceps'], 4),
    ]);
    expect(group(balance, 'chest').sets).toBe(4);
    expect(group(balance, 'triceps').sets).toBe(2);
  });

  it('lists all eleven groups in order, trained or not', () => {
    const balance = weeklySets('4w', TODAY, []);
    expect(balance.groups.map((each) => each.muscleGroup)).toEqual([...MUSCLE_GROUPS]);
    expect(balance.groups.every((each) => each.status === 'none' && each.sets === 0)).toBe(true);
  });

  describe('the four-week average', () => {
    it('is the default’s 28 days to today, divided by four', () => {
      expect(balanceWindow('4w', TODAY)).toEqual({ from: '2026-09-13', weeks: 4 });
      const balance = weeklySets('4w', TODAY, [
        benchOn('2026-09-12', 10), // a day before the view
        benchOn('2026-09-13', 10),
        benchOn('2026-09-27', 10),
        benchOn('2026-10-10', 10),
        benchOn('2026-10-11', 10), // tomorrow
      ]);
      expect(balance).toMatchObject({ view: '4w', from: '2026-09-13', to: TODAY, weeks: 4 });
      expect(group(balance, 'chest')).toMatchObject({ sets: 7.5, status: 'low' });
      expect(group(balance, 'shoulders').sets).toBe(3.8);
    });

    it('rounds to the tenth, halves up, and judges the rounded figure', () => {
      // 49 half sets over four weeks is 6.125 a week.
      const odd = weeklySets('4w', TODAY, [
        entry('2026-10-01', 'Barbell Bench Press', 'chest', ['triceps'], 49),
      ]);
      expect(group(odd, 'triceps').sets).toBe(6.1);
      // One set over four weeks is a quarter, which rounds up.
      const quarter = weeklySets('4w', TODAY, [entry('2026-10-01', 'Crunch', 'core', [], 1)]);
      expect(group(quarter, 'core')).toMatchObject({ sets: 0.3, status: 'low' });
      // 39 sets is 9.75 a week, which prints and reads as 9.8: low. 40 is 10: in range.
      const under = weeklySets('4w', TODAY, [entry('2026-10-01', 'Crunch', 'core', [], 39)]);
      expect(group(under, 'core')).toMatchObject({ sets: 9.8, status: 'low' });
      const at = weeklySets('4w', TODAY, [entry('2026-10-01', 'Crunch', 'core', [], 40)]);
      expect(group(at, 'core')).toMatchObject({ sets: 10, status: 'in_range' });
    });
  });

  describe('this week', () => {
    it('runs from Monday to today and is not divided', () => {
      expect(balanceWindow('week', TODAY)).toEqual({ from: '2026-10-05', weeks: 1 });
      expect(balanceWindow('week', '2026-10-05')).toEqual({ from: '2026-10-05', weeks: 1 });
      expect(balanceWindow('week', '2026-10-11')).toEqual({ from: '2026-10-05', weeks: 1 });
      const balance = weeklySets('week', TODAY, [
        benchOn('2026-10-04', 6),
        benchOn('2026-10-05', 6),
      ]);
      expect(balance).toMatchObject({ view: 'week', from: '2026-10-05', weeks: 1 });
      expect(group(balance, 'chest').sets).toBe(6);
    });
  });

  describe('the 10 to 20 range', () => {
    it('reads 0 as not trained, under 10 as low, 10 and 20 as in range, over 20 as high', () => {
      expect(muscleStatus(0)).toBe('none');
      expect(muscleStatus(0.1)).toBe('low');
      expect(muscleStatus(9.9)).toBe('low');
      expect(muscleStatus(10)).toBe('in_range');
      expect(muscleStatus(20)).toBe('in_range');
      expect(muscleStatus(20.1)).toBe('high');
    });

    it('answers the range with the view', () => {
      expect(weeklySets('week', TODAY, []).range).toEqual({ low: 10, high: 20 });
    });
  });
});

const t = useTestApp();

function send(cookie: string, method: string, path: string, body?: unknown) {
  return t.app.request(path, {
    method,
    headers: { cookie, 'Content-Type': 'application/json', Origin: WEB_ORIGIN },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function exerciseId(cookie: string, name: string) {
  const res = await t.app.request('/api/exercises', { headers: { cookie } });
  const body: { items: { id: string; name: string }[] } = await res.json();
  const found = body.items.find((item) => item.name === name);
  if (found === undefined) throw new Error(`no exercise named ${name}`);
  return found.id;
}

/** One workout, started at `startedAt`, of each exercise given with its sets, through sync. */
async function log(
  cookie: string,
  startedAt: Date,
  exercises: { id: string; working: number; warmups?: number }[],
) {
  const stamp = startedAt.toISOString();
  const workoutId = randomUUID();
  const slots = exercises.map((exercise) => ({ ...exercise, slot: randomUUID() }));
  const res = await send(cookie, 'POST', '/api/workouts/sync', {
    workouts: [
      {
        id: workoutId,
        routineId: null,
        name: 'Push A',
        startedAt: stamp,
        endedAt: null,
        note: null,
        clientUpdatedAt: stamp,
      },
    ],
    workoutExercises: slots.map((each, position) => ({
      id: each.slot,
      workoutId,
      exerciseId: each.id,
      routineExerciseId: null,
      position,
      targetSets: 3,
      repLow: 6,
      repHigh: 10,
      incrementKg: 2.5,
      clientUpdatedAt: stamp,
    })),
    sets: slots.flatMap((each) =>
      [
        ...Array.from({ length: each.warmups ?? 0 }, () => true),
        ...Array.from({ length: each.working }, () => false),
      ].map((isWarmup, position) => ({
        id: randomUUID(),
        workoutExerciseId: each.slot,
        position,
        weightKg: 60,
        reps: 8,
        rir: null,
        rpe: null,
        isWarmup,
        performedAt: stamp,
        clientUpdatedAt: stamp,
      })),
    ),
  });
  expect(res.status).toBe(200);
  const body: { results: { status: string }[] } = await res.json();
  expect(body.results.every((result) => result.status === 'stored')).toBe(true);
}

async function setUpProfile(cookie: string, timezone = 'Asia/Tokyo') {
  const res = await send(cookie, 'PATCH', '/api/me/profile', { timezone });
  expect(res.status).toBe(200);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);
const localDate = (instant: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(instant);

type Body = ReturnType<typeof weeklySets>;

async function balanceOf(cookie: string, query = '') {
  const res = await t.app.request(`/api/training/balance${query}`, { headers: { cookie } });
  expect(res.status).toBe(200);
  const body: Body = await res.json();
  return body;
}

const setsOf = (body: Body) =>
  Object.fromEntries(
    body.groups.filter((each) => each.sets > 0).map((each) => [each.muscleGroup, each.sets]),
  );

describe('GET /api/training/balance', () => {
  it('answers 401 without a session', async () => {
    const res = await t.app.request('/api/training/balance');
    expect(res.status).toBe(401);
  });

  it('opens on the four-week average, with the seeded secondary groups at half', async () => {
    const { cookie, user } = await t.createSignedInUser('lifter@example.test');
    await setUpProfile(cookie);
    const bench = await exerciseId(cookie, 'Barbell Bench Press');
    const press = await exerciseId(cookie, 'Seated Dumbbell Shoulder Press');
    await log(cookie, daysAgo(20), [
      { id: bench, working: 4, warmups: 2 },
      { id: press, working: 4 },
    ]);
    await log(cookie, daysAgo(3), [
      { id: bench, working: 4 },
      { id: press, working: 4 },
    ]);
    await log(cookie, daysAgo(40), [{ id: bench, working: 8 }]);

    const res = await t.app.request('/api/training/balance', { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('Overload-User')).toBe(user.id);
    const body: Body = await res.json();
    const today = localDate(new Date(), 'Asia/Tokyo');
    expect(body).toMatchObject({ view: '4w', to: today, weeks: 4, range: { low: 10, high: 20 } });
    expect(body.groups).toHaveLength(11);
    // Bench 8 sets and press 8 over four weeks: chest 2; shoulders 2 + 1; triceps 1 + 1.
    expect(setsOf(body)).toEqual({ chest: 2, shoulders: 3, triceps: 2 });
    expect(body.groups.find((each) => each.muscleGroup === 'triceps')).toMatchObject({
      directSets: 0,
      status: 'low',
      sources: [
        { exerciseId: bench, name: 'Barbell Bench Press', indirect: true, sets: 1 },
        { exerciseId: press, name: 'Seated Dumbbell Shoulder Press', indirect: true, sets: 1 },
      ],
    });
    expect(body.groups.find((each) => each.muscleGroup === 'back')).toMatchObject({
      sets: 0,
      status: 'none',
      sources: [],
    });
  });

  it('reads this week from Monday, in the caller’s time zone, undivided', async () => {
    const { cookie } = await t.createSignedInUser('lifter@example.test');
    await setUpProfile(cookie, 'Pacific/Kiritimati');
    const squat = await exerciseId(cookie, 'Barbell Back Squat');
    await log(cookie, new Date(), [{ id: squat, working: 5 }]);
    await log(cookie, daysAgo(8), [{ id: squat, working: 5 }]);

    const week = await balanceOf(cookie, '?view=week');
    const today = localDate(new Date(), 'Pacific/Kiritimati');
    expect(week).toMatchObject({ view: 'week', to: today, weeks: 1 });
    expect(week.from).toBe(balanceWindow('week', today).from);
    expect(setsOf(week)).toEqual({ quads: 5, glutes: 2.5 });
  });

  it('counts a workout in progress, and a custom exercise by the groups it was given', async () => {
    const { cookie } = await t.createSignedInUser('lifter@example.test');
    await setUpProfile(cookie);
    const own = randomUUID();
    const created = await send(cookie, 'POST', '/api/exercises', {
      id: own,
      name: 'Landmine Press',
      equipment: 'barbell',
      muscleGroup: 'shoulders',
      secondaryMuscleGroups: ['chest', 'triceps'],
    });
    expect(created.status).toBe(201);
    await log(cookie, new Date(), [{ id: own, working: 4 }]);

    expect(setsOf(await balanceOf(cookie, '?view=week'))).toEqual({
      chest: 2,
      shoulders: 4,
      triceps: 2,
    });
  });

  it('refuses a view it does not know as a bad request', async () => {
    const { cookie } = await t.createSignedInUser('lifter@example.test');
    await setUpProfile(cookie);
    for (const view of ['avg', '12w', 'month']) {
      const res = await t.app.request(`/api/training/balance?view=${view}`, {
        headers: { cookie },
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'bad_request' });
    }
  });

  it('answers setup_incomplete until the profile gives a time zone', async () => {
    const { cookie } = await t.createSignedInUser('lifter@example.test');
    const res = await t.app.request('/api/training/balance', { headers: { cookie } });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'setup_incomplete', missing: ['profile'] });
  });

  describe('across users (docs/08 §10)', () => {
    it('never counts another user’s sets of a seeded exercise', async () => {
      const a = await t.createSignedInUser('a@example.test');
      const b = await t.createSignedInUser('b@example.test');
      await setUpProfile(a.cookie);
      await setUpProfile(b.cookie);
      const bench = await exerciseId(a.cookie, 'Barbell Bench Press');
      await log(a.cookie, daysAgo(2), [{ id: bench, working: 12 }]);
      await log(b.cookie, daysAgo(2), [{ id: bench, working: 4 }]);

      expect(setsOf(await balanceOf(b.cookie))).toEqual({ chest: 1, shoulders: 0.5, triceps: 0.5 });
      expect(setsOf(await balanceOf(a.cookie))).toEqual({ chest: 3, shoulders: 1.5, triceps: 1.5 });
    });

    it('never names another user’s custom exercise as a source', async () => {
      const a = await t.createSignedInUser('a@example.test');
      const b = await t.createSignedInUser('b@example.test');
      await setUpProfile(a.cookie);
      await setUpProfile(b.cookie);
      const own = randomUUID();
      const created = await send(a.cookie, 'POST', '/api/exercises', {
        id: own,
        name: 'Cable Y-Raise',
        equipment: 'cable',
        muscleGroup: 'shoulders',
        secondaryMuscleGroups: ['back'],
      });
      expect(created.status).toBe(201);
      await log(a.cookie, daysAgo(1), [{ id: own, working: 4 }]);

      const forB = await balanceOf(b.cookie);
      expect(forB.groups.flatMap((each) => each.sources)).toEqual([]);
      const forA = await balanceOf(a.cookie);
      expect(forA.groups.flatMap((each) => each.sources.map((source) => source.name))).toEqual([
        'Cable Y-Raise',
        'Cable Y-Raise',
      ]);
    });
  });
});
