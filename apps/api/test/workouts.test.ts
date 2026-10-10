import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { set, syncTombstone, workout, workoutExercise } from '../src/db/schema';
import { WEB_ORIGIN, useTestApp } from './harness';

// S1 through the sync batch, and S2/S3 through last time (docs/07 §3, §3.4): the happy path, the
// cross-user refusals on the workout tree, the server half of the 3-hour rule, and slice 4's hard
// edges, which are deletes with their tombstones and a row refused inside a 200 (docs/11 §2). Two
// requests at once are in workouts-race.test.ts, which commits.
const t = useTestApp();

type Result = {
  table: string;
  id: string;
  status: string;
  row?: Record<string, unknown>;
  problem?: { code: string; status: number; errors?: { path: string; message: string }[] };
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
  options: {
    startedAt: string;
    kg: number;
    reps: number[];
    rir?: (number | null)[];
    repHigh?: number;
  },
) {
  const bench = await exerciseId(cookie, 'Barbell Bench Press');
  const w = workoutRow({ startedAt: options.startedAt, clientUpdatedAt: options.startedAt });
  const we = exerciseRow(w.id, bench, { repHigh: options.repHigh ?? 10 });
  const sets = [
    setRow(we.id, 0, { weightKg: 40, reps: 12, isWarmup: true, rir: null }),
    ...options.reps.map((reps, i) =>
      setRow(we.id, i + 1, {
        weightKg: options.kg,
        reps,
        ...(options.rir && { rir: options.rir[i] }),
      }),
    ),
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

  it('deletes an exercise row and a set, and answers a repeat of each as deleted', async () => {
    const { cookie } = await t.createSignedInUser('child-delete@example.test');
    const bench = await exerciseId(cookie, 'Barbell Bench Press');
    const {
      workout: w,
      workoutExercise: we,
      sets,
    } = await logBench(cookie, {
      startedAt: at('2026-11-11T09:00:00Z'),
      kg: 80,
      reps: [10, 9],
    });
    const other = exerciseRow(w.id, bench, { position: 1 });
    const otherSet = setRow(other.id, 0);
    await sync(cookie, { workoutExercises: [other], sets: [otherSet] });
    const deletedAt = at('2026-11-11T11:00:00Z');
    const batch = {
      workoutExercises: [{ id: other.id, deletedAt }],
      sets: [{ id: sets[1]?.id, deletedAt }],
    };

    expect((await sync(cookie, batch)).map((r) => r.status)).toEqual(['deleted', 'deleted']);
    expect((await sync(cookie, batch)).map((r) => r.status)).toEqual(['deleted', 'deleted']);

    const left = await t.db.select({ id: set.id }).from(set);
    expect(new Set(left.map((row) => row.id))).toEqual(new Set([sets[0]?.id, sets[2]?.id]));
    expect(
      await t.db.select().from(workoutExercise).where(eq(workoutExercise.id, we.id)),
    ).toHaveLength(1);
  });

  it('applies an edit and a delete made offline in the same batch', async () => {
    const { cookie } = await t.createSignedInUser('edit-delete@example.test');
    const { sets } = await logBench(cookie, {
      startedAt: at('2026-11-11T09:00:00Z'),
      kg: 80,
      reps: [10, 9],
    });
    const later = at('2026-11-11T11:00:00Z');

    const results = await sync(cookie, {
      sets: [
        { ...sets[1], reps: 8, clientUpdatedAt: later },
        { id: sets[2]?.id, deletedAt: later },
      ],
    });

    expect(results.map((r) => r.status)).toEqual(['stored', 'deleted']);
    expect(results[0]?.row).toMatchObject({ reps: 8 });
    expect(
      await t.db
        .select()
        .from(set)
        .where(eq(set.id, sets[2]?.id ?? '')),
    ).toHaveLength(0);
  });

  it('lets the newer client_updated_at win, for an edit and for a delete', async () => {
    const { cookie } = await t.createSignedInUser('newer-wins@example.test');
    const { workoutExercise: we, sets } = await logBench(cookie, {
      startedAt: at('2026-11-11T09:00:00Z'),
      kg: 80,
      reps: [10],
    });
    const edited = { ...sets[1], reps: 7, clientUpdatedAt: at('2026-11-11T12:00:00Z') };
    await sync(cookie, { sets: [edited] });

    // Both were made on another tab before that edit, and arrive after it.
    const results = await sync(cookie, {
      workoutExercises: [{ id: we.id, deletedAt: at('2026-11-11T09:00:00Z') }],
      sets: [
        { ...sets[1], reps: 3, clientUpdatedAt: at('2026-11-11T11:00:00Z') },
        { id: sets[1]?.id, deletedAt: at('2026-11-11T11:30:00Z') },
      ],
    });

    expect(results.map((r) => r.status)).toEqual(['unchanged', 'unchanged', 'unchanged']);
    expect(results[2]?.row).toMatchObject({ reps: 7 });
    expect(await t.db.select().from(syncTombstone)).toHaveLength(0);
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

  it('refuses one set that does not match its schema inside a 200, and stores the rest', async () => {
    const { cookie } = await t.createSignedInUser('bad@example.test');
    const bench = await exerciseId(cookie, 'Barbell Bench Press');
    const w = workoutRow();
    const we = exerciseRow(w.id, bench);
    const good = setRow(we.id, 0);
    const bad = setRow(we.id, 1, { reps: 0, weightKg: 82.5 });

    const results = await sync(cookie, {
      workouts: [w],
      workoutExercises: [we],
      sets: [bad, good],
    });

    expect(results.map((r) => [r.id, r.status])).toEqual([
      [w.id, 'stored'],
      [we.id, 'stored'],
      [bad.id, 'refused'],
      [good.id, 'stored'],
    ]);
    expect(results[2]?.problem).toMatchObject({ code: 'validation_failed', status: 422 });
    // The field at fault, and never the value that was sent.
    expect(results[2]?.problem?.errors?.map((error) => error.path)).toEqual(['reps']);
    expect(JSON.stringify(results[2])).not.toContain('82.5');
    const stored = await t.db
      .select({ id: set.id })
      .from(set)
      .where(eq(set.workoutExerciseId, we.id));
    expect(stored).toEqual([{ id: good.id }]);
  });

  it('refuses the children of a row that does not match its schema as parent_missing', async () => {
    const { cookie } = await t.createSignedInUser('bad-parent@example.test');
    const bench = await exerciseId(cookie, 'Barbell Bench Press');
    const w = workoutRow();
    const we = exerciseRow(w.id, bench, { repLow: 12, repHigh: 6 });

    const results = await sync(cookie, {
      workouts: [w],
      workoutExercises: [we],
      sets: [setRow(we.id, 0)],
    });

    expect(results.map((r) => [r.status, r.problem?.code])).toEqual([
      ['stored', undefined],
      ['refused', 'validation_failed'],
      ['refused', 'parent_missing'],
    ]);
  });

  it('refuses a batch holding a row with no id as 422, applying nothing', async () => {
    const { cookie } = await t.createSignedInUser('no-id@example.test');
    const w = workoutRow();
    const { id: _id, ...nameless } = setRow(randomUUID(), 0);
    const res = await send(cookie, 'POST', '/api/workouts/sync', {
      sets: [nameless],
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

/** Every tombstone, as `table id`. */
const tombstones = async () =>
  new Set((await t.db.select().from(syncTombstone)).map((row) => `${row.tableName} ${row.id}`));

describe('tombstones (docs/03 §8.1, docs/04 `sync_tombstone`)', () => {
  it('keeps each user’s tombstones independent for workout, exercise and set ids', async () => {
    const a = await t.createSignedInUser('tombstone-a@example.test');
    const b = await t.createSignedInUser('tombstone-b@example.test');
    const bench = await exerciseId(a.cookie, 'Barbell Bench Press');
    const bOwn = await logBench(b.cookie, {
      startedAt: at('2026-11-11T09:00:00Z'),
      kg: 80,
      reps: [10],
    });
    const w = workoutRow();
    const we = exerciseRow(w.id, bench);
    const s = setRow(we.id, 0);
    const deletedAt = at('2026-11-12T09:00:00Z');

    expect(
      (
        await sync(b.cookie, {
          workouts: [{ id: w.id, deletedAt }],
          workoutExercises: [{ id: we.id, deletedAt }],
          sets: [{ id: s.id, deletedAt }],
        })
      ).map((result) => result.status),
    ).toEqual(['deleted', 'deleted', 'deleted']);
    expect(
      (await sync(a.cookie, { workouts: [w], workoutExercises: [we], sets: [s] })).map(
        (result) => result.status,
      ),
    ).toEqual(['stored', 'stored', 'stored']);
    expect((await sync(a.cookie, { workouts: [{ id: w.id, deletedAt }] }))[0]?.status).toBe(
      'deleted',
    );

    const stale = await sync(a.cookie, { workouts: [w], workoutExercises: [we], sets: [s] });
    expect(stale.map((result) => result.status)).toEqual(['deleted', 'deleted', 'deleted']);
    for (const id of [w.id, we.id, s.id]) {
      const owners = (await t.db.select().from(syncTombstone).where(eq(syncTombstone.id, id))).map(
        (row) => row.userId,
      );
      expect(new Set(owners)).toEqual(new Set([a.user.id, b.user.id]));
    }
    expect(await t.db.select().from(workout).where(eq(workout.id, w.id))).toHaveLength(0);
    expect(await t.db.select().from(workout).where(eq(workout.id, bOwn.workout.id))).toHaveLength(
      1,
    );
    expect(
      await t.db
        .select()
        .from(workoutExercise)
        .where(eq(workoutExercise.id, bOwn.workoutExercise.id)),
    ).toHaveLength(1);
    expect(
      await t.db
        .select()
        .from(set)
        .where(eq(set.id, bOwn.sets[0]?.id ?? '')),
    ).toHaveLength(1);
  }, 15_000);

  it('buries a deleted workout with every row it cascades to, under the phone’s deletedAt', async () => {
    const { cookie, user } = await t.createSignedInUser('bury@example.test');
    const {
      workout: w,
      workoutExercise: we,
      sets,
    } = await logBench(cookie, {
      startedAt: at('2026-11-11T09:00:00Z'),
      kg: 80,
      reps: [10],
    });
    const deletedAt = at('2026-11-11T11:00:00Z');

    await sync(cookie, { workouts: [{ id: w.id, deletedAt }] });

    expect(await tombstones()).toEqual(
      new Set([
        `workout ${w.id}`,
        `workout_exercise ${we.id}`,
        ...sets.map((each) => `set ${each.id}`),
      ]),
    );
    const rows = await t.db.select().from(syncTombstone);
    expect(rows.every((row) => row.userId === user.id)).toBe(true);
    expect(rows.every((row) => row.deletedAt.toISOString() === deletedAt)).toBe(true);
  });

  it('buries a deleted exercise row with its sets, and a deleted set alone', async () => {
    const { cookie } = await t.createSignedInUser('bury-child@example.test');
    const bench = await exerciseId(cookie, 'Barbell Bench Press');
    const { workout: w, sets } = await logBench(cookie, {
      startedAt: at('2026-11-11T09:00:00Z'),
      kg: 80,
      reps: [10],
    });
    const other = exerciseRow(w.id, bench, { position: 1 });
    const otherSet = setRow(other.id, 0);
    await sync(cookie, { workoutExercises: [other], sets: [otherSet] });
    const deletedAt = at('2026-11-11T11:00:00Z');

    await sync(cookie, {
      workoutExercises: [{ id: other.id, deletedAt }],
      sets: [{ id: sets[1]?.id, deletedAt }],
    });

    expect(await tombstones()).toEqual(
      new Set([`workout_exercise ${other.id}`, `set ${otherSet.id}`, `set ${sets[1]?.id}`]),
    );
  });

  it('does not store a stale copy of a set, or of a workout, that arrives after its delete', async () => {
    const { cookie } = await t.createSignedInUser('stale@example.test');
    const first = await logBench(cookie, {
      startedAt: at('2026-11-11T09:00:00Z'),
      kg: 80,
      reps: [10],
    });
    const second = await logBench(cookie, {
      startedAt: at('2026-11-12T09:00:00Z'),
      kg: 80,
      reps: [10],
    });
    const deletedAt = at('2026-11-13T09:00:00Z');
    await sync(cookie, {
      workouts: [{ id: second.workout.id, deletedAt }],
      sets: [{ id: first.sets[1]?.id, deletedAt }],
    });

    // A second tab still holds both, and one of its copies is even stamped after the delete.
    const stale = await sync(cookie, {
      workouts: [second.workout],
      workoutExercises: [second.workoutExercise],
      sets: [
        ...second.sets,
        first.sets[1],
        { ...first.sets[1], reps: 3, clientUpdatedAt: at('2026-11-14T09:00:00Z') },
      ],
    });

    expect(stale.map((r) => r.status)).toEqual(Array.from({ length: 6 }, () => 'deleted'));
    expect(await t.db.select().from(workout).where(eq(workout.id, second.workout.id))).toHaveLength(
      0,
    );
    const left = await t.db.select({ id: set.id }).from(set);
    expect(left).toEqual([{ id: first.sets[0]?.id }]);
  });

  it('answers a new row under a deleted parent as deleted, in a later request too', async () => {
    const { cookie } = await t.createSignedInUser('orphan@example.test');
    const bench = await exerciseId(cookie, 'Barbell Bench Press');
    const { workout: w, workoutExercise: we } = await logBench(cookie, {
      startedAt: at('2026-11-11T09:00:00Z'),
      kg: 80,
      reps: [10],
    });
    const kept = await logBench(cookie, {
      startedAt: at('2026-11-12T09:00:00Z'),
      kg: 80,
      reps: [10],
    });
    const deletedAt = at('2026-11-13T09:00:00Z');
    await sync(cookie, {
      workouts: [{ id: w.id, deletedAt }],
      workoutExercises: [{ id: kept.workoutExercise.id, deletedAt }],
    });

    // Rows the server has never seen, logged on a tab that had not heard of either delete.
    const results = await sync(cookie, {
      workoutExercises: [exerciseRow(w.id, bench, { position: 1 })],
      sets: [setRow(we.id, 7), setRow(kept.workoutExercise.id, 7)],
    });

    expect(results.map((r) => r.status)).toEqual(['deleted', 'deleted', 'deleted']);
    expect(await t.db.select().from(set)).toHaveLength(0);
  });

  it('buries a row the server never had, so its copy from another tab is not stored', async () => {
    const { cookie } = await t.createSignedInUser('unseen@example.test');
    const bench = await exerciseId(cookie, 'Barbell Bench Press');
    const w = workoutRow();
    const we = exerciseRow(w.id, bench);
    const deletedAt = at('2026-11-11T11:00:00Z');

    expect((await sync(cookie, { workouts: [{ id: w.id, deletedAt }] }))[0]?.status).toBe(
      'deleted',
    );
    const late = await sync(cookie, {
      workouts: [w],
      workoutExercises: [we],
      sets: [setRow(we.id, 0)],
    });

    expect(late.map((r) => r.status)).toEqual(['deleted', 'deleted', 'deleted']);
    expect(await t.db.select().from(workout).where(eq(workout.id, w.id))).toHaveLength(0);
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

  it('refuses another user’s exercise row and set deletions as not found, burying nothing', async () => {
    const a = await t.createSignedInUser('kept@example.test');
    const b = await t.createSignedInUser('deleter@example.test');
    const { workoutExercise: we, sets } = await logBench(a.cookie, {
      startedAt: at('2026-11-11T09:00:00Z'),
      kg: 80,
      reps: [10],
    });
    const later = at('2026-11-12T09:00:00Z');

    const results = await sync(b.cookie, {
      workoutExercises: [{ id: we.id, deletedAt: later }],
      sets: [{ id: sets[1]?.id, deletedAt: later }],
    });

    for (const result of results) {
      expect(result).toMatchObject({ status: 'refused', problem: { code: 'not_found' } });
    }
    expect(await t.db.select().from(set).where(eq(set.workoutExerciseId, we.id))).toHaveLength(2);
    expect(await t.db.select().from(syncTombstone)).toHaveLength(0);
  });

  it('answers a tombstone only to the user who made it', async () => {
    const a = await t.createSignedInUser('buried@example.test');
    const b = await t.createSignedInUser('reader@example.test');
    const { workout: w, sets } = await logBench(a.cookie, {
      startedAt: at('2026-11-11T09:00:00Z'),
      kg: 80,
      reps: [10],
    });
    await sync(a.cookie, { workouts: [{ id: w.id, deletedAt: at('2026-11-12T09:00:00Z') }] });
    const own = await logBench(b.cookie, {
      startedAt: at('2026-11-11T09:00:00Z'),
      kg: 80,
      reps: [10],
    });

    // The ids A deleted mean nothing to B: neither `deleted`, which would say they once existed.
    const results = await sync(b.cookie, {
      workouts: [{ ...w, name: 'Guess' }],
      sets: [{ ...sets[1], workoutExerciseId: own.workoutExercise.id, position: 9 }],
    });

    expect(results.map((r) => r.status)).toEqual(['stored', 'stored']);
    const buried = await t.db.select().from(syncTombstone);
    expect(buried.every((row) => row.userId === a.user.id)).toBe(true);
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
          { workingSet: 1, weightKg: 80, reps: 10, rir: 2 },
          { workingSet: 2, weightKg: 80, reps: 10, rir: 2 },
          { workingSet: 3, weightKg: 80, reps: 10, rir: 2 },
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

  it('answers each working set’s RIR, null where the set recorded none', async () => {
    const { cookie } = await t.createSignedInUser('rir@example.test');
    await setUpProfile(cookie);
    await logBench(cookie, {
      startedAt: at('2026-11-04T09:00:00Z'),
      kg: 80,
      reps: [10, 9],
      rir: [1, null],
    });

    const res = await t.app.request('/api/training/last-time', { headers: { cookie } });
    const body = await res.json();

    expect(body.exercises[0]?.sets.map((logged: { rir: number | null }) => logged.rir)).toEqual([
      1,
      null,
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
        { workingSet: 1, weightKg: 80, reps: 8, rir: 2 },
        { workingSet: 2, weightKg: 80, reps: 8, rir: 2 },
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
      sets: [{ workingSet: 1, weightKg: 60, reps: 10, rir: 2 }],
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
