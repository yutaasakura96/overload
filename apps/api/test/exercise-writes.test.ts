import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { exercise, exerciseSetting, routine, routineExercise } from '../src/db/schema';
import { WEB_ORIGIN, useTestApp } from './harness';

// S8's write half (docs/07 §3.2): create, edit and delete a custom exercise, and the per-user
// setting on any exercise. Slice 2 carries the cross-user write and delete tests for `exercise` and
// `exercise_setting`, and Hono's csrf() against the first write route (docs/11 §2).
const t = useTestApp();

type Item = {
  id: string;
  name: string;
  equipment: string;
  custom: boolean;
  hidden: boolean;
  incrementKg: number;
  restSeconds: number;
  repLow: number;
  repHigh: number;
  overrides: Record<string, boolean>;
};

function send(cookie: string, method: string, path: string, body?: unknown) {
  return t.app.request(path, {
    method,
    headers: { cookie, 'Content-Type': 'application/json', Origin: WEB_ORIGIN },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function list(cookie: string, query = '?includeHidden=true') {
  const res = await t.app.request(`/api/exercises${query}`, { headers: { cookie } });
  const body: { items: Item[] } = await res.json();
  return body.items;
}

async function seeded(cookie: string, name: string) {
  const found = (await list(cookie)).find((item) => item.name === name);
  if (found === undefined) throw new Error(`no seeded exercise named ${name}`);
  return found;
}

async function createCustom(cookie: string, fields: Record<string, unknown> = {}) {
  const id = randomUUID();
  const res = await send(cookie, 'POST', '/api/exercises', {
    id,
    name: 'Cable Y-Raise',
    equipment: 'cable',
    ...fields,
  });
  expect(res.status).toBe(201);
  const body: Item = await res.json();
  return body;
}

async function addRoutineUsing(userId: string, exerciseId: string, name = 'Push A') {
  const [row] = await t.db.insert(routine).values({ userId, name }).returning();
  await t.db.insert(routineExercise).values({ routineId: row!.id, exerciseId, position: 0 });
  return row!;
}

describe('POST /api/exercises', () => {
  it('creates a custom exercise, visible only to its owner', async () => {
    const a = await t.createSignedInUser('creator@example.test');
    const b = await t.createSignedInUser('other@example.test');
    const id = randomUUID();

    const res = await send(a.cookie, 'POST', '/api/exercises', {
      id,
      name: '  Cable Y-Raise ',
      equipment: 'cable',
      incrementKg: 1.25,
      restSeconds: 90,
      repLow: 12,
      repHigh: 15,
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      id,
      name: 'Cable Y-Raise',
      equipment: 'cable',
      custom: true,
      hidden: false,
      incrementKg: 1.25,
      restSeconds: 90,
      repLow: 12,
      repHigh: 15,
      overrides: { incrementKg: false, restSeconds: false, repLow: false, repHigh: false },
    });
    expect((await list(a.cookie)).map((item) => item.id)).toContain(id);
    expect((await list(b.cookie)).map((item) => item.id)).not.toContain(id);
  });

  it('fills what is left out with the equipment’s increment and the S3/S5 defaults', async () => {
    const { cookie } = await t.createSignedInUser('defaults@example.test');

    const created = await createCustom(cookie, {
      name: 'Neutral Dumbbell Press',
      equipment: 'dumbbell',
    });

    expect(created).toMatchObject({ incrementKg: 1, restSeconds: 120, repLow: 6, repHigh: 10 });
  });

  it('answers a repeat of the same create with 200 and the stored row, and stores it once', async () => {
    const { cookie, user } = await t.createSignedInUser('retry@example.test');
    const body = { id: randomUUID(), name: 'Cable Y-Raise', equipment: 'cable' };

    const first = await send(cookie, 'POST', '/api/exercises', body);
    const second = await send(cookie, 'POST', '/api/exercises', body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    const rows = await t.db.select().from(exercise).where(eq(exercise.ownerUserId, user.id));
    expect(rows).toHaveLength(1);
  });

  it('refuses an id reused with different content as 409 id_conflict', async () => {
    const { cookie } = await t.createSignedInUser('reuse@example.test');
    const id = randomUUID();
    await send(cookie, 'POST', '/api/exercises', { id, name: 'Cable Y-Raise', equipment: 'cable' });

    const res = await send(cookie, 'POST', '/api/exercises', {
      id,
      name: 'Cable Lateral Raise',
      equipment: 'cable',
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'id_conflict' });
  });

  it('refuses a name the caller already uses, whatever its case, as 422 on name', async () => {
    const { cookie } = await t.createSignedInUser('dupe@example.test');
    await createCustom(cookie, { name: 'Cable Y-Raise' });

    const res = await send(cookie, 'POST', '/api/exercises', {
      id: randomUUID(),
      name: 'cable y-raise',
      equipment: 'cable',
    });

    expect(res.status).toBe(422);
    const problem = await res.json();
    expect(problem).toMatchObject({ code: 'validation_failed', errors: [{ path: 'name' }] });
    // The detail names the field, never what was in it (docs/07 §1.3).
    expect(JSON.stringify(problem)).not.toContain('y-raise');
  });

  it('refuses one rep end that leaves the default range inverted, as 422 on repLow', async () => {
    const { cookie } = await t.createSignedInUser('one-end@example.test');

    const low = await send(cookie, 'POST', '/api/exercises', {
      id: randomUUID(),
      name: 'Cable Y-Raise',
      equipment: 'cable',
      repLow: 12,
    });
    const high = await send(cookie, 'POST', '/api/exercises', {
      id: randomUUID(),
      name: 'Cable Y-Raise',
      equipment: 'cable',
      repHigh: 4,
    });

    for (const res of [low, high]) {
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({
        code: 'validation_failed',
        errors: [{ path: 'repLow' }],
      });
    }
    expect((await list(cookie)).filter((item) => item.custom)).toEqual([]);
  });

  it('lets two users use the same name', async () => {
    const a = await t.createSignedInUser('same-a@example.test');
    const b = await t.createSignedInUser('same-b@example.test');

    const mine = await createCustom(a.cookie, { name: 'Cable Y-Raise' });
    const theirs = await createCustom(b.cookie, { name: 'Cable Y-Raise' });

    expect(theirs.id).not.toBe(mine.id);
  });

  it.each([
    ['an inverted rep range', { repLow: 12, repHigh: 8 }, 'repLow'],
    ['an unknown equipment class', { equipment: 'kettlebell' }, 'equipment'],
    ['an empty name', { name: '   ' }, 'name'],
    ['a negative increment', { incrementKg: -1 }, 'incrementKg'],
  ])('refuses %s as 422 on that field', async (_, fields, path) => {
    const { cookie } = await t.createSignedInUser('invalid@example.test');

    const res = await send(cookie, 'POST', '/api/exercises', {
      id: randomUUID(),
      name: 'Cable Y-Raise',
      equipment: 'cable',
      ...fields,
    });

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      code: 'validation_failed',
      errors: [expect.objectContaining({ path })],
    });
  });

  it('refuses another user’s exercise id as 409 and leaves that exercise as it was', async () => {
    const a = await t.createSignedInUser('owner-a@example.test');
    const b = await t.createSignedInUser('thief-b@example.test');
    const mine = await createCustom(a.cookie);

    const res = await send(b.cookie, 'POST', '/api/exercises', {
      id: mine.id,
      name: 'Cable Y-Raise',
      equipment: 'cable',
    });

    expect(res.status).toBe(409);
    const [row] = await t.db.select().from(exercise).where(eq(exercise.id, mine.id));
    expect(row?.ownerUserId).toBe(a.user.id);
  });
});

describe('Hono’s csrf() on the first write route (docs/08 §2)', () => {
  it('refuses a form-type POST from another origin with a valid cookie: 403 cross_origin', async () => {
    const { cookie } = await t.createSignedInUser('csrf@example.test');

    const res = await t.app.request('/api/exercises', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'text/plain', Origin: 'https://evil.example' },
      body: JSON.stringify({ id: randomUUID(), name: 'Cable Y-Raise', equipment: 'cable' }),
    });

    expect(res.status).toBe(403);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    expect(await res.json()).toMatchObject({ code: 'cross_origin' });
    expect(await list(cookie, '')).toHaveLength(50);
  });

  it('lets the same request through from the web origin, where the body is then validated', async () => {
    const { cookie } = await t.createSignedInUser('csrf-ok@example.test');

    const res = await t.app.request('/api/exercises', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'text/plain', Origin: WEB_ORIGIN },
      body: JSON.stringify({ id: randomUUID(), name: 'Cable Y-Raise', equipment: 'cable' }),
    });

    // Past csrf(), the JSON body validator refuses anything that is not application/json.
    expect(res.status).not.toBe(403);
    expect(await list(cookie, '')).toHaveLength(50);
  });
});

describe('PATCH /api/exercises/{id}', () => {
  it('edits the caller’s custom exercise', async () => {
    const { cookie } = await t.createSignedInUser('editor@example.test');
    const created = await createCustom(cookie);

    const res = await send(cookie, 'PATCH', `/api/exercises/${created.id}`, {
      name: 'Cable Lateral Raise',
      restSeconds: 60,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: created.id,
      name: 'Cable Lateral Raise',
      equipment: 'cable',
      restSeconds: 60,
      incrementKg: created.incrementKg,
    });
  });

  it('answers 404 for a seeded exercise, which nobody may edit', async () => {
    const { cookie } = await t.createSignedInUser('seeded-edit@example.test');
    const bench = await seeded(cookie, 'Barbell Bench Press');

    const res = await send(cookie, 'PATCH', `/api/exercises/${bench.id}`, { restSeconds: 60 });

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'not_found' });
    expect((await seeded(cookie, 'Barbell Bench Press')).restSeconds).toBe(180);
  });

  it('refuses a patch that would leave the rep range inverted', async () => {
    const { cookie } = await t.createSignedInUser('range@example.test');
    const created = await createCustom(cookie, { repLow: 6, repHigh: 10 });

    const res = await send(cookie, 'PATCH', `/api/exercises/${created.id}`, { repLow: 12 });

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ errors: [{ path: 'repLow' }] });
  });

  it('refuses a rename onto another of the caller’s names', async () => {
    const { cookie } = await t.createSignedInUser('rename@example.test');
    await createCustom(cookie, { name: 'Cable Y-Raise' });
    const second = await createCustom(cookie, { name: 'Cable Lateral Raise' });

    const res = await send(cookie, 'PATCH', `/api/exercises/${second.id}`, {
      name: 'CABLE Y-RAISE',
    });

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ errors: [{ path: 'name' }] });
  });

  it('answers 404 to another user and leaves the exercise unchanged', async () => {
    const a = await t.createSignedInUser('patch-a@example.test');
    const b = await t.createSignedInUser('patch-b@example.test');
    const mine = await createCustom(a.cookie);

    const res = await send(b.cookie, 'PATCH', `/api/exercises/${mine.id}`, { name: 'Taken' });

    expect(res.status).toBe(404);
    const [row] = await t.db.select().from(exercise).where(eq(exercise.id, mine.id));
    expect(row).toMatchObject({ name: 'Cable Y-Raise', ownerUserId: a.user.id });
  });
});

describe('DELETE /api/exercises/{id}', () => {
  it('deletes a custom exercise that no routine uses, and again answers 204', async () => {
    const { cookie } = await t.createSignedInUser('deleter@example.test');
    const created = await createCustom(cookie);

    expect((await send(cookie, 'DELETE', `/api/exercises/${created.id}`)).status).toBe(204);
    expect((await send(cookie, 'DELETE', `/api/exercises/${created.id}`)).status).toBe(204);
    expect((await list(cookie)).map((item) => item.id)).not.toContain(created.id);
  });

  it('refuses while a routine uses it, naming the routines: 409 exercise_in_routine', async () => {
    const { cookie, user } = await t.createSignedInUser('in-routine@example.test');
    const created = await createCustom(cookie);
    const pushA = await addRoutineUsing(user.id, created.id);

    const res = await send(cookie, 'DELETE', `/api/exercises/${created.id}`);

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: 'exercise_in_routine',
      routines: [{ id: pushA.id, name: 'Push A' }],
    });
    expect((await list(cookie)).map((item) => item.id)).toContain(created.id);
  });

  it('answers 204 to another user and leaves the exercise in place', async () => {
    const a = await t.createSignedInUser('delete-a@example.test');
    const b = await t.createSignedInUser('delete-b@example.test');
    const mine = await createCustom(a.cookie);

    expect((await send(b.cookie, 'DELETE', `/api/exercises/${mine.id}`)).status).toBe(204);
    expect((await list(a.cookie)).map((item) => item.id)).toContain(mine.id);
  });

  it('never deletes a seeded exercise', async () => {
    const { cookie } = await t.createSignedInUser('seeded-delete@example.test');
    const bench = await seeded(cookie, 'Barbell Bench Press');

    expect((await send(cookie, 'DELETE', `/api/exercises/${bench.id}`)).status).toBe(204);
    expect(await list(cookie, '')).toHaveLength(50);
  });
});

describe('PUT /api/exercises/{id}/setting', () => {
  const noSetting = {
    incrementKg: null,
    restSeconds: null,
    repLow: null,
    repHigh: null,
    hidden: false,
  };

  it('overrides a seeded exercise’s values for the caller only', async () => {
    const a = await t.createSignedInUser('setter@example.test');
    const b = await t.createSignedInUser('bystander@example.test');
    const bench = await seeded(a.cookie, 'Barbell Bench Press');

    const res = await send(a.cookie, 'PUT', `/api/exercises/${bench.id}/setting`, {
      ...noSetting,
      incrementKg: 1.25,
      restSeconds: 240,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: bench.id,
      incrementKg: 1.25,
      restSeconds: 240,
      repLow: 6,
      overrides: { incrementKg: true, restSeconds: true, repLow: false, repHigh: false },
    });
    expect(await seeded(b.cookie, 'Barbell Bench Press')).toMatchObject({
      incrementKg: 2.5,
      restSeconds: 180,
    });
  });

  it('restores the defaults with nulls, leaving no setting row behind', async () => {
    const { cookie, user } = await t.createSignedInUser('restore@example.test');
    const bench = await seeded(cookie, 'Barbell Bench Press');
    await send(cookie, 'PUT', `/api/exercises/${bench.id}/setting`, {
      ...noSetting,
      restSeconds: 60,
    });

    const res = await send(cookie, 'PUT', `/api/exercises/${bench.id}/setting`, noSetting);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ restSeconds: 180, overrides: { restSeconds: false } });
    const rows = await t.db
      .select()
      .from(exerciseSetting)
      .where(eq(exerciseSetting.userId, user.id));
    expect(rows).toEqual([]);
  });

  it('hides an exercise from the default list and shows it again, keeping the first hidden time', async () => {
    const { cookie, user } = await t.createSignedInUser('hide@example.test');
    const bench = await seeded(cookie, 'Barbell Bench Press');
    const hide = { ...noSetting, hidden: true };

    expect((await send(cookie, 'PUT', `/api/exercises/${bench.id}/setting`, hide)).status).toBe(
      200,
    );
    const [first] = await t.db
      .select({ hiddenAt: exerciseSetting.hiddenAt })
      .from(exerciseSetting)
      .where(and(eq(exerciseSetting.userId, user.id), eq(exerciseSetting.exerciseId, bench.id)));
    await send(cookie, 'PUT', `/api/exercises/${bench.id}/setting`, hide);
    const [again] = await t.db
      .select({ hiddenAt: exerciseSetting.hiddenAt })
      .from(exerciseSetting)
      .where(and(eq(exerciseSetting.userId, user.id), eq(exerciseSetting.exerciseId, bench.id)));
    expect(again?.hiddenAt).toEqual(first?.hiddenAt);
    expect((await list(cookie, '')).map((item) => item.id)).not.toContain(bench.id);

    await send(cookie, 'PUT', `/api/exercises/${bench.id}/setting`, noSetting);
    expect((await list(cookie, '')).map((item) => item.id)).toContain(bench.id);
  });

  it('refuses values whose effective rep range would be inverted', async () => {
    const { cookie } = await t.createSignedInUser('setting-range@example.test');
    const bench = await seeded(cookie, 'Barbell Bench Press');

    const res = await send(cookie, 'PUT', `/api/exercises/${bench.id}/setting`, {
      ...noSetting,
      repLow: 12,
    });

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ errors: [{ path: 'repLow' }] });
  });

  it('answers 404 on another user’s custom exercise and writes nothing', async () => {
    const a = await t.createSignedInUser('setting-a@example.test');
    const b = await t.createSignedInUser('setting-b@example.test');
    const mine = await createCustom(a.cookie);

    const res = await send(b.cookie, 'PUT', `/api/exercises/${mine.id}/setting`, {
      ...noSetting,
      hidden: true,
    });

    expect(res.status).toBe(404);
    const rows = await t.db
      .select()
      .from(exerciseSetting)
      .where(eq(exerciseSetting.exerciseId, mine.id));
    expect(rows).toEqual([]);
  });

  it('never changes another user’s setting on a shared exercise', async () => {
    const a = await t.createSignedInUser('shared-a@example.test');
    const b = await t.createSignedInUser('shared-b@example.test');
    const bench = await seeded(a.cookie, 'Barbell Bench Press');
    await send(a.cookie, 'PUT', `/api/exercises/${bench.id}/setting`, {
      ...noSetting,
      restSeconds: 240,
    });

    await send(b.cookie, 'PUT', `/api/exercises/${bench.id}/setting`, noSetting);
    await send(b.cookie, 'PUT', `/api/exercises/${bench.id}/setting`, {
      ...noSetting,
      hidden: true,
    });

    expect(await seeded(a.cookie, 'Barbell Bench Press')).toMatchObject({
      restSeconds: 240,
      hidden: false,
    });
  });
});
