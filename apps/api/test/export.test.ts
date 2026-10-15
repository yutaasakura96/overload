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

  it.each([
    '',
    'section=foods',
    'section=workouts&limit=0',
    'section=workouts&cursor=nope',
    'section=profile&cursor=nope',
    'section=exercises&cursor=nope',
    'section=routines&cursor=nope',
  ])(
    'refuses %j as a bad request',
    async (query) => {
      const { cookie } = await t.createSignedInUser('bad@example.test');
      const res = await t.app.request(`/api/me/export?${query}`, { headers: { cookie } });
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('bad_request');
    },
  );

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

    const exercises = await exportOf(cookie, 'section=exercises');
    expect(exercises.nextCursor).toBeNull();
    expect(exercises.items).toContainEqual(
      expect.objectContaining({ id: made.customId, custom: true, restSeconds: 90 }),
    );
    // Hidden ones are included, with the caller's settings.
    expect(exercises.items).toContainEqual(
      expect.objectContaining({ id: made.hiddenId, hidden: true }),
    );

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

  it('carries none of another user’s rows', async () => {
    const owner = await t.createSignedInUser('mine@example.test');
    const made = await fillAccount(t, owner.cookie);
    const other = await t.createSignedInUser('theirs@example.test');

    const profile = await exportOf(other.cookie, 'section=profile');
    expect(profile.items).toEqual([
      { user: expect.objectContaining({ id: other.user.id }), profile: null },
    ]);
    const exercises = await exportOf(other.cookie, 'section=exercises');
    expect(exercises.items.map((item) => item['id'])).not.toContain(made.customId);
    expect(exercises.items.some((item) => item['hidden'] === true)).toBe(false);
    expect((await exportOf(other.cookie, 'section=routines')).items).toEqual([]);
    expect((await exportOf(other.cookie, 'section=workouts')).items).toEqual([]);
  });
});
