import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { WEB_ORIGIN, type useTestApp } from './harness';

// An account with a row in every table a member writes, for the export and the deletion (S10): a
// profile, a custom exercise with its setting, a hidden seeded exercise, a routine using the custom
// exercise, a finished workout that logged it, one still in progress, a set deleted through the
// sync batch so its tombstone exists, a typed weigh-in (M2), a food in a rotation group with a
// second food archived (M2 slice 3), and a batch of the first (M2 slice 6).

type TestApp = ReturnType<typeof useTestApp>;

export function sender(t: TestApp, cookie: string) {
  return async (method: string, path: string, body?: unknown) =>
    t.app.request(path, {
      method,
      headers: { cookie, 'Content-Type': 'application/json', Origin: WEB_ORIGIN },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
}

const MINUTE_MS = 60 * 1000;

/** A setting that changes nothing: every value the exercise's default. */
const noSetting = {
  incrementKg: null,
  restSeconds: null,
  repLow: null,
  repHigh: null,
  hidden: false,
};

function workoutRows(exerciseId: string, startedAt: Date, open: boolean) {
  const stamp = startedAt.toISOString();
  const workout = {
    id: randomUUID(),
    routineId: null,
    name: open ? 'Pull B' : 'Push A',
    startedAt: stamp,
    endedAt: open ? null : new Date(startedAt.getTime() + 50 * MINUTE_MS).toISOString(),
    note: null,
    clientUpdatedAt: stamp,
  };
  const workoutExercise = {
    id: randomUUID(),
    workoutId: workout.id,
    exerciseId,
    routineExerciseId: null,
    position: 0,
    targetSets: 3,
    repLow: 6,
    repHigh: 10,
    incrementKg: 2.5,
    clientUpdatedAt: stamp,
  };
  const sets = [0, 1].map((position) => ({
    id: randomUUID(),
    workoutExerciseId: workoutExercise.id,
    position,
    weightKg: 40,
    reps: 10,
    rir: null,
    rpe: null,
    isWarmup: false,
    performedAt: new Date(startedAt.getTime() + (position + 1) * MINUTE_MS).toISOString(),
    clientUpdatedAt: stamp,
  }));
  return { workout, workoutExercise, sets };
}

async function ok(res: Promise<Response>, status: number) {
  const answered = await res;
  expect(answered.status).toBe(status);
  return answered.json();
}

export async function fillAccount(t: TestApp, cookie: string) {
  const send = sender(t, cookie);

  await ok(send('PATCH', '/api/me/profile', { timezone: 'Asia/Tokyo', weightUnit: 'kg' }), 200);

  const customId = randomUUID();
  await ok(
    send('POST', '/api/exercises', { id: customId, name: 'Cable Y-Raise', equipment: 'cable' }),
    201,
  );
  await ok(
    send('PUT', `/api/exercises/${customId}/setting`, { ...noSetting, restSeconds: 90 }),
    200,
  );
  const seeded: { items: { id: string; custom: boolean }[] } = await ok(
    send('GET', '/api/exercises'),
    200,
  );
  const hiddenId = seeded.items.find((each) => !each.custom)?.id;
  if (hiddenId === undefined) throw new Error('no seeded exercise');
  await ok(send('PUT', `/api/exercises/${hiddenId}/setting`, { ...noSetting, hidden: true }), 200);

  const routineId = randomUUID();
  await ok(
    send('POST', '/api/routines', {
      id: routineId,
      name: 'Shoulders',
      exercises: [{ id: randomUUID(), exerciseId: customId }],
    }),
    201,
  );

  const finished = workoutRows(customId, new Date(Date.now() - 2 * 24 * 60 * MINUTE_MS), false);
  const open = workoutRows(customId, new Date(Date.now() - 10 * MINUTE_MS), true);
  const stored: { results: { status: string }[] } = await ok(
    send('POST', '/api/workouts/sync', {
      workouts: [finished.workout, open.workout],
      workoutExercises: [finished.workoutExercise, open.workoutExercise],
      sets: [...finished.sets, ...open.sets],
    }),
    200,
  );
  expect(stored.results.every((each) => each.status === 'stored')).toBe(true);

  // The second set of the finished workout, deleted: it leaves a tombstone.
  const removed = finished.sets[1];
  if (removed === undefined) throw new Error('no second set');
  const deleted: { results: { status: string }[] } = await ok(
    send('POST', '/api/workouts/sync', {
      sets: [
        {
          id: removed.id,
          deletedAt: new Date(
            new Date(removed.clientUpdatedAt).getTime() + MINUTE_MS,
          ).toISOString(),
        },
      ],
    }),
    200,
  );
  expect(deleted.results.every((each) => each.status !== 'refused')).toBe(true);

  const weighIn = {
    id: randomUUID(),
    measuredAt: new Date(Date.now() - 24 * 60 * MINUTE_MS).toISOString(),
    weightKg: 82.4,
    bodyFatPct: 18.5,
  };
  await ok(send('POST', '/api/weigh-ins', weighIn), 201);

  const groupId = randomUUID();
  await ok(send('POST', '/api/rotation-groups', { id: groupId, name: 'Starch', foodIds: [] }), 201);
  const foodId = randomUUID();
  await ok(
    send('POST', '/api/foods', {
      id: foodId,
      name: 'White rice',
      state: 'cooked',
      basis: { kind: 'per_100g', grams: null },
      energyKcal: 156,
      proteinG: 2.5,
      carbG: 34.6,
      fatG: 0.3,
      fiberG: 1.5,
      keepsDays: 3,
      source: 'mext',
      sourceRef: '01088',
      rotationGroupId: groupId,
    }),
    201,
  );
  const archivedFoodId = randomUUID();
  await ok(
    send('POST', '/api/foods', {
      id: archivedFoodId,
      name: 'Okra',
      state: 'raw',
      basis: { kind: 'per_100g', grams: null },
      energyKcal: 26,
      proteinG: 2.1,
      carbG: 2.2,
      fatG: 0.2,
      fiberG: 5,
      source: 'manual',
    }),
    201,
  );
  const archived = await send('DELETE', `/api/foods/${archivedFoodId}`);
  expect(archived.status).toBe(204);
  const batchId = randomUUID();
  await ok(
    send('POST', '/api/batches', {
      id: batchId,
      foodId,
      rawWeightG: 600,
      cookedWeightG: 1680,
      cookedOn: '2026-10-14',
    }),
    201,
  );

  return {
    customId,
    hiddenId,
    routineId,
    finished,
    open,
    removedSetId: removed.id,
    weighIn,
    groupId,
    foodId,
    archivedFoodId,
    batchId,
  };
}
