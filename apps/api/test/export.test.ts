import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { EXPORTED_TABLES, NOT_EXPORTED } from '../src/routes/export';
import { fillAccount, sender } from './account-fixture';
import { useTestApp } from './harness';

// The export (S10, docs/07 §2): every section, paging, the cross-user case (docs/08 §10), and
// completeness: every table holding a user's rows is in a section or on the listed exceptions.
const t = useTestApp();

type Page = { section: string; items: Record<string, unknown>[]; nextCursor: string | null };

async function exportOf(cookie: string, query: string) {
  const res = await t.app.request(`/api/me/export?${query}`, { headers: { cookie } });
  expect(res.status).toBe(200);
  const body: Page = await res.json();
  return body;
}

async function exportAll(cookie: string, section: string) {
  const items: Page['items'] = [];
  let cursor: string | null = null;
  do {
    const page = await exportOf(
      cookie,
      `section=${section}&limit=100${cursor === null ? '' : `&cursor=${cursor}`}`,
    );
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return items;
}

describe('export completeness', () => {
  it('has every table with a user id column in a section or on the exceptions', async () => {
    const { rows } = await t.db.execute<{ table_name: string }>(sql`
      SELECT DISTINCT table_name FROM information_schema.columns
       WHERE table_schema = 'public' AND (column_name = 'user_id' OR column_name LIKE '%\\_user\\_id')
    `);
    const covered = new Set<string>([...Object.values(EXPORTED_TABLES).flat(), ...NOT_EXPORTED]);
    const tables = rows.map((row) => row.table_name);

    expect(tables).toContain('workout');
    expect(tables.filter((table) => !covered.has(table))).toEqual([]);
  });

  it('names only tables that exist among those a section carries', async () => {
    const { rows } = await t.db.execute<{ table_name: string }>(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const tables = new Set(rows.map((row) => row.table_name));

    expect(
      Object.values(EXPORTED_TABLES)
        .flat()
        .filter((table) => !tables.has(table)),
    ).toEqual([]);
  });
});

describe('GET /api/me/export', () => {
  it('answers 401 without a session', async () => {
    expect((await t.app.request('/api/me/export?section=profile')).status).toBe(401);
  });

  it('keeps planning sections on the new endpoint', async () => {
    const { cookie } = await t.createSignedInUser('planning-export@example.test');
    for (const section of ['phases', 'dayRoutines', 'planDays', 'batches']) {
      const oldRoute = await t.app.request(`/api/me/export?section=${section}`, {
        headers: { cookie },
      });
      expect(oldRoute.status).toBe(400);
      const planningRoute = await t.app.request(`/api/me/export/planning?section=${section}`, {
        headers: { cookie },
      });
      expect(planningRoute.status).toBe(200);
      expect(await planningRoute.json()).toEqual({ section, items: [], nextCursor: null });
    }
    expect((await t.app.request('/api/me/export/planning?section=phases')).status).toBe(401);
  });

  it.each([
    '',
    'section=meals',
    'section=workouts&limit=0',
    'section=foods&cursor=nope',
    `section=rotationGroups&cursor=${Buffer.from(JSON.stringify({ section: 'foods', id: randomUUID() })).toString('base64url')}`,
    'section=workouts&cursor=nope',
    'section=profile&cursor=nope',
    'section=exercises&cursor=nope',
    'section=routines&cursor=nope',
    `section=exercises&cursor=${Buffer.from(JSON.stringify({ section: 'exercises', name: 1, id: randomUUID() })).toString('base64url')}`,
    `section=routines&cursor=${Buffer.from(JSON.stringify({ section: 'routines', position: '0', id: randomUUID() })).toString('base64url')}`,
    `section=workouts&cursor=${Buffer.from(JSON.stringify({ section: 'workouts', startedAt: new Date().toISOString(), id: 'bad' })).toString('base64url')}`,
    'section=weighIns&cursor=nope',
    `section=weighIns&cursor=${Buffer.from(JSON.stringify({ section: 'workouts', startedAt: new Date().toISOString(), id: randomUUID() })).toString('base64url')}`,
  ])('refuses %j as a bad request', async (query) => {
    const { cookie } = await t.createSignedInUser('bad@example.test');
    const res = await t.app.request(`/api/me/export?${query}`, { headers: { cookie } });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('bad_request');
  });

  it('carries everything the user owns, section by section', async () => {
    const { cookie, user } = await t.createSignedInUser('owner@example.test');
    const made = await fillAccount(t, cookie);

    const profile = await exportOf(cookie, 'section=profile');
    expect(profile).toEqual({
      section: 'profile',
      items: [
        {
          user: { id: user.id, name: user.name, email: 'owner@example.test', image: null },
          profile: expect.objectContaining({ timezone: 'Asia/Tokyo', weightUnit: 'kg' }),
        },
      ],
      nextCursor: null,
    });

    const exercises = await exportAll(cookie, 'exercises');
    expect(exercises).toContainEqual(
      expect.objectContaining({ id: made.customId, custom: true, restSeconds: 90 }),
    );
    // Hidden ones are included, with the caller's settings.
    expect(exercises).toContainEqual(expect.objectContaining({ id: made.hiddenId, hidden: true }));

    const routines = await exportOf(cookie, 'section=routines');
    expect(routines.items).toEqual([
      expect.objectContaining({
        id: made.routineId,
        exercises: [expect.objectContaining({ exerciseId: made.customId })],
      }),
    ]);

    const workouts = await exportOf(cookie, 'section=workouts');
    expect(workouts.nextCursor).toBeNull();
    // Newest first, the one in progress included, each whole with its exercises and sets.
    expect(workouts.items.map((item) => item['id'])).toEqual([
      made.open.workout.id,
      made.finished.workout.id,
    ]);
    expect(workouts.items[1]).toEqual(
      expect.objectContaining({
        endedAt: made.finished.workout.endedAt,
        exercises: [
          expect.objectContaining({
            exerciseId: made.customId,
            name: 'Cable Y-Raise',
            sets: [expect.objectContaining({ id: made.finished.sets[0]?.id, weightKg: 40 })],
          }),
        ],
      }),
    );

    const weighIns = await exportOf(cookie, 'section=weighIns');
    expect(weighIns).toEqual({
      section: 'weighIns',
      items: [{ ...made.weighIn, source: 'manual' }],
      nextCursor: null,
    });

    // Archived foods too: past plans still name them.
    const foods = await exportOf(cookie, 'section=foods');
    expect(foods.nextCursor).toBeNull();
    // By id, and the fixture's ids are random, so in either order.
    expect(foods.items).toHaveLength(2);
    expect(foods.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: made.foodId,
          name: 'White rice',
          energyKcal: 156,
          keepsDays: 3,
          rotationGroupId: made.groupId,
          archivedAt: null,
        }),
        expect.objectContaining({ id: made.archivedFoodId, archivedAt: expect.any(String) }),
      ]),
    );
    const groups = await exportOf(cookie, 'section=rotationGroups');
    expect(groups).toEqual({
      section: 'rotationGroups',
      items: [{ id: made.groupId, name: 'Starch', foodIds: [made.foodId] }],
      nextCursor: null,
    });
    const batches = await t.app.request('/api/me/export/planning?section=batches', {
      headers: { cookie },
    });
    expect(await batches.json()).toEqual({
      section: 'batches',
      items: [
        {
          id: made.batchId,
          foodId: made.foodId,
          rawWeightG: 600,
          cookedWeightG: 1680,
          cookedOn: '2026-10-14',
          note: null,
          yield: 2.8,
        },
      ],
      nextCursor: null,
    });
  });

  it('pages foods by id with the cursor, each once', async () => {
    const { cookie } = await t.createSignedInUser('foods@example.test');
    const send = sender(t, cookie);
    const ids: string[] = [];
    for (const name of ['Rice', 'Potato', 'Okra']) {
      const id = randomUUID();
      ids.push(id);
      const res = await send('POST', '/api/foods', {
        id,
        name,
        state: 'raw',
        basis: { kind: 'per_100g', grams: null },
        energyKcal: 100,
        proteinG: 1,
        carbG: 20,
        fatG: 0,
        fiberG: 1,
        source: 'manual',
      });
      expect(res.status).toBe(201);
    }
    const first = await exportOf(cookie, 'section=foods&limit=2');
    expect(first.items).toHaveLength(2);
    const second = await exportOf(cookie, `section=foods&limit=2&cursor=${first.nextCursor ?? ''}`);
    expect(second.nextCursor).toBeNull();
    expect([...first.items, ...second.items].map((item) => item['id'])).toEqual(ids.toSorted());
  });

  it('pages weigh-ins newest first with the cursor, each once', async () => {
    const { cookie } = await t.createSignedInUser('weights@example.test');
    const send = sender(t, cookie);
    const start = Date.parse('2026-10-01T22:00:00Z');
    const ids: string[] = [];
    for (let day = 0; day < 5; day += 1) {
      const id = randomUUID();
      ids.push(id);
      const res = await send('POST', '/api/weigh-ins', {
        id,
        measuredAt: new Date(start + day * 24 * 60 * 60 * 1000).toISOString(),
        weightKg: 82 - day / 10,
      });
      expect(res.status).toBe(201);
    }
    const seen: unknown[] = [];
    let cursor: string | null = null;
    do {
      const page = await exportOf(
        cookie,
        `section=weighIns&limit=2${cursor === null ? '' : `&cursor=${cursor}`}`,
      );
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items.map((item) => item['id']));
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(seen).toEqual(ids.toReversed());
  });

  it('pages workouts with the cursor, each once', async () => {
    const { cookie } = await t.createSignedInUser('pages@example.test');
    const send = sender(t, cookie);
    const start = Date.now() - 10 * 24 * 60 * 60 * 1000;
    const ids = [0, 1, 2].map(() => randomUUID());
    const workouts = ids.map((id, index) => {
      const stamp = new Date(start + index * 60 * 60 * 1000).toISOString();
      return {
        id,
        routineId: null,
        name: 'Legs',
        startedAt: stamp,
        endedAt: stamp,
        note: null,
        clientUpdatedAt: stamp,
      };
    });
    expect((await send('POST', '/api/workouts/sync', { workouts })).status).toBe(200);

    const first = await exportOf(cookie, 'section=workouts&limit=2');
    expect(first.items.map((item) => item['id'])).toEqual([ids[2], ids[1]]);
    expect(first.nextCursor).not.toBeNull();
    const second = await exportOf(
      cookie,
      `section=workouts&limit=2&cursor=${first.nextCursor ?? ''}`,
    );
    expect(second.items.map((item) => item['id'])).toEqual([ids[0]]);
    expect(second.nextCursor).toBeNull();
  });

  it('pages exercises and routines without repeating items or accepting another section’s cursor', async () => {
    const { cookie } = await t.createSignedInUser('lists@example.test');
    const made = await fillAccount(t, cookie);
    const send = sender(t, cookie);
    const secondRoutineId = randomUUID();
    expect(
      (
        await send('POST', '/api/routines', {
          id: secondRoutineId,
          name: 'Second',
          exercises: [{ id: randomUUID(), exerciseId: made.customId }],
        })
      ).status,
    ).toBe(201);

    let exercisesCursor: string | null = null;
    for (const section of ['exercises', 'routines'] as const) {
      const response = await send(
        'GET',
        section === 'exercises' ? '/api/exercises?includeHidden=true' : '/api/routines',
      );
      expect(response.status).toBe(200);
      const whole: { items: { id: string }[] } = await response.json();
      const ids: unknown[] = [];
      let cursor: string | null = null;
      do {
        const page = await exportOf(
          cookie,
          `section=${section}&limit=13${cursor === null ? '' : `&cursor=${cursor}`}`,
        );
        expect(page.items.length).toBeGreaterThan(0);
        expect(page.items.length).toBeLessThanOrEqual(13);
        ids.push(...page.items.map((item) => item['id']));
        cursor = page.nextCursor;
        if (section === 'exercises' && ids.length === 13) {
          exercisesCursor = cursor;
        }
      } while (cursor !== null);
      expect(ids).toEqual(whole.items.map((item) => item.id));
    }
    expect(exercisesCursor).not.toBeNull();
    const wrong = await t.app.request(`/api/me/export?section=routines&cursor=${exercisesCursor}`, {
      headers: { cookie },
    });
    expect(wrong.status).toBe(400);
    const profile = await t.app.request(
      `/api/me/export?section=profile&cursor=${exercisesCursor}`,
      { headers: { cookie } },
    );
    expect(profile.status).toBe(400);
  });

  it('carries none of another user’s rows', async () => {
    const owner = await t.createSignedInUser('mine@example.test');
    const made = await fillAccount(t, owner.cookie);
    const other = await t.createSignedInUser('theirs@example.test');

    const profile = await exportOf(other.cookie, 'section=profile');
    expect(profile.items).toEqual([
      { user: expect.objectContaining({ id: other.user.id }), profile: null },
    ]);
    const exercises = await exportAll(other.cookie, 'exercises');
    expect(exercises.map((item) => item['id'])).not.toContain(made.customId);
    expect(exercises.some((item) => item['hidden'] === true)).toBe(false);
    expect((await exportOf(other.cookie, 'section=routines')).items).toEqual([]);
    expect((await exportOf(other.cookie, 'section=workouts')).items).toEqual([]);
    expect((await exportOf(other.cookie, 'section=weighIns')).items).toEqual([]);
    expect((await exportOf(other.cookie, 'section=foods')).items).toEqual([]);
    expect((await exportOf(other.cookie, 'section=rotationGroups')).items).toEqual([]);
    const batches = await t.app.request('/api/me/export/planning?section=batches', {
      headers: { cookie: other.cookie },
    });
    const theirs: { items: unknown[] } = await batches.json();
    expect(theirs.items).toEqual([]);
  });
});
