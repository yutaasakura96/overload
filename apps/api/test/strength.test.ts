import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  statusOf,
  strengthOverview,
  strengthTrend,
  type LoggedLift,
  type TrendPoint,
} from '../src/domain/strength';
import { WEB_ORIGIN, useTestApp } from './harness';

// The strength overview (docs/11 §2, issue #49): the trend of a lift's e1RM with its threshold
// edges, then every lift together, then the route that reads them (docs/07 §3) with its cross-user
// cases (docs/08 §10).

/** Workouts a week apart from 1 September, one per e1RM given. */
const weekly = (...e1rmKg: number[]): TrendPoint[] =>
  e1rmKg.map((kg, index) => ({
    date: new Date(Date.UTC(2026, 8, 1 + index * 7)).toISOString().slice(0, 10),
    e1rmKg: kg,
  }));

describe('strengthTrend', () => {
  it('measures the line’s end against its start, in kilograms and percent', () => {
    expect(strengthTrend(weekly(100, 103, 106))).toEqual({
      changeKg: 6,
      changePct: 6,
      status: 'gaining',
    });
    expect(strengthTrend(weekly(200, 195, 190))).toEqual({
      changeKg: -10,
      changePct: -5,
      status: 'losing',
    });
  });

  it('fits a line through every workout, so one bad day does not flip a lift', () => {
    // Last against first would read −20%. The line runs 104 to 88.
    expect(strengthTrend(weekly(100, 100, 100, 100, 80))).toEqual({
      changeKg: -16,
      changePct: -15.4,
      status: 'losing',
    });
    // And a dip in the middle moves nothing.
    expect(strengthTrend(weekly(100, 80, 100))).toEqual({
      changeKg: 0,
      changePct: 0,
      status: 'holding',
    });
  });

  it('spaces the workouts by their dates, not by their order', () => {
    const points = [
      { date: '2026-09-01', e1rmKg: 100 },
      { date: '2026-09-02', e1rmKg: 100 },
      { date: '2026-09-29', e1rmKg: 110 },
    ];
    // By order the line would run 100 to 110, a 10% gain. The dates put the last workout 4 weeks
    // out, where the line reads less than the workout did.
    const trend = strengthTrend(points);
    expect(trend?.changePct).toBe(10.2);
    expect(trend?.changeKg).toBe(10.172);
  });

  describe('the ±2% threshold', () => {
    it('is gaining at +2% itself', () => {
      expect(strengthTrend(weekly(100, 101, 102))).toMatchObject({
        changePct: 2,
        status: 'gaining',
      });
    });

    it('is holding just under +2%', () => {
      expect(strengthTrend(weekly(100, 100.95, 101.9))).toMatchObject({
        changePct: 1.9,
        status: 'holding',
      });
    });

    it('is losing at −2% itself', () => {
      expect(strengthTrend(weekly(100, 99, 98))).toMatchObject({
        changePct: -2,
        status: 'losing',
      });
    });

    it('is holding just short of −2%', () => {
      expect(strengthTrend(weekly(100, 99.05, 98.1))).toMatchObject({
        changePct: -1.9,
        status: 'holding',
      });
    });

    it('is holding with no change at all', () => {
      expect(strengthTrend(weekly(100, 100, 100))).toMatchObject({
        changePct: 0,
        status: 'holding',
      });
    });

    it('judges the unrounded figure, even where the display rounds to the threshold', () => {
      expect(strengthTrend(weekly(100, 100.98, 101.96))).toMatchObject({
        changePct: 2,
        status: 'holding',
      });
      expect(strengthTrend(weekly(100, 100.97, 101.94))).toMatchObject({
        changePct: 1.9,
        status: 'holding',
      });
      expect(strengthTrend(weekly(100, 99.02, 98.04))).toMatchObject({
        changePct: -2,
        status: 'holding',
      });
      expect(strengthTrend(weekly(100, 99.03, 98.06))).toMatchObject({
        changePct: -1.9,
        status: 'holding',
      });
    });

    it('names each side of the threshold', () => {
      expect(statusOf(2)).toBe('gaining');
      expect(statusOf(1.9)).toBe('holding');
      expect(statusOf(-1.9)).toBe('holding');
      expect(statusOf(-2)).toBe('losing');
    });
  });

  describe('the three-workout minimum', () => {
    it('gives no trend to two workouts, or one, or none', () => {
      expect(strengthTrend(weekly(100, 110))).toBeUndefined();
      expect(strengthTrend(weekly(100))).toBeUndefined();
      expect(strengthTrend([])).toBeUndefined();
    });

    it('gives one to three', () => {
      expect(strengthTrend(weekly(100, 105, 110))).toBeDefined();
    });

    it('gives none to workouts that all fall on one day, which no line runs through', () => {
      const sameDay = [100, 105, 110].map((e1rmKg) => ({ date: '2026-09-01', e1rmKg }));
      expect(strengthTrend(sameDay)).toBeUndefined();
    });

    it('gives none where the line starts at or under zero, with no share to measure', () => {
      expect(strengthTrend(weekly(1, 1, 200))).toBeUndefined();
    });
  });
});

const working = (weightKg: number, reps: number) => ({ weightKg, reps, isWarmup: false });
const warmup = (weightKg: number, reps: number) => ({ weightKg, reps, isWarmup: true });

/** A lift logged a week apart from 1 September: one working set of 30 reps, so e1RM is 2 × weight. */
const lift = (name: string, ...e1rmKg: number[]): LoggedLift => ({
  exerciseId: `id-${name}`,
  name,
  workouts: weekly(...e1rmKg).map((point) => ({
    date: point.date,
    sets: [working(point.e1rmKg / 2, 30)],
  })),
});

describe('strengthOverview', () => {
  it('answers each lift’s points, trend and status', () => {
    const overview = strengthOverview('12w', '2026-09-20', [lift('Squat', 100, 103, 106)]);
    expect(overview.lifts).toEqual([
      {
        exerciseId: 'id-Squat',
        name: 'Squat',
        points: [
          { date: '2026-09-01', e1rmKg: 100 },
          { date: '2026-09-08', e1rmKg: 103 },
          { date: '2026-09-15', e1rmKg: 106 },
        ],
        workoutCount: 3,
        status: 'gaining',
        trend: { changeKg: 6, changePct: 6 },
      },
    ]);
  });

  it('reads e1RM from the best working set, by Epley, and rounds each point to the tenth', () => {
    const overview = strengthOverview('12w', '2026-09-20', [
      {
        exerciseId: 'bench',
        name: 'Bench',
        workouts: [
          // 80 × (1 + 10/30) = 106.67, which beats 82.5 × (1 + 6/30) = 99; the warm-up is left out.
          { date: '2026-09-01', sets: [warmup(150, 10), working(80, 10), working(82.5, 6)] },
        ],
      },
    ]);
    expect(overview.lifts[0]?.points).toEqual([{ date: '2026-09-01', e1rmKg: 106.7 }]);
  });

  it('says too few for a lift with fewer than three workouts in the span', () => {
    const overview = strengthOverview('12w', '2026-09-20', [lift('Curl', 30, 40)]);
    expect(overview.lifts[0]).toMatchObject({ status: 'too_few', trend: null });
    expect(overview.lifts[0]?.points).toHaveLength(2);
    expect(overview.overall).toEqual({ lifts: 0, changePct: null, status: null });
  });

  it('keeps the workouts inside the span, so a lift can read differently in each', () => {
    // Four weeks ending 29 September start on 2 September: the first workout is outside.
    const logged = [lift('Bench', 90, 100, 100, 100, 100)];
    expect(strengthOverview('4w', '2026-09-29', logged).lifts[0]).toMatchObject({
      status: 'holding',
      trend: { changePct: 0 },
    });
    expect(strengthOverview('12w', '2026-09-29', logged).lifts[0]).toMatchObject({
      status: 'gaining',
    });
    // A workout dated after today is outside every span.
    expect(strengthOverview('1y', '2026-09-08', logged).lifts[0]?.points).toHaveLength(2);
  });

  it('does not list a lift with no workout in the span', () => {
    const overview = strengthOverview('4w', '2026-12-01', [lift('Bench', 100, 102, 104)]);
    expect(overview.lifts).toEqual([]);
  });

  it('lists zero-weight working workouts without a trend and leaves out warm-ups alone', () => {
    const overview = strengthOverview('12w', '2026-09-30', [
      {
        exerciseId: 'pull-up',
        name: 'Pull-Up',
        workouts: [
          { date: '2026-09-01', sets: [working(0, 8)] },
          { date: '2026-09-08', sets: [working(0, 10)] },
          { date: '2026-09-15', sets: [working(0, 12)] },
        ],
      },
      {
        exerciseId: 'dip',
        name: 'Dip',
        workouts: [
          { date: '2026-09-01', sets: [warmup(20, 8)] },
          { date: '2026-09-08', sets: [working(0, 10)] },
          { date: '2026-09-15', sets: [working(10, 30)] },
        ],
      },
    ]);
    expect(overview.lifts).toEqual([
      {
        exerciseId: 'dip',
        name: 'Dip',
        points: [{ date: '2026-09-15', e1rmKg: 20 }],
        workoutCount: 2,
        status: 'too_few',
        trend: null,
      },
      {
        exerciseId: 'pull-up',
        name: 'Pull-Up',
        points: [],
        workoutCount: 3,
        status: 'no_weight',
        trend: null,
      },
    ]);
  });

  it('averages the lifts plainly, each counting once whatever it weighs', () => {
    const overview = strengthOverview('12w', '2026-09-20', [
      lift('Squat', 200, 206, 212), // +6%
      lift('Curl', 20, 20, 20), // 0%
      lift('Press', 50, 49.25, 48.5), // −3%
      lift('Row', 60, 70), // too few: not averaged
    ]);
    expect(overview.overall).toEqual({ lifts: 3, changePct: 1, status: 'holding' });
  });

  it('judges the average as it judges a lift', () => {
    const gaining = strengthOverview('12w', '2026-09-20', [
      lift('Squat', 100, 103, 106), // +6%
      lift('Press', 100, 99, 98), // −2%
    ]);
    expect(gaining.overall).toEqual({ lifts: 2, changePct: 2, status: 'gaining' });
    const losing = strengthOverview('12w', '2026-09-20', [
      lift('Squat', 100, 97, 94), // −6%
      lift('Press', 100, 101, 102), // +2%
    ]);
    expect(losing.overall).toEqual({ lifts: 2, changePct: -2, status: 'losing' });
  });

  it('averages exact lift changes and judges before display rounding', () => {
    const overview = strengthOverview('12w', '2026-09-20', [
      lift('Bench', 100, 100.98, 101.96),
      lift('Squat', 100, 101, 102),
      lift('Pull-Up', 0, 0, 0),
    ]);
    expect(overview.overall).toEqual({ lifts: 2, changePct: 2, status: 'holding' });
  });

  it('orders the lifts with a verdict by their change, then the rest by name', () => {
    const overview = strengthOverview('12w', '2026-09-20', [
      lift('Row', 60, 70),
      lift('Press', 50, 49.25, 48.5),
      lift('Curl', 20, 20, 20),
      lift('Squat', 200, 206, 212),
      lift('Bench', 100, 100, 100),
      lift('Dip', 30),
    ]);
    expect(overview.lifts.map((each) => each.name)).toEqual([
      'Squat',
      'Bench',
      'Curl',
      'Press',
      'Dip',
      'Row',
    ]);
  });

  it('answers the span’s start and end dates', () => {
    const logged = [lift('Squat', 100, 103, 106), lift('Curl', 20)];
    expect(strengthOverview('12w', '2026-11-10', logged)).toMatchObject({
      span: '12w',
      from: '2026-08-19',
      to: '2026-11-10',
    });
    expect(strengthOverview('1y', '2026-11-10', logged).from).toBe('2025-11-11');
    expect(strengthOverview('1y', '2026-11-10', []).from).toBe('2025-11-11');
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
}

async function setUpProfile(cookie: string, timezone = 'Asia/Tokyo') {
  const res = await send(cookie, 'PATCH', '/api/me/profile', { timezone });
  expect(res.status).toBe(200);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);
const localDate = (instant: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(instant);

type Overview = ReturnType<typeof strengthOverview>;

async function strengthOf(cookie: string, query = '') {
  const res = await t.app.request(`/api/training/strength${query}`, { headers: { cookie } });
  expect(res.status).toBe(200);
  const body: Overview = await res.json();
  return body;
}

describe('GET /api/training/strength', () => {
  it('answers 401 without a session', async () => {
    const res = await t.app.request('/api/training/strength');
    expect(res.status).toBe(401);
  });

  it('answers every lift with its points, trend and status, and their average', async () => {
    const { cookie, user } = await t.createSignedInUser('lifter@example.test');
    await setUpProfile(cookie);
    const bench = await exerciseId(cookie, 'Barbell Bench Press');
    const squat = await exerciseId(cookie, 'Barbell Back Squat');
    const curl = await exerciseId(cookie, 'Dumbbell Curl');
    // One set of 30 reps: e1RM is twice the weight.
    await log(cookie, bench, daysAgo(15), [
      { weightKg: 100, reps: 30, isWarmup: true },
      { weightKg: 50, reps: 30 },
    ]);
    await log(cookie, bench, daysAgo(8), [{ weightKg: 51.5, reps: 30 }]);
    await log(cookie, bench, daysAgo(1), [{ weightKg: 53, reps: 30 }]);
    await log(cookie, squat, daysAgo(15), [{ weightKg: 100, reps: 30 }]);
    await log(cookie, squat, daysAgo(8), [{ weightKg: 98, reps: 30 }]);
    await log(cookie, squat, daysAgo(1), [{ weightKg: 96, reps: 30 }]);
    await log(cookie, curl, daysAgo(2), [{ weightKg: 12, reps: 10 }]);

    const res = await t.app.request('/api/training/strength', { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('Overload-User')).toBe(user.id);
    const overview: Overview = await res.json();
    expect(overview.span).toBe('12w');
    expect(overview.to).toBe(localDate(new Date(), 'Asia/Tokyo'));
    expect(overview.lifts).toEqual([
      {
        exerciseId: bench,
        name: 'Barbell Bench Press',
        points: [
          { date: localDate(daysAgo(15), 'Asia/Tokyo'), e1rmKg: 100 },
          { date: localDate(daysAgo(8), 'Asia/Tokyo'), e1rmKg: 103 },
          { date: localDate(daysAgo(1), 'Asia/Tokyo'), e1rmKg: 106 },
        ],
        workoutCount: 3,
        status: 'gaining',
        trend: { changeKg: 6, changePct: 6 },
      },
      {
        exerciseId: squat,
        name: 'Barbell Back Squat',
        points: [
          { date: localDate(daysAgo(15), 'Asia/Tokyo'), e1rmKg: 200 },
          { date: localDate(daysAgo(8), 'Asia/Tokyo'), e1rmKg: 196 },
          { date: localDate(daysAgo(1), 'Asia/Tokyo'), e1rmKg: 192 },
        ],
        workoutCount: 3,
        status: 'losing',
        trend: { changeKg: -8, changePct: -4 },
      },
      {
        exerciseId: curl,
        name: 'Dumbbell Curl',
        points: [{ date: localDate(daysAgo(2), 'Asia/Tokyo'), e1rmKg: 16 }],
        workoutCount: 1,
        status: 'too_few',
        trend: null,
      },
    ]);
    expect(overview.overall).toEqual({ lifts: 2, changePct: 1, status: 'holding' });
  });

  it('lists zero-weight workouts and keeps them out of the average', async () => {
    const { cookie } = await t.createSignedInUser('bodyweight@example.test');
    await setUpProfile(cookie);
    const pullUp = await exerciseId(cookie, 'Pull-Up');
    for (const days of [15, 8, 1]) {
      await log(cookie, pullUp, daysAgo(days), [{ weightKg: 0, reps: 8 }]);
    }
    const overview = await strengthOf(cookie);
    expect(overview.lifts).toMatchObject([
      { exerciseId: pullUp, workoutCount: 3, points: [], status: 'no_weight', trend: null },
    ]);
    expect(overview.overall).toEqual({ lifts: 0, changePct: null, status: null });
  });

  it('opens on 12 weeks, and each span keeps only its own workouts', async () => {
    const { cookie } = await t.createSignedInUser('lifter@example.test');
    await setUpProfile(cookie);
    const bench = await exerciseId(cookie, 'Barbell Bench Press');
    for (const days of [300, 60, 40, 20, 10, 3]) {
      await log(cookie, bench, daysAgo(days), [{ weightKg: 80, reps: 8 }]);
    }

    const points = async (query: string) => (await strengthOf(cookie, query)).lifts[0]?.points;
    expect(await points('')).toHaveLength(5);
    expect(await points('?span=4w')).toHaveLength(3);
    expect(await points('?span=1y')).toHaveLength(6);
    expect((await strengthOf(cookie, '?span=4w')).lifts[0]?.status).toBe('holding');
  });

  it('counts an exercise logged in one workout once, and a workout in progress too', async () => {
    const { cookie } = await t.createSignedInUser('lifter@example.test');
    await setUpProfile(cookie);
    const bench = await exerciseId(cookie, 'Barbell Bench Press');
    const stamp = daysAgo(2).toISOString();
    const workoutId = randomUUID();
    const slots = [randomUUID(), randomUUID()];
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
      workoutExercises: slots.map((id, position) => ({
        id,
        workoutId,
        exerciseId: bench,
        routineExerciseId: null,
        position,
        targetSets: 3,
        repLow: 6,
        repHigh: 10,
        incrementKg: 2.5,
        clientUpdatedAt: stamp,
      })),
      sets: slots.map((workoutExerciseId, index) => ({
        id: randomUUID(),
        workoutExerciseId,
        position: 0,
        weightKg: 60 + index * 30,
        reps: 30,
        rir: null,
        rpe: null,
        isWarmup: false,
        performedAt: stamp,
        clientUpdatedAt: stamp,
      })),
    });
    expect(res.status).toBe(200);

    const overview = await strengthOf(cookie);
    expect(overview.lifts).toHaveLength(1);
    expect(overview.lifts[0]?.points).toEqual([
      { date: localDate(daysAgo(2), 'Asia/Tokyo'), e1rmKg: 180 },
    ]);
  });

  it('dates a workout in the caller’s time zone', async () => {
    const { cookie } = await t.createSignedInUser('lifter@example.test');
    await setUpProfile(cookie, 'Pacific/Kiritimati');
    const bench = await exerciseId(cookie, 'Barbell Bench Press');
    const startedAt = daysAgo(1);
    await log(cookie, bench, startedAt, [{ weightKg: 80, reps: 8 }]);

    const overview = await strengthOf(cookie);
    expect(overview.to).toBe(localDate(new Date(), 'Pacific/Kiritimati'));
    expect(overview.lifts[0]?.points[0]?.date).toBe(localDate(startedAt, 'Pacific/Kiritimati'));
  });

  it('answers no lifts and no average before anything is logged', async () => {
    const { cookie } = await t.createSignedInUser('lifter@example.test');
    await setUpProfile(cookie);
    const overview = await strengthOf(cookie);
    expect(overview).toMatchObject({
      span: '12w',
      overall: { lifts: 0, changePct: null, status: null },
      lifts: [],
    });
  });

  it('refuses a span it does not know as a bad request', async () => {
    const { cookie } = await t.createSignedInUser('lifter@example.test');
    await setUpProfile(cookie);
    for (const span of ['2w', '6m', 'all']) {
      const res = await t.app.request(`/api/training/strength?span=${span}`, {
        headers: { cookie },
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'bad_request' });
    }
  });

  it('answers setup_incomplete until the profile gives a time zone', async () => {
    const { cookie } = await t.createSignedInUser('lifter@example.test');
    const res = await t.app.request('/api/training/strength', { headers: { cookie } });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'setup_incomplete', missing: ['profile'] });
  });

  describe('across users (docs/08 §10)', () => {
    it('never counts another user’s workouts of a seeded exercise', async () => {
      const a = await t.createSignedInUser('a@example.test');
      const b = await t.createSignedInUser('b@example.test');
      await setUpProfile(a.cookie);
      await setUpProfile(b.cookie);
      const bench = await exerciseId(a.cookie, 'Barbell Bench Press');
      for (const [days, weightKg] of [
        [15, 50],
        [8, 55],
        [1, 60],
      ] as const) {
        await log(a.cookie, bench, daysAgo(days), [{ weightKg, reps: 30 }]);
      }
      await log(b.cookie, bench, daysAgo(2), [{ weightKg: 20, reps: 30 }]);

      const forB = await strengthOf(b.cookie);
      expect(forB.lifts).toHaveLength(1);
      expect(forB.lifts[0]).toMatchObject({ status: 'too_few', trend: null });
      expect(forB.lifts[0]?.points).toEqual([
        { date: localDate(daysAgo(2), 'Asia/Tokyo'), e1rmKg: 40 },
      ]);
      expect(forB.overall).toEqual({ lifts: 0, changePct: null, status: null });

      const forA = await strengthOf(a.cookie);
      expect(forA.lifts).toHaveLength(1);
      expect(forA.lifts[0]?.points.map((point) => point.e1rmKg)).toEqual([100, 110, 120]);
      expect(forA.overall).toMatchObject({ lifts: 1, status: 'gaining' });
    });

    it('never lists another user’s custom exercise', async () => {
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

      expect((await strengthOf(b.cookie)).lifts).toEqual([]);
      expect((await strengthOf(a.cookie)).lifts.map((each) => each.name)).toEqual([
        'Cable Y-Raise',
      ]);
    });
  });
});
