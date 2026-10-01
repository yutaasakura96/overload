import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { routine, routineExercise } from '../src/db/schema';
import { WEB_ORIGIN, useTestApp } from './harness';

// S4 (docs/07 §3.3). Slice 2 carries the cross-user write and delete tests on `routine`, and a
// routine referring to another user's exercise, which is refused as not found (docs/11 §2).
const t = useTestApp();

type Slot = {
  id: string;
  exerciseId: string;
  targetSets: number;
  repLow: number | null;
  repHigh: number | null;
};
type Routine = { id: string; name: string; position: number; exercises: Slot[] };

function send(cookie: string, method: string, path: string, body?: unknown) {
  return t.app.request(path, {
    method,
    headers: { cookie, 'Content-Type': 'application/json', Origin: WEB_ORIGIN },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function routines(cookie: string) {
  const res = await t.app.request('/api/routines', { headers: { cookie } });
  expect(res.status).toBe(200);
  const body: { items: Routine[] } = await res.json();
  return body.items;
}

async function exerciseIds(cookie: string) {
  const res = await t.app.request('/api/exercises', { headers: { cookie } });
  const body: { items: { id: string; name: string }[] } = await res.json();
  const byName = new Map(body.items.map((item) => [item.name, item.id]));
  const id = (name: string) => {
    const found = byName.get(name);
    if (found === undefined) throw new Error(`no exercise named ${name}`);
    return found;
  };
  return {
    bench: id('Barbell Bench Press'),
    incline: id('Incline Dumbbell Bench Press'),
    pushdown: id('Cable Triceps Pushdown'),
  };
}

const slot = (exerciseId: string, fields: Partial<Slot> = {}) => ({
  id: randomUUID(),
  exerciseId,
  ...fields,
});

async function createRoutine(cookie: string, name: string, exercises: unknown[] = []) {
  const res = await send(cookie, 'POST', '/api/routines', { id: randomUUID(), name, exercises });
  expect(res.status).toBe(201);
  const body: Routine = await res.json();
  return body;
}

async function createCustomExercise(cookie: string) {
  const id = randomUUID();
  const res = await send(cookie, 'POST', '/api/exercises', {
    id,
    name: 'Cable Y-Raise',
    equipment: 'cable',
  });
  expect(res.status).toBe(201);
  return id;
}

describe('POST /api/routines', () => {
  it('creates a routine with its slots in array order', async () => {
    const { cookie } = await t.createSignedInUser('push@example.test');
    const ids = await exerciseIds(cookie);
    const id = randomUUID();
    const first = slot(ids.bench, { targetSets: 4, repLow: 6, repHigh: 10 });
    const second = slot(ids.pushdown);

    const res = await send(cookie, 'POST', '/api/routines', {
      id,
      name: ' Push A ',
      exercises: [first, second],
    });

    expect(res.status).toBe(201);
    const expected = {
      id,
      name: 'Push A',
      position: 0,
      exercises: [
        { id: first.id, exerciseId: ids.bench, targetSets: 4, repLow: 6, repHigh: 10 },
        { id: second.id, exerciseId: ids.pushdown, targetSets: 3, repLow: null, repHigh: null },
      ],
    };
    expect(await res.json()).toEqual(expected);
    expect(await routines(cookie)).toEqual([expected]);
  });

  it('adds each new routine to the end of the list', async () => {
    const { cookie } = await t.createSignedInUser('order@example.test');

    await createRoutine(cookie, 'Push A');
    await createRoutine(cookie, 'Pull A');
    await createRoutine(cookie, 'Legs A');

    expect((await routines(cookie)).map((r) => [r.name, r.position])).toEqual([
      ['Push A', 0],
      ['Pull A', 1],
      ['Legs A', 2],
    ]);
  });

  it('answers a repeat with 200 and the stored routine, stored once', async () => {
    const { cookie, user } = await t.createSignedInUser('repeat@example.test');
    const ids = await exerciseIds(cookie);
    const body = { id: randomUUID(), name: 'Push A', exercises: [slot(ids.bench)] };

    const first = await send(cookie, 'POST', '/api/routines', body);
    const second = await send(cookie, 'POST', '/api/routines', body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    expect(await t.db.select().from(routine).where(eq(routine.userId, user.id))).toHaveLength(1);
  });

  it('refuses an id reused with different content as 409 id_conflict', async () => {
    const { cookie } = await t.createSignedInUser('conflict@example.test');
    const id = randomUUID();
    await send(cookie, 'POST', '/api/routines', { id, name: 'Push A' });

    const res = await send(cookie, 'POST', '/api/routines', { id, name: 'Pull A' });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'id_conflict' });
  });

  it('refuses a slot naming an exercise the caller has hidden', async () => {
    const { cookie } = await t.createSignedInUser('hidden-slot@example.test');
    const ids = await exerciseIds(cookie);
    await send(cookie, 'PUT', `/api/exercises/${ids.bench}/setting`, {
      incrementKg: null,
      restSeconds: null,
      repLow: null,
      repHigh: null,
      hidden: true,
    });

    const res = await send(cookie, 'POST', '/api/routines', {
      id: randomUUID(),
      name: 'Push A',
      exercises: [slot(ids.pushdown), slot(ids.bench)],
    });

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      code: 'validation_failed',
      errors: [{ path: 'exercises.1.exerciseId' }],
    });
  });

  it.each([
    ['a rep range with only one end', { repLow: 6 }, 'exercises.0.repHigh'],
    ['an inverted rep range', { repLow: 12, repHigh: 8 }, 'exercises.0.repLow'],
    ['zero target sets', { targetSets: 0 }, 'exercises.0.targetSets'],
  ])('refuses %s as 422 on that field', async (_, fields, path) => {
    const { cookie } = await t.createSignedInUser('bad-slot@example.test');
    const ids = await exerciseIds(cookie);

    const res = await send(cookie, 'POST', '/api/routines', {
      id: randomUUID(),
      name: 'Push A',
      exercises: [slot(ids.bench, fields)],
    });

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ errors: [expect.objectContaining({ path })] });
  });

  it('refuses the same slot id twice in one list', async () => {
    const { cookie } = await t.createSignedInUser('twice@example.test');
    const ids = await exerciseIds(cookie);
    const repeated = slot(ids.bench);

    const res = await send(cookie, 'POST', '/api/routines', {
      id: randomUUID(),
      name: 'Push A',
      exercises: [repeated, { ...repeated, exerciseId: ids.pushdown }],
    });

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ errors: [{ path: 'exercises.1.id' }] });
  });
});

describe('PATCH /api/routines/{id}', () => {
  it('renames a routine', async () => {
    const { cookie } = await t.createSignedInUser('rename@example.test');
    const pushA = await createRoutine(cookie, 'Push A');

    const res = await send(cookie, 'PATCH', `/api/routines/${pushA.id}`, { name: 'Push B' });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: pushA.id, name: 'Push B' });
  });

  it('moves a routine to a new place in the list, and the rest close up around it', async () => {
    const { cookie } = await t.createSignedInUser('move@example.test');
    await createRoutine(cookie, 'Push A');
    await createRoutine(cookie, 'Pull A');
    const legs = await createRoutine(cookie, 'Legs A');

    const res = await send(cookie, 'PATCH', `/api/routines/${legs.id}`, { position: 0 });
    const again = await send(cookie, 'PATCH', `/api/routines/${legs.id}`, { position: 0 });

    expect(res.status).toBe(200);
    expect(again.status).toBe(200);
    expect((await routines(cookie)).map((r) => [r.name, r.position])).toEqual([
      ['Legs A', 0],
      ['Push A', 1],
      ['Pull A', 2],
    ]);
  });

  it('answers 404 to another user and leaves the routine unchanged', async () => {
    const a = await t.createSignedInUser('patch-owner@example.test');
    const b = await t.createSignedInUser('patch-other@example.test');
    const pushA = await createRoutine(a.cookie, 'Push A');

    const res = await send(b.cookie, 'PATCH', `/api/routines/${pushA.id}`, { name: 'Mine now' });

    expect(res.status).toBe(404);
    expect(await routines(a.cookie)).toEqual([pushA]);
  });
});

describe('PUT /api/routines/{id}/exercises', () => {
  it('replaces the whole slot list, so a reorder is one call', async () => {
    const { cookie } = await t.createSignedInUser('reorder@example.test');
    const ids = await exerciseIds(cookie);
    const bench = slot(ids.bench, { targetSets: 4 });
    const incline = slot(ids.incline);
    const pushdown = slot(ids.pushdown);
    const pushA = await createRoutine(cookie, 'Push A', [bench, incline, pushdown]);

    const reordered = [pushdown, bench];
    const res = await send(cookie, 'PUT', `/api/routines/${pushA.id}/exercises`, {
      exercises: reordered,
    });
    const repeat = await send(cookie, 'PUT', `/api/routines/${pushA.id}/exercises`, {
      exercises: reordered,
    });

    expect(res.status).toBe(200);
    expect(repeat.status).toBe(200);
    const [stored] = await routines(cookie);
    expect(stored?.exercises.map((s) => [s.id, s.targetSets])).toEqual([
      [pushdown.id, 3],
      [bench.id, 4],
    ]);
    expect(await repeat.json()).toEqual(stored);
  });

  it('answers 404 to another user and leaves the slots unchanged', async () => {
    const a = await t.createSignedInUser('slots-owner@example.test');
    const b = await t.createSignedInUser('slots-other@example.test');
    const ids = await exerciseIds(a.cookie);
    const pushA = await createRoutine(a.cookie, 'Push A', [slot(ids.bench)]);

    const res = await send(b.cookie, 'PUT', `/api/routines/${pushA.id}/exercises`, {
      exercises: [],
    });

    expect(res.status).toBe(404);
    expect(await routines(a.cookie)).toEqual([pushA]);
  });

  it('keeps a hidden exercise the routine already holds, but refuses adding one', async () => {
    const { cookie } = await t.createSignedInUser('hidden-kept@example.test');
    const ids = await exerciseIds(cookie);
    const bench = slot(ids.bench);
    const pushdown = slot(ids.pushdown);
    const pushA = await createRoutine(cookie, 'Push A', [bench, pushdown]);
    const pullA = await createRoutine(cookie, 'Pull A');
    await send(cookie, 'PUT', `/api/exercises/${ids.bench}/setting`, {
      incrementKg: null,
      restSeconds: null,
      repLow: null,
      repHigh: null,
      hidden: true,
    });

    const kept = await send(cookie, 'PUT', `/api/routines/${pushA.id}/exercises`, {
      exercises: [{ ...pushdown, targetSets: 5 }, bench],
    });
    const added = await send(cookie, 'PUT', `/api/routines/${pullA.id}/exercises`, {
      exercises: [slot(ids.incline), slot(ids.bench)],
    });

    expect(kept.status).toBe(200);
    const stored: Routine = await kept.json();
    expect(stored.exercises.map((s) => [s.exerciseId, s.targetSets])).toEqual([
      [ids.pushdown, 5],
      [ids.bench, 3],
    ]);
    expect(added.status).toBe(422);
    expect(await added.json()).toMatchObject({
      code: 'validation_failed',
      errors: [{ path: 'exercises.1.exerciseId' }],
    });
  });

  it('refuses a slot id already used by another routine as 409 id_conflict', async () => {
    const { cookie } = await t.createSignedInUser('slot-reuse@example.test');
    const ids = await exerciseIds(cookie);
    const taken = slot(ids.bench);
    await createRoutine(cookie, 'Push A', [taken]);
    const pullA = await createRoutine(cookie, 'Pull A');

    const res = await send(cookie, 'PUT', `/api/routines/${pullA.id}/exercises`, {
      exercises: [taken],
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'id_conflict' });
  });
});

describe('DELETE /api/routines/{id}', () => {
  it('deletes the routine and its slots, and answers 204 again after', async () => {
    const { cookie } = await t.createSignedInUser('delete@example.test');
    const ids = await exerciseIds(cookie);
    const pushA = await createRoutine(cookie, 'Push A', [slot(ids.bench)]);

    expect((await send(cookie, 'DELETE', `/api/routines/${pushA.id}`)).status).toBe(204);
    expect((await send(cookie, 'DELETE', `/api/routines/${pushA.id}`)).status).toBe(204);
    expect(await routines(cookie)).toEqual([]);
    const slots = await t.db
      .select()
      .from(routineExercise)
      .where(eq(routineExercise.routineId, pushA.id));
    expect(slots).toEqual([]);
  });

  it('answers 204 to another user and leaves the routine in place', async () => {
    const a = await t.createSignedInUser('delete-owner@example.test');
    const b = await t.createSignedInUser('delete-other@example.test');
    const pushA = await createRoutine(a.cookie, 'Push A');

    expect((await send(b.cookie, 'DELETE', `/api/routines/${pushA.id}`)).status).toBe(204);
    expect(await routines(a.cookie)).toEqual([pushA]);
  });
});

describe('another user’s exercise in a routine (docs/08 §10)', () => {
  it('is refused as not found on create', async () => {
    const a = await t.createSignedInUser('ref-a@example.test');
    const b = await t.createSignedInUser('ref-b@example.test');
    const theirs = await createCustomExercise(a.cookie);

    const res = await send(b.cookie, 'POST', '/api/routines', {
      id: randomUUID(),
      name: 'Push A',
      exercises: [slot(theirs)],
    });

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      code: 'validation_failed',
      errors: [{ path: 'exercises.0.exerciseId' }],
    });
    expect(await routines(b.cookie)).toEqual([]);
  });

  it('is refused as not found when replacing slots', async () => {
    const a = await t.createSignedInUser('ref-put-a@example.test');
    const b = await t.createSignedInUser('ref-put-b@example.test');
    const theirs = await createCustomExercise(a.cookie);
    const pushA = await createRoutine(b.cookie, 'Push A');

    const res = await send(b.cookie, 'PUT', `/api/routines/${pushA.id}/exercises`, {
      exercises: [slot(theirs)],
    });

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ errors: [{ path: 'exercises.0.exerciseId' }] });
    expect(await routines(b.cookie)).toEqual([pushA]);
  });

  it('never lists another user’s routines', async () => {
    const a = await t.createSignedInUser('list-a@example.test');
    const b = await t.createSignedInUser('list-b@example.test');
    await createRoutine(a.cookie, 'Push A');

    expect(await routines(b.cookie)).toEqual([]);
  });
});

describe('the slot’s exercise reference (docs/04 `routine_exercise`)', () => {
  // Deferred, so it is checked at commit. SET CONSTRAINTS ALL IMMEDIATE runs that check inside the
  // test's transaction, which the rollback then cleans up (docs/11 §1).
  it('is deferred to commit, and refuses an exercise still used by a slot there', async () => {
    const { cookie, user } = await t.createSignedInUser('deferred@example.test');
    const exerciseId = await createCustomExercise(cookie);
    await createRoutine(cookie, 'Push A', [slot(exerciseId)]);

    // Deleting the exercise directly is accepted for now: the check waits for commit.
    await t.db.execute(
      t.sql`DELETE FROM exercise WHERE id = ${exerciseId} AND owner_user_id = ${user.id}`,
    );

    await expect(t.db.execute(t.sql`SET CONSTRAINTS ALL IMMEDIATE`)).rejects.toMatchObject({
      cause: expect.objectContaining({ code: '23503' }),
    });
  });
});
