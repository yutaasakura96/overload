import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { set, workout, workoutExercise } from '../src/db/schema';
import { WEB_ORIGIN, useTestApp } from './harness';

// S1's happy path through the sync batch, and S2/S3 through last time (docs/07 §3, §3.4). Slice 3
// carries these, the cross-user refusals on the workout tree, and the server half of the 3-hour
// rule (docs/11 §2). Tombstones, two tabs and the refused set are slice 4's.
const t = useTestApp();

type Result = {
  table: string;
  id: string;
  status: string;
  row?: Record<string, unknown>;
  problem?: { code: string; status: number };
};

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
  const body: { results: Result[] } = await res.json();
  return body.results;
}

async function exerciseId(cookie: string, name: string) {
  const res = await t.app.request('/api/exercises', { headers: { cookie } });
  const body: { items: { id: string; name: string }[] } = await res.json();
  const found = body.items.find((item) => item.name === name);
  if (found === undefined) throw new Error(`no exercise named ${name}`);
  return found.id;
}

const at = (iso: string) => new Date(iso).toISOString();

function workoutRow(fields: Partial<Record<string, unknown>> = {}) {
  return {
    id: randomUUID(),
    routineId: null,
    name: 'Push A',
    startedAt: at('2026-11-11T09:01:40Z'),
    endedAt: null,
    note: null,
    clientUpdatedAt: at('2026-11-11T09:01:40Z'),
    ...fields,
  };
}

function exerciseRow(workoutId: string, exercise: string, fields: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    workoutId,
    exerciseId: exercise,
    routineExerciseId: null,
    position: 0,
    targetSets: 3,
    repLow: 6,
    repHigh: 10,
    incrementKg: 2.5,
    clientUpdatedAt: at('2026-11-11T09:01:40Z'),
    ...fields,
  };
}

function setRow(workoutExerciseId: string, position: number, fields: Record<string, unknown> = {}) {
  const performedAt = at(`2026-11-11T09:${String(10 + position).padStart(2, '0')}:00Z`);
  return {
    id: randomUUID(),
    workoutExerciseId,
    position,
    weightKg: 80,
    reps: 10,
    rir: 2,
    rpe: null,
    isWarmup: false,
    performedAt,
    clientUpdatedAt: performedAt,
    ...fields,
  };
}

/** One workout of bench: a warm-up, then working sets with the given reps at `kg`. */
async function logBench(
  cookie: string,
  options: { startedAt: string; kg: number; reps: number[]; repHigh?: number },
) {
  const bench = await exerciseId(cookie, 'Barbell Bench Press');
  const w = workoutRow({ startedAt: options.startedAt, clientUpdatedAt: options.startedAt });
  const we = exerciseRow(w.id, bench, { repHigh: options.repHigh ?? 10 });
  const sets = [
    setRow(we.id, 0, { weightKg: 40, reps: 12, isWarmup: true, rir: null }),
    ...options.reps.map((reps, i) => setRow(we.id, i + 1, { weightKg: options.kg, reps })),
  ];
  const results = await sync(cookie, { workouts: [w], workoutExercises: [we], sets });
  expect(results.every((r) => r.status === 'stored')).toBe(true);
  return { workout: w, workoutExercise: we, sets };
}

async function setUpProfile(cookie: string, timezone = 'Asia/Tokyo') {
  const res = await send(cookie, 'PATCH', '/api/me/profile', { timezone });
  expect(res.status).toBe(200);
}

describe('POST /api/workouts/sync (S1)', () => {
  it('stores a new workout, its exercise and its sets, answering one result per row', async () => {
    const { cookie, user } = await t.createSignedInUser('lifter@example.test');
    const bench = await exerciseId(cookie, 'Barbell Bench Press');
    const w = workoutRow();
    const we = exerciseRow(w.id, bench);
    const sets = [setRow(we.id, 0), setRow(we.id, 1, { weightKg: 82.5, rir: null, rpe: 8.5 })];

    const results = await sync(cookie, { workouts: [w], workoutExercises: [we], sets });

    expect(results.map((r) => [r.table, r.id, r.status])).toEqual([
      ['workouts', w.id, 'stored'],
      ['workoutExercises', we.id, 'stored'],
      ['sets', sets[0]?.id, 'stored'],
      ['sets', sets[1]?.id, 'stored'],
    ]);
    expect(results[3]?.row).toEqual(sets[1]);
    const [stored] = await t.db.select().from(workout).where(eq(workout.id, w.id));
    expect(stored?.userId).toBe(user.id);
    expect(await t.db.select().from(set).where(eq(set.workoutExerciseId, we.id))).toHaveLength(2);
  });

  it('stores a retried batch once and answers it unchanged', async () => {
    const { cookie } = await t.createSignedInUser('retry@example.test');
    const bench = await exerciseId(cookie, 'Barbell Bench Press');
    const w = workoutRow();
    const we = exerciseRow(w.id, bench);
    const batch = { workouts: [w], workoutExercises: [we], sets: [setRow(we.id, 0)] };
    await sync(cookie, batch);

    const again = await sync(cookie, batch);

    expect(again.map((r) => r.status)).toEqual(['unchanged', 'unchanged', 'unchanged']);
    expect(await t.db.select().from(set).where(eq(set.workoutExerciseId, we.id))).toHaveLength(1);
  });

  it('applies a newer edit and ignores a stale copy that arrives after it', async () => {
    const { cookie } = await t.createSignedInUser('edit@example.test');
    const bench = await exerciseId(cookie, 'Barbell Bench Press');
    const w = workoutRow();
    const we = exerciseRow(w.id, bench);
    const first = setRow(we.id, 0);
    await sync(cookie, { workouts: [w], workoutExercises: [we], sets: [first] });

    const edited = { ...first, reps: 9, clientUpdatedAt: at('2026-11-11T09:20:00Z') };
    expect((await sync(cookie, { sets: [edited] }))[0]?.status).toBe('stored');
    const [stale] = await sync(cookie, { sets: [first] });

    expect(stale?.status).toBe('unchanged');
    expect(stale?.row).toMatchObject({ reps: 9 });
  });

  it('writes ended_at when the phone finishes the workout', async () => {
    const { cookie } = await t.createSignedInUser('finish@example.test');
    const w = workoutRow();
    await sync(cookie, { workouts: [w] });

    const finished = {
      ...w,
      endedAt: at('2026-11-11T10:14:50Z'),
      clientUpdatedAt: at('2026-11-11T10:14:50Z'),
    };
    await sync(cookie, { workouts: [finished] });

    const [stored] = await t.db.select().from(workout).where(eq(workout.id, w.id));
    expect(stored?.endedAt?.toISOString()).toBe(finished.endedAt);
  });

  it('takes a workout exercise row made before the routine slot id existed, as from no slot', async () => {
    const { cookie } = await t.createSignedInUser('old-device@example.test');
    const bench = await exerciseId(cookie, 'Barbell Bench Press');
    const w = workoutRow();
    const { routineExerciseId: _slot, ...old } = exerciseRow(w.id, bench);

    const results = await sync(cookie, { workouts: [w], workoutExercises: [old] });

    expect(results[1]).toMatchObject({ status: 'stored', row: { routineExerciseId: null } });
    const [row] = await t.db.select().from(workoutExercise).where(eq(workoutExercise.id, old.id));
    expect(row?.routineExerciseId).toBeNull();
  });

  it('finishes a workout whose routine was deleted after it started, keeping it without the routine', async () => {
    const { cookie } = await t.createSignedInUser('routine-gone@example.test');
    const routineId = randomUUID();
    await send(cookie, 'POST', '/api/routines', { id: routineId, name: 'Push A' });
    const w = workoutRow({ routineId });
    expect((await sync(cookie, { workouts: [w] }))[0]?.row).toMatchObject({ routineId });
    expect((await send(cookie, 'DELETE', `/api/routines/${routineId}`)).status).toBe(204);

    const finished = {
      ...w,
      endedAt: at('2026-11-11T10:14:50Z'),
      clientUpdatedAt: at('2026-11-11T10:14:50Z'),
    };
    const [result] = await sync(cookie, { workouts: [finished] });

    expect(result).toMatchObject({ status: 'stored', row: { routineId: null } });
    const [stored] = await t.db.select().from(workout).where(eq(workout.id, w.id));
    expect(stored?.endedAt?.toISOString()).toBe(finished.endedAt);
    expect(stored?.routineId).toBeNull();
  });

  it('refuses a deletion of an exercise row or a set: only a workout is deleted', async () => {
    const { cookie } = await t.createSignedInUser('child-delete@example.test');
    const { workoutExercise: we, sets } = await logBench(cookie, {
      startedAt: at('2026-11-11T09:00:00Z'),
      kg: 80,
      reps: [10],
    });
    const deletedAt = at('2026-11-11T11:00:00Z');

    for (const batch of [
      { workoutExercises: [{ id: we.id, deletedAt }] },
      { sets: [{ id: sets[1]?.id, deletedAt }] },
    ]) {
      expect((await send(cookie, 'POST', '/api/workouts/sync', batch)).status).toBe(422);
    }

    expect(await t.db.select().from(set).where(eq(set.workoutExerciseId, we.id))).toHaveLength(2);
  });

  it('derives nothing from an idle workout: until the phone writes it, endedAt stays null', async () => {
    const { cookie } = await t.createSignedInUser('idle@example.test');
    const { workout: w } = await logBench(cookie, {
      startedAt: at('2020-01-01T09:00:00Z'),
      kg: 80,
      reps: [10],
    });
    const [again] = await sync(cookie, { workouts: [w] });
    expect(again?.row).toMatchObject({ endedAt: null });
  });

  it('deletes a workout and what it holds, and answers a repeat as deleted', async () => {
    const { cookie } = await t.createSignedInUser('delete@example.test');
    const { workout: w, workoutExercise: we } = await logBench(cookie, {
      startedAt: at('2026-11-11T09:00:00Z'),
      kg: 80,
      reps: [10],
    });
    const deletion = { id: w.id, deletedAt: at('2026-11-11T11:00:00Z') };

    expect((await sync(cookie, { workouts: [deletion] }))[0]?.status).toBe('deleted');
    expect((await sync(cookie, { workouts: [deletion] }))[0]?.status).toBe('deleted');
    expect(
      await t.db.select().from(workoutExercise).where(eq(workoutExercise.id, we.id)),
    ).toHaveLength(0);
  });

  it('keeps a row edited after the deletion was made', async () => {
    const { cookie } = await t.createSignedInUser('late-delete@example.test');
    const w = workoutRow({ clientUpdatedAt: at('2026-11-11T12:00:00Z') });
    await sync(cookie, { workouts: [w] });

    const [result] = await sync(cookie, {
      workouts: [{ id: w.id, deletedAt: at('2026-11-11T11:00:00Z') }],
    });

    expect(result?.status).toBe('unchanged');
  });

  it('answers a child of a row deleted in the same batch as deleted', async () => {
    const { cookie } = await t.createSignedInUser('cascade@example.test');
    const bench = await exerciseId(cookie, 'Barbell Bench Press');
    const w = workoutRow();
    await sync(cookie, { workouts: [w] });
    const we = exerciseRow(w.id, bench);

    const results = await sync(cookie, {
      workouts: [{ id: w.id, deletedAt: at('2026-11-11T11:00:00Z') }],
      workoutExercises: [we],
    });

    expect(results.map((r) => r.status)).toEqual(['deleted', 'deleted']);
  });

  it('refuses a child whose parent was refused, and still applies the rest', async () => {
    const { cookie } = await t.createSignedInUser('parent@example.test');
    const bench = await exerciseId(cookie, 'Barbell Bench Press');
    const w = workoutRow();
    const orphan = exerciseRow(randomUUID(), bench);
    const we = exerciseRow(w.id, bench);

    const results = await sync(cookie, {
      workouts: [w],
      workoutExercises: [orphan, we],
      sets: [setRow(orphan.id, 0), setRow(we.id, 0)],
    });

    expect(results.map((r) => [r.status, r.problem?.code])).toEqual([
      ['stored', undefined],
      ['refused', 'parent_missing'],
      ['stored', undefined],
      ['refused', 'parent_missing'],
      ['stored', undefined],
    ]);
  });

  it('refuses the whole batch over 500 rows as 413, applying nothing', async () => {
    const { cookie } = await t.createSignedInUser('big@example.test');
    const workouts = Array.from({ length: 501 }, () => workoutRow());
    const res = await send(cookie, 'POST', '/api/workouts/sync', { workouts });
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe('payload_too_large');
  });

  it('refuses a batch that does not match the schema as 422', async () => {
    const { cookie } = await t.createSignedInUser('bad@example.test');
    const w = workoutRow();
    const res = await send(cookie, 'POST', '/api/workouts/sync', {
      sets: [setRow(randomUUID(), 0, { reps: 0 })],
      workouts: [w],
    });
    expect(res.status).toBe(422);
    expect(await t.db.select().from(workout).where(eq(workout.id, w.id))).toHaveLength(0);
  });

  it('applies nothing without a session', async () => {
    const res = await t.app.request('/api/workouts/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: WEB_ORIGIN },
      body: JSON.stringify({ workouts: [workoutRow()] }),
    });
    expect(res.status).toBe(401);
  });
});

describe('the workout tree across users (docs/08 §4, §10)', () => {
  it('refuses another user’s workout, exercise row and set ids as not found, leaving them as they were', async () => {
    const a = await t.createSignedInUser('a@example.test');
    const b = await t.createSignedInUser('b@example.test');
    const {
      workout: w,
      workoutExercise: we,
      sets,
    } = await logBench(a.cookie, {
      startedAt: at('2026-11-11T09:00:00Z'),
      kg: 80,
      reps: [10],
    });
    const later = at('2026-11-12T09:00:00Z');
    const ownWorkout = workoutRow();
    const ownExercise = exerciseRow(ownWorkout.id, we.exerciseId);
    await sync(b.cookie, { workouts: [ownWorkout], workoutExercises: [ownExercise] });

    const overwrite = await sync(b.cookie, {
      workouts: [{ ...w, name: 'Taken', clientUpdatedAt: later }],
      workoutExercises: [{ ...we, workoutId: ownWorkout.id, clientUpdatedAt: later }],
      sets: [{ ...sets[1], workoutExerciseId: ownExercise.id, reps: 1, clientUpdatedAt: later }],
    });
    const deletes = await sync(b.cookie, { workouts: [{ id: w.id, deletedAt: later }] });

    for (const result of [...overwrite, ...deletes]) {
      expect(result).toMatchObject({ status: 'refused', problem: { code: 'not_found' } });
    }
    const [stored] = await t.db.select().from(workout).where(eq(workout.id, w.id));
    expect(stored?.name).toBe('Push A');
    expect(await t.db.select().from(set).where(eq(set.workoutExerciseId, we.id))).toHaveLength(2);
  });

  it('refuses rows that refer to another user’s workout, exercise row or custom exercise as parent_missing, and stores a workout naming their routine without it', async () => {
    const a = await t.createSignedInUser('owner@example.test');
    const b = await t.createSignedInUser('intruder@example.test');
    const { workout: w, workoutExercise: we } = await logBench(a.cookie, {
      startedAt: at('2026-11-11T09:00:00Z'),
      kg: 80,
      reps: [10],
    });
    const routineId = randomUUID();
    await send(a.cookie, 'POST', '/api/routines', { id: routineId, name: 'Mine' });
    const customId = randomUUID();
    await send(a.cookie, 'POST', '/api/exercises', {
      id: customId,
      name: 'Cable Y-Raise',
      equipment: 'cable',
    });
    const own = workoutRow();

    const results = await sync(b.cookie, {
      workouts: [workoutRow({ routineId }), own],
      workoutExercises: [exerciseRow(w.id, we.exerciseId), exerciseRow(own.id, customId)],
      sets: [setRow(we.id, 5)],
    });

    expect(results[0]?.row).toMatchObject({ routineId: null });
    expect(results.map((r) => [r.status, r.problem?.code])).toEqual([
      ['stored', undefined],
      ['stored', undefined],
      ['refused', 'parent_missing'],
      ['refused', 'parent_missing'],
      ['refused', 'parent_missing'],
    ]);
  });
});

describe('GET /api/training/last-time (S2, S3)', () => {
  it('asks for the profile first: 422 setup_incomplete, since local dates need its time zone', async () => {
    const { cookie } = await t.createSignedInUser('new@example.test');
    const res = await t.app.request('/api/training/last-time', { headers: { cookie } });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'setup_incomplete', missing: ['profile'] });
  });

  it('answers the latest workout’s working sets, numbered without the warm-ups, and the suggestion', async () => {
    const { cookie } = await t.createSignedInUser('history@example.test');
    await setUpProfile(cookie);
    await logBench(cookie, { startedAt: at('2026-11-01T09:00:00Z'), kg: 75, reps: [8, 8] });
    // 16:30 UTC is already the 5th in Tokyo: the day boundary is the profile's time zone.
    const latest = await logBench(cookie, {
      startedAt: at('2026-11-04T16:30:00Z'),
      kg: 80,
      reps: [10, 10, 10],
    });

    const res = await t.app.request('/api/training/last-time', { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.exercises).toEqual([
      {
        exerciseId: latest.workoutExercise.exerciseId,
        workoutId: latest.workout.id,
        performedOn: '2026-11-05',
        sets: [
          { workingSet: 1, weightKg: 80, reps: 10 },
          { workingSet: 2, weightKg: 80, reps: 10 },
          { workingSet: 3, weightKg: 80, reps: 10 },
        ],
        suggestion: {
          weightKg: 82.5,
          rule: 'top_of_range_hit',
          reason: 'hit 10 on every set last time',
        },
        slots: [],
      },
    ]);
  });

  it('answers each routine slot from its own sets and rep range, through a reorder, until the slot is gone', async () => {
    const { cookie } = await t.createSignedInUser('slots@example.test');
    const other = await t.createSignedInUser('slots-other@example.test');
    await setUpProfile(cookie, 'UTC');
    await setUpProfile(other.cookie, 'UTC');
    const bench = await exerciseId(cookie, 'Barbell Bench Press');
    const routineId = randomUUID();
    const heavySlot = { id: randomUUID(), exerciseId: bench, repLow: 5, repHigh: 8 };
    const lightSlot = { id: randomUUID(), exerciseId: bench, repLow: 8, repHigh: 12 };
    const created = await send(cookie, 'POST', '/api/routines', {
      id: routineId,
      name: 'Push A',
      exercises: [heavySlot, lightSlot],
    });
    expect(created.status).toBe(201);

    const startedAt = at('2026-11-04T09:00:00Z');
    const w = workoutRow({ routineId, startedAt, clientUpdatedAt: startedAt });
    const heavy = exerciseRow(w.id, bench, {
      routineExerciseId: heavySlot.id,
      position: 0,
      repLow: 5,
      repHigh: 8,
    });
    const light = exerciseRow(w.id, bench, {
      routineExerciseId: lightSlot.id,
      position: 1,
      repLow: 8,
      repHigh: 12,
    });
    const results = await sync(cookie, {
      workouts: [w],
      workoutExercises: [heavy, light],
      sets: [
        setRow(heavy.id, 0, { weightKg: 80, reps: 8 }),
        setRow(heavy.id, 1, { weightKg: 80, reps: 8 }),
        setRow(light.id, 0, { weightKg: 60, reps: 10 }),
      ],
    });
    expect(results.every((r) => r.status === 'stored')).toBe(true);
    expect(results[1]?.row).toMatchObject({ routineExerciseId: heavySlot.id });

    type Slot = { routineExerciseId: string };
    const last = async (as = cookie) => {
      const res = await t.app.request('/api/training/last-time', { headers: { cookie: as } });
      const body: { exercises: { workoutId: string; slots: Slot[] }[] } = await res.json();
      return body.exercises;
    };
    const bySlot = async () =>
      (await last())[0]?.slots.toSorted((a, b) =>
        a.routineExerciseId === heavySlot.id ? -1 : b.routineExerciseId === heavySlot.id ? 1 : 0,
      );

    // The second slot stopped short of 12, so it repeats its weight although the first reached 8.
    const heavyLast = {
      routineExerciseId: heavySlot.id,
      workoutId: w.id,
      performedOn: '2026-11-04',
      sets: [
        { workingSet: 1, weightKg: 80, reps: 8 },
        { workingSet: 2, weightKg: 80, reps: 8 },
      ],
      suggestion: {
        weightKg: 82.5,
        rule: 'top_of_range_hit',
        reason: 'hit 8 on every set last time',
      },
    };
    const lightLast = {
      routineExerciseId: lightSlot.id,
      workoutId: w.id,
      performedOn: '2026-11-04',
      sets: [{ workingSet: 1, weightKg: 60, reps: 10 }],
      suggestion: {
        weightKg: 60,
        rule: 'repeat',
        reason: 'set 1 stopped at 10 of 12 last time',
      },
    };
    expect(await bySlot()).toEqual([heavyLast, lightLast]);

    // Moved above the other, each slot keeps its own history.
    const reordered = await send(cookie, 'PUT', `/api/routines/${routineId}/exercises`, {
      exercises: [lightSlot, heavySlot],
    });
    expect(reordered.status).toBe(200);
    expect(await bySlot()).toEqual([heavyLast, lightLast]);

    // A later workout outside the routine is the exercise's last time; the slots keep theirs.
    const later = await logBench(cookie, {
      startedAt: at('2026-11-06T09:00:00Z'),
      kg: 85,
      reps: [10],
    });
    expect((await last())[0]?.workoutId).toBe(later.workout.id);
    expect(await bySlot()).toEqual([heavyLast, lightLast]);

    // Another user naming the slot reads nothing of it.
    const theirs = workoutRow();
    const named = exerciseRow(theirs.id, bench, { routineExerciseId: heavySlot.id });
    await sync(other.cookie, {
      workouts: [theirs],
      workoutExercises: [named],
      sets: [setRow(named.id, 0)],
    });
    expect((await last(other.cookie))[0]?.slots).toEqual([]);

    // A slot removed from the routine no longer answers: the device falls back to the exercise's.
    const removed = await send(cookie, 'PUT', `/api/routines/${routineId}/exercises`, {
      exercises: [lightSlot],
    });
    expect(removed.status).toBe(200);
    expect(await bySlot()).toEqual([lightLast]);
  });

  it('reads the rep range the workout ran with and the increment the user has today', async () => {
    const { cookie } = await t.createSignedInUser('settings@example.test');
    await setUpProfile(cookie, 'UTC');
    const { workoutExercise: we } = await logBench(cookie, {
      startedAt: at('2026-11-04T09:00:00Z'),
      kg: 80,
      reps: [8, 8],
      repHigh: 8,
    });
    await send(cookie, 'PUT', `/api/exercises/${we.exerciseId}/setting`, {
      incrementKg: 5,
      restSeconds: null,
      repLow: null,
      repHigh: null,
      hidden: false,
    });

    const body = await (
      await t.app.request('/api/training/last-time', { headers: { cookie } })
    ).json();

    expect(body.exercises[0].suggestion).toMatchObject({ weightKg: 85, rule: 'top_of_range_hit' });
  });

  it('never answers with another user’s history', async () => {
    const a = await t.createSignedInUser('mine@example.test');
    const b = await t.createSignedInUser('theirs@example.test');
    await setUpProfile(b.cookie);
    await logBench(a.cookie, { startedAt: at('2026-11-04T09:00:00Z'), kg: 80, reps: [10] });

    const body = await (
      await t.app.request('/api/training/last-time', { headers: { cookie: b.cookie } })
    ).json();

    expect(body.exercises).toEqual([]);
  });
});

describe('PATCH /api/me/profile', () => {
  it('creates the profile on the first save and changes only the fields sent after that', async () => {
    const { cookie } = await t.createSignedInUser('profile@example.test');

    const created = await send(cookie, 'PATCH', '/api/me/profile', { weightUnit: 'lb' });
    expect(created.status).toBe(200);
    expect(await created.json()).toEqual({
      timezone: 'Asia/Tokyo',
      heightCm: null,
      sex: null,
      birthDate: null,
      trainingWeekdays: [],
      weightUnit: 'lb',
    });

    await send(cookie, 'PATCH', '/api/me/profile', { timezone: 'Europe/London' });
    const me = await (await t.app.request('/api/me', { headers: { cookie } })).json();
    expect(me.profile).toMatchObject({ timezone: 'Europe/London', weightUnit: 'lb' });
  });

  it('refuses a time zone the runtime does not know, as 422 on timezone', async () => {
    const { cookie } = await t.createSignedInUser('zone@example.test');
    const res = await send(cookie, 'PATCH', '/api/me/profile', { timezone: 'Mars/Olympus' });
    expect(res.status).toBe(422);
    expect((await res.json()).errors[0].path).toBe('timezone');
  });
});

describe('DELETE /api/exercises/{id} once it has history', () => {
  it('refuses a custom exercise a workout logged: 409 exercise_has_history', async () => {
    const { cookie } = await t.createSignedInUser('history-delete@example.test');
    const customId = randomUUID();
    await send(cookie, 'POST', '/api/exercises', {
      id: customId,
      name: 'Cable Y-Raise',
      equipment: 'cable',
    });
    const w = workoutRow();
    const we = exerciseRow(w.id, customId);
    await sync(cookie, { workouts: [w], workoutExercises: [we], sets: [setRow(we.id, 0)] });

    const res = await send(cookie, 'DELETE', `/api/exercises/${customId}`);

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('exercise_has_history');
  });
});
