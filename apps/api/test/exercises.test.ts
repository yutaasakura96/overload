import { asc, isNull, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { exercise, exerciseSetting } from '../src/db/schema';
import { useTestApp } from './harness';

// S8, read-only in slice 1. The cross-user read proves the rule in apps/api/src/db/, not the route:
// user B's custom exercise and B's settings are in the fixture, and A's GET must not see them
// (docs/06, 2026-09-24).
const t = useTestApp();

type Item = {
  id: string;
  name: string;
  equipment: string;
  muscleGroup: string | null;
  aliases: string[];
  custom: boolean;
  hidden: boolean;
  incrementKg: number;
  restSeconds: number;
  repLow: number;
  repHigh: number;
  overrides: Record<string, boolean>;
};

async function list(cookie: string, query = '') {
  const res = await t.app.request(`/api/exercises${query}`, { headers: { cookie } });
  expect(res.status).toBe(200);
  const body: { items: Item[] } = await res.json();
  return body.items;
}

async function addCustomExercise(ownerUserId: string, name: string) {
  const [row] = await t.db
    .insert(exercise)
    .values({ ownerUserId, name, equipment: 'cable', defaultIncrementKg: 1 })
    .returning({ id: exercise.id });
  if (row === undefined) throw new Error('exercise insert returned no row');
  return row;
}

describe('GET /api/exercises', () => {
  it('returns the seeded library, sorted by name, each with its defaults', async () => {
    const { cookie } = await t.createSignedInUser('reader@example.test');

    const items = await list(cookie);

    expect(items).toHaveLength(185);
    const names = items.map((item) => item.name);
    const ordered = await t.db
      .select({ name: exercise.name })
      .from(exercise)
      .where(isNull(exercise.ownerUserId))
      .orderBy(sql`lower(${exercise.name})`, asc(exercise.id));
    expect(names).toEqual(ordered.map((row) => row.name));
    expect(items.find((item) => item.name === 'Barbell Bench Press')).toEqual({
      id: expect.any(String),
      name: 'Barbell Bench Press',
      equipment: 'barbell',
      muscleGroup: 'chest',
      aliases: ['Flat Bench'],
      custom: false,
      hidden: false,
      incrementKg: 2.5,
      restSeconds: 180,
      repLow: 6,
      repHigh: 10,
      overrides: { incrementKg: false, restSeconds: false, repLow: false, repHigh: false },
    });
  });

  it('files every seeded exercise under a muscle group, and a custom one under none', async () => {
    const { cookie, user } = await t.createSignedInUser('groups@example.test');
    const custom = await addCustomExercise(user.id, 'Cable Y-Raise');

    const items = await list(cookie);

    const seeded = items.filter((item) => !item.custom);
    expect(seeded.filter((item) => item.muscleGroup === null)).toEqual([]);
    expect(new Set(seeded.map((item) => item.muscleGroup))).toEqual(
      new Set([
        'chest',
        'back',
        'shoulders',
        'biceps',
        'triceps',
        'forearms',
        'quads',
        'hamstrings',
        'glutes',
        'calves',
        'core',
      ]),
    );
    expect(items.find((item) => item.id === custom.id)).toMatchObject({
      muscleGroup: null,
      aliases: [],
    });
  });

  it('carries the other names search matches, and the one rename (issue #39)', async () => {
    const { cookie } = await t.createSignedInUser('aliases@example.test');

    const items = await list(cookie);

    expect(items.find((item) => item.name === 'Barbell Romanian Deadlift')?.aliases).toEqual([
      'RDL',
    ]);
    expect(items.find((item) => item.name === 'Smith Machine Squat')).toMatchObject({
      equipment: 'machine_plate',
      incrementKg: 2.5,
      muscleGroup: 'quads',
    });
    expect(items.map((item) => item.name)).not.toContain('Dumbbell Fly');
    expect(items.find((item) => item.name === 'Dumbbell Chest Fly')?.muscleGroup).toBe('chest');
  });

  it('seeds each equipment class with its increment (docs/04)', async () => {
    const { cookie } = await t.createSignedInUser('increments@example.test');

    const byClass = new Map<string, Set<number>>();
    for (const item of await list(cookie)) {
      byClass.set(item.equipment, (byClass.get(item.equipment) ?? new Set()).add(item.incrementKg));
    }
    expect(Object.fromEntries([...byClass].map(([k, v]) => [k, [...v]]))).toEqual({
      barbell: [2.5],
      dumbbell: [1],
      machine_plate: [2.5],
      machine_stack: [5],
      cable: [2.5],
      bodyweight: [0],
    });
  });

  it('never shows another user’s custom exercise or settings', async () => {
    const a = await t.createSignedInUser('a@example.test');
    const b = await t.createSignedInUser('b@example.test');
    const custom = await addCustomExercise(b.user.id, 'Cable Y-Raise');
    const [bench] = (await list(a.cookie)).filter((item) => item.name === 'Barbell Bench Press');
    await t.db
      .insert(exerciseSetting)
      .values({ userId: b.user.id, exerciseId: bench!.id, restSeconds: 240 });

    const seenByA = await list(a.cookie, '?includeHidden=true');
    expect(seenByA.map((item) => item.id)).not.toContain(custom.id);
    expect(seenByA.find((item) => item.id === bench!.id)).toMatchObject({
      restSeconds: 180,
      overrides: { restSeconds: false },
    });

    const seenByB = await list(b.cookie);
    expect(seenByB.find((item) => item.id === custom.id)).toMatchObject({
      name: 'Cable Y-Raise',
      custom: true,
    });
    expect(seenByB.find((item) => item.id === bench!.id)).toMatchObject({
      restSeconds: 240,
      overrides: { restSeconds: true, incrementKg: false },
    });
  });

  it('leaves out the caller’s hidden exercises unless includeHidden=true', async () => {
    const { user, cookie } = await t.createSignedInUser('hider@example.test');
    const [first] = await list(cookie);
    await t.db
      .insert(exerciseSetting)
      .values({ userId: user.id, exerciseId: first!.id, hiddenAt: new Date() });

    expect((await list(cookie)).map((item) => item.id)).not.toContain(first!.id);
    expect(
      (await list(cookie, '?includeHidden=true')).find((item) => item.id === first!.id),
    ).toMatchObject({
      hidden: true,
    });
  });

  it('answers 400 bad_request to a malformed query parameter', async () => {
    const { cookie } = await t.createSignedInUser('typo@example.test');

    const res = await t.app.request('/api/exercises?includeHidden=yes', { headers: { cookie } });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: 'bad_request',
      detail: 'Invalid parameter: includeHidden',
    });
  });
});
