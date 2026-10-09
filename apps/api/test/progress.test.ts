import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { exerciseProgress, spanStart, type LoggedWorkout } from '../src/domain/progress';
import { WEB_ORIGIN, useTestApp } from './harness';

// Slice 5 (docs/11 §2): Epley with warm-ups excluded, across spans. The pure functions first, then
// the route that reads them (docs/07 §3), with its cross-user cases (docs/08 §10).

const working = (weightKg: number, reps: number) => ({ weightKg, reps, isWarmup: false });
const warmup = (weightKg: number, reps: number) => ({ weightKg, reps, isWarmup: true });

const logged = (date: string, ...sets: LoggedWorkout['sets']): LoggedWorkout => ({
  workoutId: `workout-${date}`,
  date,
  sets,
});

describe('spanStart', () => {
  it('counts weeks back from today, today included', () => {
    expect(spanStart('4w', '2026-11-10')).toBe('2026-10-14');
    expect(spanStart('12w', '2026-11-10')).toBe('2026-08-19');
  });

  it('counts calendar months and years back, today included', () => {
    expect(spanStart('6m', '2026-11-10')).toBe('2026-05-11');
    expect(spanStart('1y', '2026-11-10')).toBe('2025-11-11');
  });

  it('stops at the end of a shorter month', () => {
    // Six months before 31 August is the end of February, not 3 March.
    expect(spanStart('6m', '2026-08-31')).toBe('2026-03-01');
    expect(spanStart('1y', '2028-02-29')).toBe('2027-03-01');
  });

  it('has no start for all', () => {
    expect(spanStart('all', '2026-11-10')).toBeUndefined();
  });
});

describe('exerciseProgress (S7)', () => {
  it('plots each workout’s e1RM from its best working set, by Epley', () => {
    const progress = exerciseProgress('12w', '2026-11-10', [
      logged('2026-11-04', working(80, 10), working(80, 8), working(82.5, 6)),
    ]);
    expect(progress.points).toEqual([
      {
        workoutId: 'workout-2026-11-04',
        date: '2026-11-04',
        // 80 × (1 + 10/30), which beats 82.5 × (1 + 6/30) = 99.
        e1rmKg: 106.7,
        topSetKg: 82.5,
        topSetReps: 6,
        volumeKg: 80 * 10 + 80 * 8 + 82.5 * 6,
      },
    ]);
  });

  it('leaves warm-ups out of every number (S6)', () => {
    const progress = exerciseProgress('12w', '2026-11-10', [
      logged('2026-11-04', warmup(100, 20), working(60, 5), warmup(120, 1)),
    ]);
    expect(progress.points).toEqual([
      expect.objectContaining({ e1rmKg: 70, topSetKg: 60, topSetReps: 5, volumeKg: 300 }),
    ]);
    expect(progress.stats).toEqual({
      bestE1rmKg: 70,
      changeKg: null,
      topSetKg: 60,
      topSetReps: 5,
      volumeKg: 300,
    });
  });

  it('has no point for a workout of warm-ups alone', () => {
    const progress = exerciseProgress('12w', '2026-11-10', [
      logged('2026-11-03', warmup(40, 10)),
      logged('2026-11-04', working(60, 5)),
    ]);
    expect(progress.points.map((point) => point.date)).toEqual(['2026-11-04']);
  });

  it('names the top set by its weight, with the most reps done at it', () => {
    const [point] = exerciseProgress('12w', '2026-11-10', [
      logged('2026-11-04', working(100, 3), working(100, 5), working(90, 12)),
    ]).points;
    expect(point).toMatchObject({ topSetKg: 100, topSetReps: 5 });
  });

  it('keeps the workouts inside the span, both ends included', () => {
    const workouts = [
      logged('2025-11-10', working(60, 10)),
      logged('2025-11-11', working(62.5, 10)),
      logged('2026-05-10', working(65, 10)),
      logged('2026-05-11', working(67.5, 10)),
      logged('2026-08-18', working(70, 10)),
      logged('2026-08-19', working(72.5, 10)),
      logged('2026-10-13', working(75, 10)),
      logged('2026-10-14', working(77.5, 10)),
      logged('2026-11-10', working(80, 10)),
      // Dated after today, by a device whose clock runs ahead: outside every span.
      logged('2026-11-11', working(200, 10)),
    ];
    const dates = (span: Parameters<typeof exerciseProgress>[0]) =>
      exerciseProgress(span, '2026-11-10', workouts).points.map((point) => point.date);

    expect(dates('4w')).toEqual(['2026-10-14', '2026-11-10']);
    expect(dates('12w')).toEqual(['2026-08-19', '2026-10-13', '2026-10-14', '2026-11-10']);
    expect(dates('6m')[0]).toBe('2026-05-11');
    expect(dates('6m')).toHaveLength(6);
    expect(dates('1y')[0]).toBe('2025-11-11');
    expect(dates('1y')).toHaveLength(8);
    expect(dates('all')).toHaveLength(9);
    expect(dates('all')[0]).toBe('2025-11-10');
  });

  it('answers the span’s dates: its start, or the first workout’s for all', () => {
    const workouts = [logged('2026-01-05', working(60, 10)), logged('2026-11-04', working(80, 10))];
    expect(exerciseProgress('12w', '2026-11-10', workouts)).toMatchObject({
      span: '12w',
      from: '2026-08-19',
      to: '2026-11-10',
    });
    expect(exerciseProgress('all', '2026-11-10', workouts)).toMatchObject({
      span: 'all',
      from: '2026-01-05',
      to: '2026-11-10',
    });
    expect(exerciseProgress('all', '2026-11-10', [])).toMatchObject({ from: null });
  });

  it('sums the span: the best e1RM, the heaviest top set and the volume load', () => {
    const progress = exerciseProgress('4w', '2026-11-10', [
      // Outside the span, so none of it counts.
      logged('2026-09-01', working(150, 10)),
      logged('2026-10-20', working(80, 10), working(80, 10), working(80, 10)),
      logged('2026-10-27', working(82.5, 8), working(82.5, 7)),
      logged('2026-11-03', working(82.5, 10), working(80, 10)),
    ]);
    expect(progress.stats).toEqual({
      bestE1rmKg: 110,
      changeKg: 3.333,
      topSetKg: 82.5,
      topSetReps: 10,
      volumeKg: 2400 + 82.5 * 15 + 825 + 800,
    });
  });

  it('measures the change from the span’s first workout to its last', () => {
    const workouts = [
      // Outside 4 weeks: the change is counted from the first workout inside.
      logged('2026-09-01', working(100, 10)),
      logged('2026-10-20', working(80, 10)),
      // The span’s best, which the change does not read.
      logged('2026-10-27', working(90, 10)),
      logged('2026-11-03', working(75, 8)),
    ];
    // 75 × (1 + 8/30) = 95, less 80 × (1 + 10/30) = 106.666…, before either is rounded.
    expect(exerciseProgress('4w', '2026-11-10', workouts).stats.changeKg).toBe(-11.667);
    // Less 100 × (1 + 10/30) = 133.333…
    expect(exerciseProgress('all', '2026-11-10', workouts).stats.changeKg).toBe(-38.333);
    expect(
      exerciseProgress('4w', '2026-11-10', [
        logged('2026-10-20', working(80, 10)),
        logged('2026-11-03', working(80, 10)),
      ]).stats.changeKg,
    ).toBe(0);
  });

  it('reads the change from working sets alone, past a workout of warm-ups', () => {
    const progress = exerciseProgress('4w', '2026-11-10', [
      logged('2026-10-20', warmup(200, 10)),
      logged('2026-10-27', warmup(200, 1), working(80, 10)),
      logged('2026-11-03', working(90, 10)),
    ]);
    // 90 × (1 + 10/30) = 120, less 106.666…
    expect(progress.stats.changeKg).toBe(13.333);
  });

  it('has no change with fewer than two workouts in the span', () => {
    const one = exerciseProgress('4w', '2026-11-10', [
      logged('2026-09-01', working(100, 10)),
      logged('2026-11-03', working(80, 10)),
    ]);
    expect(one.stats.changeKg).toBeNull();
  });

  it('has no best and no top set without a workout in the span', () => {
    expect(exerciseProgress('4w', '2026-11-10', [logged('2026-01-05', working(60, 10))])).toEqual({
      span: '4w',
      from: '2026-10-14',
      to: '2026-11-10',
      points: [],
      stats: {
        bestE1rmKg: null,
        changeKg: null,
        topSetKg: null,
        topSetReps: null,
        volumeKg: 0,
      },
    });
  });

  it('rounds e1RM to the tenth and volume to the hundredth', () => {
    const [point] = exerciseProgress('all', '2026-11-10', [
      logged('2026-11-04', working(61.25, 7), working(0.1, 3), working(0.2, 3)),
    ]).points;
    // 61.25 × (1 + 7/30) = 75.5416…
    expect(point).toMatchObject({ e1rmKg: 75.5, volumeKg: 429.65 });
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

type SetFigures = { weightKg: number; reps: number; isWarmup?: boolean };

/** One workout of one exercise, started at `startedAt`, through the sync batch. */
async function log(cookie: string, exercise: string, startedAt: Date, sets: SetFigures[]) {
  const stamp = startedAt.toISOString();
  const workoutId = randomUUID();
  const workoutExerciseId = randomUUID();
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
    sets: sets.map((figures, position) => ({
      id: randomUUID(),
      workoutExerciseId,
      position,
      rir: null,
      rpe: null,
      isWarmup: false,
      performedAt: stamp,
      clientUpdatedAt: stamp,
      ...figures,
    })),
  });
  expect(res.status).toBe(200);
  const body: { results: { status: string }[] } = await res.json();
  expect(body.results.every((result) => result.status === 'stored')).toBe(true);
  return workoutId;
}

async function setUpProfile(cookie: string, timezone = 'Asia/Tokyo') {
  const res = await send(cookie, 'PATCH', '/api/me/profile', { timezone });
  expect(res.status).toBe(200);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);
const localDate = (instant: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(instant);

type Progress = ReturnType<typeof exerciseProgress>;

async function progressOf(cookie: string, exercise: string, query = '') {
  const res = await t.app.request(`/api/exercises/${exercise}/progress${query}`, {
    headers: { cookie },
  });
  expect(res.status).toBe(200);
  const body: Progress = await res.json();
  return body;
}

describe('GET /api/exercises/{id}/progress (S7)', () => {
  it('answers 401 without a session', async () => {
    const res = await t.app.request(`/api/exercises/${randomUUID()}/progress`);
    expect(res.status).toBe(401);
  });

  it('answers the chart’s points oldest first, with the span’s stats', async () => {
    const { cookie, user } = await t.createSignedInUser('lifter@example.test');
    await setUpProfile(cookie);
    const bench = await exerciseId(cookie, 'Barbell Bench Press');
    const older = await log(cookie, bench, daysAgo(10), [
      { weightKg: 40, reps: 12, isWarmup: true },
      { weightKg: 80, reps: 10 },
      { weightKg: 80, reps: 9 },
    ]);
    const newer = await log(cookie, bench, daysAgo(3), [
      { weightKg: 140, reps: 1, isWarmup: true },
      { weightKg: 82.5, reps: 10 },
    ]);

    const res = await t.app.request(`/api/exercises/${bench}/progress?span=4w`, {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Overload-User')).toBe(user.id);
    const body: Progress = await res.json();
    expect(body).toEqual({
      span: '4w',
      from: localDate(daysAgo(27), 'Asia/Tokyo'),
      to: localDate(new Date(), 'Asia/Tokyo'),
      points: [
        {
          workoutId: older,
          date: localDate(daysAgo(10), 'Asia/Tokyo'),
          e1rmKg: 106.7,
          topSetKg: 80,
          topSetReps: 10,
          volumeKg: 1520,
        },
        {
          workoutId: newer,
          date: localDate(daysAgo(3), 'Asia/Tokyo'),
          e1rmKg: 110,
          topSetKg: 82.5,
          topSetReps: 10,
          volumeKg: 825,
        },
      ],
      stats: { bestE1rmKg: 110, changeKg: 3.333, topSetKg: 82.5, topSetReps: 10, volumeKg: 2345 },
    });
  });

  it('opens on 12 weeks, and each span keeps only its own workouts', async () => {
    const { cookie } = await t.createSignedInUser('lifter@example.test');
    await setUpProfile(cookie);
    const bench = await exerciseId(cookie, 'Barbell Bench Press');
    for (const days of [400, 200, 100, 50, 5]) {
      await log(cookie, bench, daysAgo(days), [{ weightKg: 60, reps: 8 }]);
    }

    expect((await progressOf(cookie, bench)).span).toBe('12w');
    const counts: Record<string, number> = {};
    for (const span of ['4w', '12w', '6m', '1y', 'all']) {
      counts[span] = (await progressOf(cookie, bench, `?span=${span}`)).points.length;
    }
    expect(counts).toEqual({ '4w': 1, '12w': 2, '6m': 3, '1y': 4, all: 5 });
  });

  it('reads one exercise only, and counts an exercise logged twice in a workout once', async () => {
    const { cookie } = await t.createSignedInUser('lifter@example.test');
    await setUpProfile(cookie);
    const bench = await exerciseId(cookie, 'Barbell Bench Press');
    const squat = await exerciseId(cookie, 'Barbell Back Squat');
    await log(cookie, squat, daysAgo(2), [{ weightKg: 140, reps: 5 }]);
    const stamp = daysAgo(1).toISOString();
    const workoutId = randomUUID();
    const slots = [randomUUID(), randomUUID()];
    const res = await send(cookie, 'POST', '/api/workouts/sync', {
      workouts: [
        {
          id: workoutId,
          routineId: null,
          name: 'Bench twice',
          startedAt: stamp,
          endedAt: null,
          note: null,
          clientUpdatedAt: stamp,
        },
      ],
      workoutExercises: slots.map((id, position) => ({
        id,
        workoutId,
        exerciseId: bench,
        routineExerciseId: null,
        position,
        targetSets: 1,
        repLow: 6,
        repHigh: 10,
        incrementKg: 2.5,
        clientUpdatedAt: stamp,
      })),
      sets: slots.map((workoutExerciseId, index) => ({
        id: randomUUID(),
        workoutExerciseId,
        position: 0,
        weightKg: 60 + index * 10,
        reps: 6,
        rir: null,
        rpe: null,
        isWarmup: false,
        performedAt: stamp,
        clientUpdatedAt: stamp,
      })),
    });
    expect(res.status).toBe(200);

    expect((await progressOf(cookie, bench)).points).toEqual([
      expect.objectContaining({ workoutId, e1rmKg: 84, topSetKg: 70, volumeKg: 780 }),
    ]);
  });

  it('dates a workout in the caller’s time zone', async () => {
    const { cookie } = await t.createSignedInUser('lifter@example.test');
    await setUpProfile(cookie, 'Pacific/Kiritimati');
    const bench = await exerciseId(cookie, 'Barbell Bench Press');
    const startedAt = daysAgo(2);
    await log(cookie, bench, startedAt, [{ weightKg: 60, reps: 8 }]);

    const progress = await progressOf(cookie, bench);
    expect(progress.to).toBe(localDate(new Date(), 'Pacific/Kiritimati'));
    expect(progress.points[0]?.date).toBe(localDate(startedAt, 'Pacific/Kiritimati'));
  });

  it('answers no points for an exercise never logged', async () => {
    const { cookie } = await t.createSignedInUser('lifter@example.test');
    await setUpProfile(cookie);
    const bench = await exerciseId(cookie, 'Barbell Bench Press');

    expect(await progressOf(cookie, bench, '?span=all')).toMatchObject({
      from: null,
      points: [],
      stats: {
        bestE1rmKg: null,
        changeKg: null,
        topSetKg: null,
        topSetReps: null,
        volumeKg: 0,
      },
    });
  });

  it('refuses a span it does not know as a bad request', async () => {
    const { cookie } = await t.createSignedInUser('lifter@example.test');
    await setUpProfile(cookie);
    const bench = await exerciseId(cookie, 'Barbell Bench Press');

    const res = await t.app.request(`/api/exercises/${bench}/progress?span=2w`, {
      headers: { cookie },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'bad_request' });
  });

  it('answers setup_incomplete until the profile gives a time zone', async () => {
    const { cookie } = await t.createSignedInUser('lifter@example.test');
    const bench = await exerciseId(cookie, 'Barbell Bench Press');

    const res = await t.app.request(`/api/exercises/${bench}/progress`, { headers: { cookie } });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'setup_incomplete', missing: ['profile'] });
  });

  it('answers 404 for an exercise that does not exist', async () => {
    const { cookie } = await t.createSignedInUser('lifter@example.test');
    await setUpProfile(cookie);

    const res = await t.app.request(`/api/exercises/${randomUUID()}/progress`, {
      headers: { cookie },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'not_found' });
  });

  describe('across users (docs/08 §10)', () => {
    it('never counts another user’s workouts of a seeded exercise', async () => {
      const a = await t.createSignedInUser('a@example.test');
      const b = await t.createSignedInUser('b@example.test');
      await setUpProfile(a.cookie);
      await setUpProfile(b.cookie);
      const bench = await exerciseId(a.cookie, 'Barbell Bench Press');
      await log(a.cookie, bench, daysAgo(3), [{ weightKg: 100, reps: 5 }]);
      await log(b.cookie, bench, daysAgo(2), [{ weightKg: 50, reps: 5 }]);

      const forB = await progressOf(b.cookie, bench, '?span=all');
      expect(forB.points).toHaveLength(1);
      expect(forB.stats).toMatchObject({ topSetKg: 50, volumeKg: 250 });
      const forA = await progressOf(a.cookie, bench, '?span=all');
      expect(forA.points).toHaveLength(1);
      expect(forA.stats).toMatchObject({ topSetKg: 100, volumeKg: 500 });
    });

    it('answers 404 for another user’s custom exercise, as if it did not exist', async () => {
      const a = await t.createSignedInUser('a@example.test');
      const b = await t.createSignedInUser('b@example.test');
      await setUpProfile(a.cookie);
      await setUpProfile(b.cookie);
      const own = randomUUID();
      const created = await send(a.cookie, 'POST', '/api/exercises', {
        id: own,
        name: 'Cable Y-Raise',
        equipment: 'cable',
        muscleGroup: null,
      });
      expect(created.status).toBe(201);
      await log(a.cookie, own, daysAgo(1), [{ weightKg: 10, reps: 12 }]);

      const res = await t.app.request(`/api/exercises/${own}/progress?span=all`, {
        headers: { cookie: b.cookie },
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ code: 'not_found' });
      expect((await progressOf(a.cookie, own, '?span=all')).points).toHaveLength(1);
    });
  });
});
