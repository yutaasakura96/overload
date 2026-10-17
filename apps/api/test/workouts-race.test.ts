import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { set, syncTombstone, workout } from '../src/db/schema';
import { WEB_ORIGIN, useTestApp } from './harness';

// Two requests at once (docs/11 §1): two tabs uploading, the same set sent twice, a stale copy
// racing its own delete. A rolled-back test transaction would run them one after the other on one
// connection, so this file commits, on several connections, and deletes its users after each test.
const t = useTestApp({ committed: true });

type Result = { table: string; id: string; status: string };

async function sync(cookie: string, batch: Record<string, unknown[]>) {
  const res = await t.app.request('/api/workouts/sync', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json', Origin: WEB_ORIGIN },
    body: JSON.stringify(batch),
  });
  expect(res.status).toBe(200);
  const body: { results: Result[] } = await res.json();
  return body.results;
}

const at = (iso: string) => new Date(iso).toISOString();
const started = at('2026-11-11T09:01:40Z');

async function benchId(cookie: string) {
  const res = await t.app.request('/api/exercises', { headers: { cookie } });
  const body: { items: { id: string; name: string }[] } = await res.json();
  const found = body.items.find((item) => item.name === 'Barbell Bench Press');
  if (found === undefined) throw new Error('no bench press');
  return found.id;
}

/** A workout of one exercise with `count` sets, as a batch nothing has uploaded yet. */
async function workoutOf(cookie: string, count: number) {
  const w = {
    id: randomUUID(),
    routineId: null,
    name: 'Push A',
    startedAt: started,
    endedAt: null,
    note: null,
    clientUpdatedAt: started,
  };
  const we = {
    id: randomUUID(),
    workoutId: w.id,
    exerciseId: await benchId(cookie),
    routineExerciseId: null,
    position: 0,
    targetSets: 3,
    repLow: 6,
    repHigh: 10,
    incrementKg: 2.5,
    clientUpdatedAt: started,
  };
  const sets = Array.from({ length: count }, (_, position) => ({
    id: randomUUID(),
    workoutExerciseId: we.id,
    position,
    weightKg: 80,
    reps: 10,
    rir: null,
    rpe: null,
    isWarmup: false,
    performedAt: started,
    clientUpdatedAt: started,
  }));
  return { workouts: [w], workoutExercises: [we], sets };
}

const storedSets = (workoutExerciseId: string) =>
  t.db.select({ id: set.id }).from(set).where(eq(set.workoutExerciseId, workoutExerciseId));

describe('two requests at once (docs/03 §8.1)', () => {
  it('stores the same set once when it is sent twice at the same moment', async () => {
    const { cookie } = await t.createSignedInUser(`twice-${randomUUID()}@example.test`);
    const batch = await workoutOf(cookie, 1);

    const [first, second] = await Promise.all([sync(cookie, batch), sync(cookie, batch)]);

    // Every row is stored by one request and found unchanged by the other.
    for (const [index, result] of first.entries()) {
      expect(new Set([result.status, second[index]?.status])).toEqual(
        new Set(['stored', 'unchanged']),
      );
    }
    expect(await storedSets(batch.workoutExercises[0]?.id ?? '')).toHaveLength(1);
  });

  it('stores each set once when two tabs upload overlapping batches', async () => {
    const { cookie } = await t.createSignedInUser(`tabs-${randomUUID()}@example.test`);
    const batch = await workoutOf(cookie, 12);
    // One tab holds the first eight sets, the other the last eight: four are in both.
    const tab = (from: number, to: number) => ({ ...batch, sets: batch.sets.slice(from, to) });

    const answers = await Promise.all([sync(cookie, tab(0, 8)), sync(cookie, tab(4, 12))]);

    expect(answers.flat().every((r) => r.status === 'stored' || r.status === 'unchanged')).toBe(
      true,
    );
    const stored = await storedSets(batch.workoutExercises[0]?.id ?? '');
    expect(stored.map((row) => row.id).toSorted()).toEqual(
      batch.sets.map((row) => row.id).toSorted(),
    );
  });

  it('leaves a set deleted when its stale copy and its delete arrive together', async () => {
    const { cookie } = await t.createSignedInUser(`stale-${randomUUID()}@example.test`);
    const batch = await workoutOf(cookie, 20);
    await sync(cookie, batch);
    const deletedAt = at('2026-11-11T11:00:00Z');

    // One tab deletes every set while another, which never heard, sends its copies again.
    await Promise.all([
      sync(cookie, { sets: batch.sets.map(({ id }) => ({ id, deletedAt })) }),
      sync(cookie, { sets: batch.sets }),
      sync(cookie, { sets: batch.sets.toReversed() }),
    ]);

    expect(await storedSets(batch.workoutExercises[0]?.id ?? '')).toHaveLength(0);
    // And once the delete has landed, the copy is turned away for good.
    const late = await sync(cookie, { sets: batch.sets });
    expect(late.every((r) => r.status === 'deleted')).toBe(true);
  });

  it('leaves a workout the server never had deleted when its upload and its delete arrive together', async () => {
    const { cookie } = await t.createSignedInUser(`unseen-${randomUUID()}@example.test`);
    const batches = await Promise.all(Array.from({ length: 10 }, () => workoutOf(cookie, 2)));
    const deletedAt = at('2026-11-11T11:00:00Z');

    await Promise.all(
      batches.flatMap((batch) => [
        sync(cookie, batch),
        sync(cookie, { workouts: batch.workouts.map(({ id }) => ({ id, deletedAt })) }),
      ]),
    );

    const ids = batches.map((batch) => batch.workouts[0]?.id ?? '');
    expect(await t.db.select().from(workout).where(inArray(workout.id, ids))).toHaveLength(0);
    const buried = await t.db
      .select({ id: syncTombstone.id })
      .from(syncTombstone)
      .where(inArray(syncTombstone.id, ids));
    expect(buried).toHaveLength(ids.length);
  });
});
