import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { WEB_ORIGIN, useTestApp } from './harness';

// History (docs/07 §3, Reading workouts): the list of finished workouts and one workout whole,
// each with its cross-user cases (docs/08 §10), and a past set corrected or deleted through the
// sync batch, read back from every place that depends on it.
const t = useTestApp();

function send(cookie: string, method: string, path: string, body?: unknown) {
  return t.app.request(path, {
    method,
    headers: { cookie, 'Content-Type': 'application/json', Origin: WEB_ORIGIN },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function sync(cookie: string, batch: Record<string, unknown[]>) {
  const res = await send(cookie, 'POST', '/api/workouts/sync', batch);
  expect(res.status).toBe(200);
  const body: { results: { id: string; status: string }[] } = await res.json();
  return body.results;
}

async function exerciseId(cookie: string, name: string) {
  const res = await t.app.request('/api/exercises', { headers: { cookie } });
  const body: { items: { id: string; name: string }[] } = await res.json();
  const found = body.items.find((item) => item.name === name);
  if (found === undefined) throw new Error(`no exercise named ${name}`);
  return found.id;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

type SetFigures = { weightKg: number; reps: number; rir?: number | null; isWarmup?: boolean };
type Logged = {
  workout: Record<string, unknown> & { id: string; startedAt: string; clientUpdatedAt: string };
  exercises: (Record<string, unknown> & { id: string })[];
  sets: (Record<string, unknown> & { id: string; clientUpdatedAt: string })[];
};

/**
 * One workout through the sync batch: `exercises` in order, each with its sets. It is finished 50
 * minutes after it started, unless left `open`.
 */
async function log(
  cookie: string,
  startedAt: Date,
  exercises: { exerciseId: string; sets: SetFigures[] }[],
  options: { name?: string; open?: boolean; routineId?: string } = {},
): Promise<Logged> {
  const stamp = startedAt.toISOString();
  const workoutId = randomUUID();
  const workout = {
    id: workoutId,
    routineId: options.routineId ?? null,
    name: options.name ?? 'Push A',
    startedAt: stamp,
    endedAt:
      options.open === true ? null : new Date(startedAt.getTime() + 50 * MINUTE_MS).toISOString(),
    note: null,
    clientUpdatedAt: stamp,
  };
  const exerciseRows = exercises.map((each, position) => ({
    id: randomUUID(),
    workoutId,
    exerciseId: each.exerciseId,
    routineExerciseId: null,
    position,
    targetSets: 3,
    repLow: 6,
    repHigh: 10,
    incrementKg: 2.5,
    clientUpdatedAt: stamp,
  }));
  const sets = exercises.flatMap((each, index) =>
    each.sets.map((figures, position) => ({
      id: randomUUID(),
      workoutExerciseId: exerciseRows[index]?.id,
      position,
      rir: null,
      rpe: null,
      isWarmup: false,
      performedAt: new Date(
        startedAt.getTime() + (index * 10 + position) * MINUTE_MS,
      ).toISOString(),
      clientUpdatedAt: stamp,
      ...figures,
    })),
  );
  const results = await sync(cookie, {
    workouts: [workout],
    workoutExercises: exerciseRows,
    sets,
  });
  expect(results.every((result) => result.status === 'stored')).toBe(true);
  return { workout, exercises: exerciseRows, sets };
}

type Summary = {
  id: string;
  name: string;
  routineId: string | null;
  startedAt: string;
  endedAt: string;
  workingSets: number;
  exercises: { name: string; topSetKg: number; topSetReps: number }[];
};
type List = { items: Summary[]; nextCursor: string | null; total: number };

async function listOf(cookie: string, query = '') {
  const res = await t.app.request(`/api/workouts${query}`, { headers: { cookie } });
  expect(res.status).toBe(200);
  const body: List = await res.json();
  return body;
}

/** The stamp of a change made after the row was stored. */
const later = (row: { clientUpdatedAt: string }) =>
  new Date(new Date(row.clientUpdatedAt).getTime() + MINUTE_MS).toISOString();

describe('GET /api/workouts', () => {
  it('answers 401 without a session', async () => {
    expect((await t.app.request('/api/workouts')).status).toBe(401);
  });

  it('lists finished workouts newest first, each with its working sets and its top sets', async () => {
    const { cookie, user } = await t.createSignedInUser('lifter@example.test');
    const bench = await exerciseId(cookie, 'Barbell Bench Press');
    const press = await exerciseId(cookie, 'Seated Dumbbell Shoulder Press');
    const raise = await exerciseId(cookie, '1 Arm Cable Lateral Raise');
    const older = await log(
      cookie,
      daysAgo(9),
      [{ exerciseId: bench, sets: [{ weightKg: 60, reps: 8 }] }],
      {
        name: 'Old Push',
      },
    );
    const newer = await log(cookie, daysAgo(2), [
      {
        exerciseId: bench,
        sets: [
          // Heavier than any working set: a warm-up is never the top set, nor counted (S6).
          { weightKg: 120, reps: 1, isWarmup: true },
          { weightKg: 80, reps: 8 },
          { weightKg: 80, reps: 10 },
          { weightKg: 77.5, reps: 12 },
        ],
      },
      { exerciseId: press, sets: [{ weightKg: 25, reps: 10 }] },
      // Warm-ups alone, and nothing at all: neither exercise has a top set to name.
      { exerciseId: raise, sets: [{ weightKg: 5, reps: 15, isWarmup: true }] },
      { exerciseId: raise, sets: [] },
    ]);
    // Still in progress: History holds finished workouts.
    await log(cookie, daysAgo(0), [{ exerciseId: bench, sets: [{ weightKg: 80, reps: 5 }] }], {
      open: true,
    });

    const res = await t.app.request('/api/workouts', { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('Overload-User')).toBe(user.id);
    const body: List = await res.json();
    expect(body).toEqual({
      items: [
        {
          id: newer.workout.id,
          name: 'Push A',
          routineId: null,
          startedAt: newer.workout.startedAt,
          endedAt: newer.workout.endedAt,
          workingSets: 4,
          exercises: [
            { name: 'Barbell Bench Press', topSetKg: 80, topSetReps: 10 },
            { name: 'Seated Dumbbell Shoulder Press', topSetKg: 25, topSetReps: 10 },
          ],
        },
        {
          id: older.workout.id,
          name: 'Old Push',
          routineId: null,
          startedAt: older.workout.startedAt,
          endedAt: older.workout.endedAt,
          workingSets: 1,
          exercises: [{ name: 'Barbell Bench Press', topSetKg: 60, topSetReps: 8 }],
        },
      ],
      nextCursor: null,
      total: 2,
    });
  });

  it('names the routine a workout was started from, and none once the routine is deleted', async () => {
    const { cookie } = await t.createSignedInUser('lifter@example.test');
    const bench = await exerciseId(cookie, 'Barbell Bench Press');
    const routineId = randomUUID();
    expect(
      (await send(cookie, 'POST', '/api/routines', { id: routineId, name: 'Push A' })).status,
    ).toBe(201);
    await log(cookie, daysAgo(2), [{ exerciseId: bench, sets: [{ weightKg: 60, reps: 8 }] }], {
      routineId,
    });
    await log(cookie, daysAgo(1), [{ exerciseId: bench, sets: [{ weightKg: 60, reps: 8 }] }]);

    expect((await listOf(cookie)).items.map((item) => item.routineId)).toEqual([null, routineId]);

    expect((await send(cookie, 'DELETE', `/api/routines/${routineId}`)).status).toBe(204);
    expect((await listOf(cookie)).items.map((item) => item.routineId)).toEqual([null, null]);
  });

  it('pages by cursor, with no workout shown twice and none missed', async () => {
    const { cookie } = await t.createSignedInUser('lifter@example.test');
    const bench = await exerciseId(cookie, 'Barbell Bench Press');
    const ids: string[] = [];
    for (const days of [5, 4, 3, 2, 1]) {
      const logged = await log(cookie, daysAgo(days), [
        { exerciseId: bench, sets: [{ weightKg: 60, reps: 8 }] },
      ]);
      ids.unshift(logged.workout.id);
    }

    const first = await listOf(cookie, '?limit=2');
    expect(first.items.map((item) => item.id)).toEqual(ids.slice(0, 2));
    expect(first.total).toBe(5);
    expect(first.nextCursor).not.toBeNull();

    // A workout finished while the user pages is newer than the cursor: it joins no later page.
    await log(cookie, daysAgo(0), [{ exerciseId: bench, sets: [{ weightKg: 60, reps: 8 }] }]);
    const second = await listOf(cookie, `?limit=2&cursor=${first.nextCursor}`);
    expect(second.items.map((item) => item.id)).toEqual(ids.slice(2, 4));
    const third = await listOf(cookie, `?limit=2&cursor=${second.nextCursor}`);
    expect(third.items.map((item) => item.id)).toEqual(ids.slice(4));
    expect(third.nextCursor).toBeNull();
  });

  it('orders workouts that started at the same instant by id, across a page boundary', async () => {
    const { cookie } = await t.createSignedInUser('lifter@example.test');
    const bench = await exerciseId(cookie, 'Barbell Bench Press');
    const startedAt = daysAgo(1);
    const ids: string[] = [];
    for (let count = 0; count < 3; count += 1) {
      const logged = await log(cookie, startedAt, [
        { exerciseId: bench, sets: [{ weightKg: 60, reps: 8 }] },
      ]);
      ids.push(logged.workout.id);
    }
    const expected = ids.toSorted().toReversed();

    const first = await listOf(cookie, '?limit=2');
    const second = await listOf(cookie, `?limit=2&cursor=${first.nextCursor}`);
    expect([...first.items, ...second.items].map((item) => item.id)).toEqual(expected);
  });

  it('refuses a limit outside 1 to 100 and a cursor it did not make, as 400', async () => {
    const { cookie } = await t.createSignedInUser('lifter@example.test');
    for (const query of ['?limit=0', '?limit=101', '?limit=two', '?cursor=not-a-cursor']) {
      const res = await t.app.request(`/api/workouts${query}`, { headers: { cookie } });
      expect(res.status).toBe(400);
      const problem: { code: string } = await res.json();
      expect(problem.code).toBe('bad_request');
    }
  });

  it('never lists another user’s workouts, nor counts them', async () => {
    const owner = await t.createSignedInUser('owner@example.test');
    const other = await t.createSignedInUser('other@example.test');
    const bench = await exerciseId(owner.cookie, 'Barbell Bench Press');
    await log(owner.cookie, daysAgo(1), [
      { exerciseId: bench, sets: [{ weightKg: 80, reps: 10 }] },
    ]);

    expect(await listOf(other.cookie)).toEqual({ items: [], nextCursor: null, total: 0 });
    expect((await listOf(owner.cookie)).total).toBe(1);
  });
});

describe('GET /api/workouts/{id}', () => {
  it('answers 401 without a session, and 400 for a malformed id', async () => {
    expect((await t.app.request(`/api/workouts/${randomUUID()}`)).status).toBe(401);
    const { cookie } = await t.createSignedInUser('lifter@example.test');
    expect((await t.app.request('/api/workouts/not-an-id', { headers: { cookie } })).status).toBe(
      400,
    );
  });

  it('answers the workout with its exercises and every set, as the sync batch holds them', async () => {
    const { cookie, user } = await t.createSignedInUser('lifter@example.test');
    const bench = await exerciseId(cookie, 'Barbell Bench Press');
    const press = await exerciseId(cookie, 'Seated Dumbbell Shoulder Press');
    const logged = await log(cookie, daysAgo(2), [
      {
        exerciseId: bench,
        sets: [
          { weightKg: 40, reps: 10, isWarmup: true },
          { weightKg: 80, reps: 10, rir: 1 },
        ],
      },
      { exerciseId: press, sets: [] },
    ]);

    const res = await t.app.request(`/api/workouts/${logged.workout.id}`, { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('Overload-User')).toBe(user.id);
    expect(await res.json()).toEqual({
      ...logged.workout,
      exercises: [
        { ...logged.exercises[0], name: 'Barbell Bench Press', sets: logged.sets },
        { ...logged.exercises[1], name: 'Seated Dumbbell Shoulder Press', sets: [] },
      ],
    });
  });

  it('answers a workout still in progress too', async () => {
    const { cookie } = await t.createSignedInUser('lifter@example.test');
    const bench = await exerciseId(cookie, 'Barbell Bench Press');
    const logged = await log(
      cookie,
      daysAgo(0),
      [{ exerciseId: bench, sets: [{ weightKg: 80, reps: 5 }] }],
      { open: true },
    );
    const res = await t.app.request(`/api/workouts/${logged.workout.id}`, { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: logged.workout.id, endedAt: null });
  });

  it('answers another user’s workout, and one that does not exist, as 404', async () => {
    const owner = await t.createSignedInUser('owner@example.test');
    const other = await t.createSignedInUser('other@example.test');
    const bench = await exerciseId(owner.cookie, 'Barbell Bench Press');
    const logged = await log(owner.cookie, daysAgo(1), [
      { exerciseId: bench, sets: [{ weightKg: 80, reps: 10 }] },
    ]);

    for (const id of [logged.workout.id, randomUUID()]) {
      const res = await t.app.request(`/api/workouts/${id}`, { headers: { cookie: other.cookie } });
      expect(res.status).toBe(404);
      const problem: { code: string } = await res.json();
      expect(problem.code).toBe('not_found');
    }
    const own = await t.app.request(`/api/workouts/${logged.workout.id}`, {
      headers: { cookie: owner.cookie },
    });
    expect(own.status).toBe(200);
  });
});

async function setUp() {
  const lifter = await t.createSignedInUser('lifter@example.test');
  const { cookie } = lifter;
  const profile = await send(cookie, 'PATCH', '/api/me/profile', { timezone: 'Asia/Tokyo' });
  expect(profile.status).toBe(200);
  const bench = await exerciseId(cookie, 'Barbell Bench Press');
  const logged = await log(cookie, daysAgo(2), [
    {
      exerciseId: bench,
      sets: [
        { weightKg: 80, reps: 10 },
        { weightKg: 80, reps: 9 },
      ],
    },
  ]);
  return { ...lifter, bench, logged };
}

describe('a past workout corrected through the sync batch', () => {
  type LastTimes = {
    exercises: {
      exerciseId: string;
      sets: { weightKg: number; reps: number }[];
      suggestion: { weightKg: number; rule: string };
    }[];
  };
  async function lastTimeOf(cookie: string, exercise: string) {
    const res = await t.app.request('/api/training/last-time', { headers: { cookie } });
    const body: LastTimes = await res.json();
    return body.exercises.find((each) => each.exerciseId === exercise);
  }

  type Progress = {
    points: { workoutId: string; e1rmKg: number; sets: { weightKg: number; reps: number }[] }[];
  };
  async function progressOf(cookie: string, exercise: string) {
    const res = await t.app.request(`/api/exercises/${exercise}/progress`, { headers: { cookie } });
    const body: Progress = await res.json();
    return body;
  }

  it('shows an edited set in the workout, last time, the suggestion and the chart', async () => {
    const { cookie, bench, logged } = await setUp();
    expect((await lastTimeOf(cookie, bench))?.suggestion).toMatchObject({
      weightKg: 80,
      rule: 'repeat',
    });
    const [first, second] = logged.sets;
    if (first === undefined || second === undefined) throw new Error('two sets were logged');

    // The second set reached 10 after all, and the first was heavier than typed.
    const results = await sync(cookie, {
      workouts: [],
      workoutExercises: [],
      sets: [
        { ...first, weightKg: 82.5, clientUpdatedAt: later(first) },
        { ...second, weightKg: 82.5, reps: 10, rir: 0, clientUpdatedAt: later(second) },
      ],
    });
    expect(results.map((result) => result.status)).toEqual(['stored', 'stored']);

    const detail = await t.app.request(`/api/workouts/${logged.workout.id}`, {
      headers: { cookie },
    });
    const body: { exercises: { sets: Record<string, unknown>[] }[] } = await detail.json();
    expect(body.exercises[0]?.sets).toEqual([
      expect.objectContaining({ id: first.id, weightKg: 82.5, reps: 10, rir: null }),
      expect.objectContaining({ id: second.id, weightKg: 82.5, reps: 10, rir: 0 }),
    ]);
    const last = await lastTimeOf(cookie, bench);
    expect(last?.sets).toEqual([
      expect.objectContaining({ weightKg: 82.5, reps: 10 }),
      expect.objectContaining({ weightKg: 82.5, reps: 10 }),
    ]);
    expect(last?.suggestion).toMatchObject({ weightKg: 85, rule: 'top_of_range_hit' });
    expect((await progressOf(cookie, bench)).points).toEqual([
      expect.objectContaining({ workoutId: logged.workout.id, e1rmKg: 110 }),
    ]);
    expect((await listOf(cookie)).items[0]?.exercises).toEqual([
      { name: 'Barbell Bench Press', topSetKg: 82.5, topSetReps: 10 },
    ]);
  });

  it('drops a deleted set from the workout, last time and the chart', async () => {
    const { cookie, bench, logged } = await setUp();
    const [first, second] = logged.sets;
    if (first === undefined || second === undefined) throw new Error('two sets were logged');

    const results = await sync(cookie, {
      workouts: [],
      workoutExercises: [],
      sets: [{ id: first.id, deletedAt: later(first) }],
    });
    expect(results.map((result) => result.status)).toEqual(['deleted']);

    const detail = await t.app.request(`/api/workouts/${logged.workout.id}`, {
      headers: { cookie },
    });
    const body: { exercises: { sets: { id: string }[] }[] } = await detail.json();
    expect(body.exercises[0]?.sets.map((set) => set.id)).toEqual([second.id]);
    expect((await lastTimeOf(cookie, bench))?.sets).toEqual([
      expect.objectContaining({ weightKg: 80, reps: 9 }),
    ]);
    // 80 × (1 + 9/30), now that the set of 10 is gone.
    expect((await progressOf(cookie, bench)).points).toEqual([
      expect.objectContaining({ e1rmKg: 104, sets: [{ weightKg: 80, reps: 9 }] }),
    ]);
    expect((await listOf(cookie)).items[0]).toMatchObject({ workingSets: 1 });
  });

  it('removes the workout from history, last time and the chart once it is deleted with its last set', async () => {
    const { cookie, bench, logged } = await setUp();
    const stamp = later(logged.workout);

    const results = await sync(cookie, {
      workouts: [{ id: logged.workout.id, deletedAt: stamp }],
      workoutExercises: [],
      sets: logged.sets.map((set) => ({ id: set.id, deletedAt: stamp })),
    });
    expect(results.map((result) => result.status)).toEqual(['deleted', 'deleted', 'deleted']);

    expect(await listOf(cookie)).toEqual({ items: [], nextCursor: null, total: 0 });
    const detail = await t.app.request(`/api/workouts/${logged.workout.id}`, {
      headers: { cookie },
    });
    expect(detail.status).toBe(404);
    expect(await lastTimeOf(cookie, bench)).toBeUndefined();
    expect((await progressOf(cookie, bench)).points).toEqual([]);
  });

  it('leaves another user’s past set as it was: an edit and a delete are both refused as not found', async () => {
    const { cookie, logged } = await setUp();
    const other = await t.createSignedInUser('other@example.test');
    const [first] = logged.sets;
    if (first === undefined) throw new Error('a set was logged');

    const edit = await sync(other.cookie, {
      workouts: [],
      workoutExercises: [],
      sets: [{ ...first, reps: 1, clientUpdatedAt: later(first) }],
    });
    // Its exercise row is not theirs to log under, which is all the server says of it.
    expect(edit[0]).toMatchObject({ status: 'refused', problem: { code: 'parent_missing' } });
    const removal = await sync(other.cookie, {
      workouts: [{ id: logged.workout.id, deletedAt: later(logged.workout) }],
      workoutExercises: [],
      sets: [{ id: first.id, deletedAt: later(first) }],
    });
    expect(removal.map((result) => result.status)).toEqual(['refused', 'refused']);

    const detail = await t.app.request(`/api/workouts/${logged.workout.id}`, {
      headers: { cookie },
    });
    expect(detail.status).toBe(200);
    const body: { exercises: { sets: Record<string, unknown>[] }[] } = await detail.json();
    expect(body.exercises[0]?.sets).toEqual(logged.sets);
  });
});
