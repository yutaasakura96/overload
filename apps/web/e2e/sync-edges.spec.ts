import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { apiFixture } from './fixture';

type Cookies = Parameters<BrowserContext['addCookies']>[0];

type StoredSet = { weightKg: number; reps: number; rir: number | null; isWarmup: boolean };
type StoredWorkout = { name: string; endedAt: string | null; exercises: { sets: StoredSet[] }[] };

type SyncBody = {
  workouts?: { id: string }[];
  workoutExercises?: { id: string }[];
  sets?: { id: string; deletedAt?: string; reps?: number }[];
};

// The hard edges of set upload (docs/03 §8.1, docs/11 §2): the same set sent twice, a set refused
// inside a 200 batch, an edit and a delete made offline, a stale copy after a delete, two tabs, and
// the workout rebuilt after the app is killed. A user of its own, and routines made through the
// API, so nothing here depends on the routine screens.
const EMAIL = 'sync-edges@example.test';
let userId = '';

const stored = (): StoredWorkout[] => JSON.parse(apiFixture('workouts', userId));
/** The first exercise's sets of the workout with this name, as the server holds them. */
const setsOf = (name: string) =>
  stored()
    .find((workout) => workout.name === name)
    ?.exercises[0]?.sets.map((set) => [set.weightKg, set.reps]);

test.beforeAll(() => {
  const created: { userId: string } = JSON.parse(apiFixture('user', EMAIL));
  ({ userId } = created);
});

test.afterAll(() => {
  apiFixture('delete', EMAIL);
});

test.beforeEach(async ({ context }) => {
  const cookies: Cookies = JSON.parse(apiFixture('cookies', userId, 'localhost'));
  await context.addCookies(cookies);
});

const dataState = (page: Page) => page.locator('.data-state');
const rest = (page: Page) => page.getByRole('region', { name: 'Rest timer' });

/** A profile and a routine of two exercises, five sets of the first, then its workout started. */
async function startWorkout(page: Page, name: string) {
  const profile = await page.request.patch('/api/me/profile', { data: { timezone: 'Asia/Tokyo' } });
  expect(profile.ok()).toBe(true);
  const library = await page.request.get('/api/exercises');
  const { items }: { items: { id: string; restSeconds: number }[] } = await library.json();
  // Any two that rest long enough for a rest to be watched; which exercises they are is no matter.
  const [first, second] = items.filter((item) => item.restSeconds >= 90);
  if (first === undefined || second === undefined) throw new Error('the library is too small');
  const routine = await page.request.post('/api/routines', {
    data: {
      id: randomUUID(),
      name,
      exercises: [
        { id: randomUUID(), exerciseId: first.id, targetSets: 5 },
        { id: randomUUID(), exerciseId: second.id },
      ],
    },
  });
  expect(routine.ok()).toBe(true);
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(`${name}.*Start this workout`) }).click();
  await expect(page).toHaveURL('/workout');
  return { restSeconds: first.restSeconds };
}

async function completeSet(page: Page, weight: string, reps: string) {
  const typedReps = page.getByRole('textbox', { name: 'Reps', exact: true });
  await page.getByRole('textbox', { name: /^Weight in/ }).fill(weight);
  await typedReps.fill(reps);
  await page.getByRole('button', { name: 'Complete set' }).click();
  // The card that takes the next set opens empty: until then a figure typed would be lost.
  await expect(typedReps).toHaveValue('');
}

/**
 * A row of the set table: its number, weight and reps, and `Done` or `Refused`. The tests share a
 * user, so a row may also show last time's figures, which are no part of what is checked here.
 */
const setRow = (page: Page, row: string, word: 'Done' | 'Refused' = 'Done') => {
  const [number, weight, reps] = row.split(' ');
  return page.getByRole('row', {
    name: new RegExp(`^${number} (\\S+ × \\S+ )?${weight} ${reps} — ${word}$`),
  });
};

async function finish(page: Page) {
  await page.getByRole('button', { name: 'Finish workout' }).click();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page).toHaveURL('/');
}

async function goOffline(context: BrowserContext) {
  await context.setOffline(true);
  await context.route('**/api/**', (route) => route.abort('internetdisconnected'));
}

async function goOnline(context: BrowserContext) {
  await context.unrouteAll();
  await context.setOffline(false);
}

/** Every sync batch the pages of this context send from here on. */
function watchSync(context: BrowserContext) {
  const bodies: SyncBody[] = [];
  context.on('request', (request) => {
    if (request.url().endsWith('/api/workouts/sync')) bodies.push(request.postDataJSON());
  });
  return bodies;
}

/** The set store's records, read over a connection of the test's own. */
function recordsOnDevice(page: Page) {
  return page.evaluate(
    () =>
      new Promise<
        {
          id: string;
          table: string;
          state: string;
          deletedAt?: string;
          row: Record<string, unknown> & { clientUpdatedAt: string; position?: number };
        }[]
      >((resolve, reject) => {
        const open = indexedDB.open('overload-sets');
        open.addEventListener('error', () => reject(open.error));
        open.addEventListener('success', () => {
          const all = open.result.transaction('rows', 'readonly').objectStore('rows').getAll();
          all.addEventListener('error', () => reject(all.error));
          all.addEventListener('success', () => {
            open.result.close();
            resolve(all.result);
          });
        });
      }),
  );
}

/**
 * Rewrites one logged set on the device, as a build with looser rules would have left it. The
 * screen refuses such figures before it writes them, so this is the only way one gets there.
 */
function rewriteSet(page: Page, position: number, fields: Record<string, number>) {
  return page.evaluate(
    ({ position: at, fields: changed }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('overload-sets');
        open.addEventListener('error', () => reject(open.error));
        open.addEventListener('success', () => {
          const transaction = open.result.transaction('rows', 'readwrite');
          const rows = transaction.objectStore('rows');
          const all = rows.getAll();
          all.addEventListener('success', () => {
            const record = all.result.find(
              (each) => each.table === 'sets' && each.row.position === at,
            );
            rows.put({ ...record, row: { ...record.row, ...changed } });
          });
          transaction.addEventListener('error', () => reject(transaction.error));
          transaction.addEventListener('complete', () => {
            open.result.close();
            resolve();
          });
        });
      }),
    { position, fields },
  );
}

function rewriteWorkoutVersion(page: Page, id: string, clientUpdatedAt: string) {
  return page.evaluate(
    ({ id, clientUpdatedAt }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('overload-sets');
        open.addEventListener('error', () => reject(open.error));
        open.addEventListener('success', () => {
          const transaction = open.result.transaction('rows', 'readwrite');
          const rows = transaction.objectStore('rows');
          const get = rows.get(id);
          get.addEventListener('success', () => {
            rows.put({
              ...get.result,
              row: { ...get.result.row, clientUpdatedAt },
            });
          });
          transaction.addEventListener('error', () => reject(transaction.error));
          transaction.addEventListener('complete', () => {
            open.result.close();
            resolve();
          });
        });
      }),
    { id, clientUpdatedAt },
  );
}

test('a set whose answer was lost is sent again and stored once', async ({ page, context }) => {
  const name = `Twice ${Date.now()}`;
  await startWorkout(page, name);
  await expect(dataState(page)).toContainText('SYNCED');

  // The batch reaches the server and its answer never reaches the app: the app's own request
  // fails, and the test delivers the same body. Playwright's WebKit cannot drop only a response.
  await goOffline(context);
  const sent = watchSync(context);
  await completeSet(page, '60', '8');
  await expect(setRow(page, '1 60 8')).toBeVisible();
  await expect(dataState(page)).toHaveText('1 PENDING');
  await expect.poll(() => sent.length).toBeGreaterThan(0);
  const [lost] = sent;
  const delivered = await page.request.post('/api/workouts/sync', { data: lost });
  const { results }: { results: { status: string }[] } = await delivered.json();
  expect(results.map((result) => result.status)).toEqual(['stored']);
  expect(setsOf(name)).toEqual([[60, 8]]);

  // The uploader sends the same row again by itself, and the server still holds it once.
  sent.length = 0;
  await goOnline(context);
  await expect(dataState(page)).toContainText('SYNCED');
  expect(sent.map((body) => body.sets?.map((set) => set.id))).toEqual([[lost?.sets?.[0]?.id]]);
  expect(setsOf(name)).toEqual([[60, 8]]);

  await finish(page);
});

test('a set refused inside a 200 batch is kept, then edited or discarded, offline too', async ({
  page,
  context,
}) => {
  const name = `Refused ${Date.now()}`;
  await startWorkout(page, name);
  await completeSet(page, '60', '8');
  await expect(dataState(page)).toContainText('SYNCED');
  await expect.poll(() => setsOf(name)).toEqual([[60, 8]]);

  // Three more sets with no signal. Two are left as an older build could have written them.
  await goOffline(context);
  await completeSet(page, '60', '7');
  await completeSet(page, '60', '6');
  await completeSet(page, '60', '5');
  await expect(dataState(page)).toHaveText('3 PENDING');
  await rewriteSet(page, 1, { reps: 500 });
  await rewriteSet(page, 2, { weightKg: 99999 });
  const sent = watchSync(context);
  const answers: number[] = [];
  page.on('response', (response) => {
    if (response.url().endsWith('/api/workouts/sync')) answers.push(response.status());
  });

  // One batch, one 200: the good set is stored, and the two the server turns away stay, each
  // with the word, the reason and what to do about it.
  await goOnline(context);
  await expect(dataState(page)).toHaveText('2 REFUSED');
  expect(answers).toEqual([200]);
  expect(setsOf(name)).toEqual([
    [60, 8],
    [60, 5],
  ]);
  await expect(setRow(page, '2 60 500', 'Refused')).toBeVisible();
  await expect(page.getByText('Reps over 100')).toBeVisible();
  await expect(page.getByText('Weight over 9999.99 kg')).toBeVisible();
  await expect(setRow(page, '4 60 5')).toBeVisible();
  // They are still sets of this workout: the next one is the fifth.
  await expect(page.getByRole('region', { name: 'SET 5 OF 5' })).toBeVisible();

  // With no signal again, one is edited and the other discarded. Edit refuses what the server
  // would; Discard asks first.
  await goOffline(context);
  await page.getByRole('button', { name: 'Edit set 2' }).click();
  const reps = page.getByRole('textbox', { name: 'Reps of set 2' });
  await expect(page.getByRole('textbox', { name: 'Weight of set 2 in kilograms' })).toBeFocused();
  await reps.fill('0');
  await page.getByRole('button', { name: 'Save set' }).click();
  await expect(page.getByRole('alert')).toContainText('Reps are a whole number, 1 to 100');
  await expect(reps).toBeFocused();
  await reps.fill('9');
  await page.getByRole('button', { name: 'Save set' }).click();
  await expect(setRow(page, '2 60 9')).toBeVisible();
  await expect(dataState(page)).toHaveText('1 REFUSED');

  await page.getByRole('button', { name: 'Discard set 3' }).click();
  await expect(page.getByText('Discard set 3? It is removed from this device')).toBeVisible();
  await page.getByRole('button', { name: 'Keep', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Discard set 3' })).toBeFocused();
  await page.getByRole('button', { name: 'Discard set 3' }).click();
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.getByRole('row', { name: /99999/ })).toHaveCount(0);
  await expect(setRow(page, '3 60 5')).toBeVisible();
  await expect(dataState(page)).toHaveText('1 PENDING');

  // The edit and the delete travel in the same batch, and both apply.
  sent.length = 0;
  await goOnline(context);
  await expect(dataState(page)).toContainText('SYNCED');
  expect(sent).toHaveLength(1);
  const [edited, deleted] = sent[0]?.sets ?? [];
  expect(edited?.reps).toBe(9);
  expect(deleted?.deletedAt).toBeDefined();
  expect(sent[0]?.sets).toHaveLength(2);
  expect(setsOf(name)).toEqual([
    [60, 8],
    [60, 9],
    [60, 5],
  ]);
  const onDevice = await recordsOnDevice(page);
  expect(onDevice.some((record) => record.id === deleted?.id)).toBe(false);

  // A stale copy of the discarded set, sent after its delete, does not bring it back.
  const stale = await page.request.post('/api/workouts/sync', {
    data: { sets: [{ ...edited, id: deleted?.id, position: 2 }] },
  });
  expect((await stale.json()).results).toEqual([
    { table: 'sets', id: deleted?.id, status: 'deleted' },
  ]);
  expect(setsOf(name)).toHaveLength(3);

  await finish(page);
});

test('a set refused after its workout ended is acted on from Today', async ({ page, context }) => {
  const name = `Ended ${Date.now()}`;
  await startWorkout(page, name);
  await expect(dataState(page)).toContainText('SYNCED');

  // The whole workout is logged and finished with no signal.
  await goOffline(context);
  await completeSet(page, '60', '8');
  await completeSet(page, '60', '7');
  await rewriteSet(page, 1, { reps: 500 });
  await finish(page);
  await goOnline(context);

  // The workout is over, so its refused set has no workout screen to be on: Today holds it.
  await expect(dataState(page)).toHaveText('1 REFUSED');
  const refused = page.getByRole('region', { name: 'Refused sets' });
  await expect(refused.getByRole('listitem')).toContainText(`${name} · 60 kg × 500`);
  await expect(refused).toContainText('Reps over 100');
  await expect.poll(() => setsOf(name)).toEqual([[60, 8]]);
  expect(stored().find((workout) => workout.name === name)?.endedAt).not.toBeNull();

  await refused.getByRole('button', { name: /^Edit/ }).click();
  await refused.getByRole('textbox', { name: /^Reps/ }).fill('7');
  await refused.getByRole('button', { name: 'Save set' }).click();

  await expect(refused).toHaveCount(0);
  await expect(dataState(page)).toContainText('SYNCED');
  await expect
    .poll(() => setsOf(name))
    .toEqual([
      [60, 8],
      [60, 7],
    ]);
  // Nothing of the workout is left waiting on the device.
  await expect.poll(async () => (await recordsOnDevice(page)).length).toBe(0);
});

test('a stale copy of a workout sent after its delete does not bring it back', async ({
  page,
  context,
}) => {
  const name = `Stale ${Date.now()}`;
  const sent = watchSync(context);
  await startWorkout(page, name);
  await expect(dataState(page)).toContainText('SYNCED');
  await expect.poll(() => stored().some((workout) => workout.name === name)).toBe(true);
  // What a second tab would still hold: the workout and its exercises as first sent, and a set it
  // logged under one of them that the server has never seen.
  const workoutExercises = sent.flatMap((body) => body.workoutExercises ?? []);
  const now = new Date().toISOString();
  const copy = {
    workouts: sent.flatMap((body) => body.workouts ?? []),
    workoutExercises,
    sets: [
      {
        id: randomUUID(),
        workoutExerciseId: workoutExercises[0]?.id,
        position: 0,
        weightKg: 60,
        reps: 8,
        rir: null,
        rpe: null,
        isWarmup: false,
        performedAt: now,
        clientUpdatedAt: now,
      },
    ],
  };
  expect(copy.workouts).toHaveLength(1);
  expect(copy.workoutExercises).toHaveLength(2);

  // Finished with no set, the workout is deleted (docs/09 F3).
  await finish(page);
  await expect(dataState(page)).toContainText('SYNCED');
  await expect.poll(() => stored().some((workout) => workout.name === name)).toBe(false);
  await expect.poll(async () => (await recordsOnDevice(page)).length).toBe(0);

  const stale = await page.request.post('/api/workouts/sync', { data: copy });
  const { results }: { results: { status: string }[] } = await stale.json();
  expect(results.map((result) => result.status)).toEqual(
    Array.from({ length: 4 }, () => 'deleted'),
  );
  expect(stored().some((workout) => workout.name === name)).toBe(false);
});

test('a newer server workout survives an older device delete', async ({ page }) => {
  const name = `Newer ${Date.now()}`;
  await startWorkout(page, name);
  await expect(dataState(page)).toContainText('SYNCED');
  const workout = (await recordsOnDevice(page)).find((record) => record.table === 'workouts');
  expect(workout).toBeDefined();
  if (workout === undefined) return;
  const exerciseIds = (await recordsOnDevice(page))
    .filter((record) => record.table === 'workoutExercises')
    .map((record) => record.id);
  expect(exerciseIds).toHaveLength(2);

  const newer = {
    ...workout.row,
    clientUpdatedAt: new Date(Date.now() + 86_400_000).toISOString(),
  };
  const edit = await page.request.post('/api/workouts/sync', { data: { workouts: [newer] } });
  expect(edit.ok()).toBe(true);
  expect((await edit.json()).results[0].status).toBe('stored');

  await finish(page);
  await expect
    .poll(async () => {
      const restored = (await recordsOnDevice(page)).find((record) => record.id === workout.id);
      return {
        state: restored?.state,
        deletedAt: restored?.deletedAt,
        clientUpdatedAt: restored?.row.clientUpdatedAt,
      };
    })
    .toEqual({
      state: 'acknowledged',
      deletedAt: undefined,
      clientUpdatedAt: newer.clientUpdatedAt,
    });
  expect(
    (await recordsOnDevice(page))
      .filter((record) => record.table === 'workoutExercises')
      .map((record) => record.id),
  ).toEqual(exerciseIds);
  await expect(page.getByRole('link', { name: 'Resume workout' })).toBeVisible();
  await page.getByRole('link', { name: 'Resume workout' }).click();
  await expect(page.getByRole('region', { name: 'SET 1 OF 5' })).toBeVisible();
});

test('an empty workout delete stays newer after the phone clock goes back', async ({
  page,
  context,
}) => {
  const name = `Clock ${Date.now()}`;
  await startWorkout(page, name);
  await expect(dataState(page)).toContainText('SYNCED');
  const workout = (await recordsOnDevice(page)).find((record) => record.table === 'workouts');
  expect(workout).toBeDefined();
  if (workout === undefined) return;

  await goOffline(context);
  await context.clock.install({ time: Date.now() - 86_400_000 });
  await finish(page);
  const deletion = (await recordsOnDevice(page)).find((record) => record.id === workout.id);
  expect(deletion?.state).toBe('pending');
  expect(deletion?.deletedAt).toBeDefined();
  expect(new Date(deletion?.deletedAt ?? '').getTime()).toBeGreaterThan(
    new Date(workout.row.clientUpdatedAt).getTime(),
  );
});

test('Finish stamps an ended workout after its version when the clock goes back', async ({
  page,
  context,
}) => {
  const name = `Finish clock ${Date.now()}`;
  await startWorkout(page, name);
  await completeSet(page, '60', '8');
  await expect(dataState(page)).toContainText('SYNCED');
  const workout = (await recordsOnDevice(page)).find((record) => record.table === 'workouts');
  expect(workout).toBeDefined();
  if (workout === undefined) return;

  await goOffline(context);
  await context.clock.install({ time: Date.now() - 86_400_000 });
  await finish(page);
  const ended = (await recordsOnDevice(page)).find((record) => record.id === workout.id);
  expect(new Date(ended?.row.clientUpdatedAt ?? '').getTime()).toBeGreaterThan(
    new Date(workout.row.clientUpdatedAt).getTime(),
  );
  await goOnline(context);
  await expect
    .poll(() => stored().find((row) => row.name === name)?.endedAt ?? null)
    .not.toBeNull();
  await expect.poll(async () => (await recordsOnDevice(page)).length).toBe(0);
});

test('idle ending stamps after a newer workout version', async ({ page }) => {
  const name = `Idle clock ${Date.now()}`;
  await startWorkout(page, name);
  await completeSet(page, '60', '8');
  await expect(dataState(page)).toContainText('SYNCED');
  const workout = (await recordsOnDevice(page)).find((record) => record.table === 'workouts');
  expect(workout).toBeDefined();
  if (workout === undefined) return;

  await page.clock.install();
  await page.clock.fastForward('03:00:30');
  const newer = {
    ...workout.row,
    clientUpdatedAt: new Date(Date.now() + 86_400_000).toISOString(),
  };
  const edit = await page.request.post('/api/workouts/sync', { data: { workouts: [newer] } });
  expect(edit.ok()).toBe(true);
  expect((await edit.json()).results[0].status).toBe('stored');
  await rewriteWorkoutVersion(page, workout.id, newer.clientUpdatedAt);

  await page.reload();
  await expect(page).toHaveURL('/');
  await expect
    .poll(() => stored().find((row) => row.name === name)?.endedAt ?? null)
    .not.toBeNull();
  await expect.poll(async () => (await recordsOnDevice(page)).length).toBe(0);
});

test('two tabs open upload each set once', async ({ page, context }) => {
  const name = `Tabs ${Date.now()}`;
  await startWorkout(page, name);
  await completeSet(page, '60', '8');
  await expect(dataState(page)).toContainText('SYNCED');

  // A second tab of the same account opens on the same workout.
  const other = await context.newPage();
  await other.goto('/workout');
  await expect(setRow(other, '1 60 8')).toBeVisible();

  // With no signal, each tab logs a set. Each sees the other's, so the numbers follow on.
  await goOffline(context);
  const sent = watchSync(context);
  await completeSet(page, '60', '7');
  await expect(setRow(other, '2 60 7')).toBeVisible();
  await expect(other.getByRole('region', { name: 'SET 3 OF 5' })).toBeVisible();
  await completeSet(other, '60', '6');
  await expect(setRow(page, '3 60 6')).toBeVisible();
  await expect(dataState(page)).toHaveText('2 PENDING');
  await expect(dataState(other)).toHaveText('2 PENDING');

  // Both hear the connection return. One uploads; the other finds nothing left to send.
  sent.length = 0;
  await goOnline(context);
  await expect(dataState(page)).toContainText('SYNCED');
  await expect(dataState(other)).toContainText('SYNCED');
  expect(setsOf(name)).toEqual([
    [60, 8],
    [60, 7],
    [60, 6],
  ]);
  const uploads = sent.flatMap((body) => body.sets ?? []).map((set) => set.id);
  expect(uploads).toHaveLength(2);
  expect(new Set(uploads).size).toBe(2);

  await other.close();
  await finish(page);
});

test('a workout is rebuilt after the app is killed, with rest counting from the last set', async ({
  page,
  context,
  browserName,
}) => {
  const name = `Resume ${Date.now()}`;
  const { restSeconds } = await startWorkout(page, name);
  await completeSet(page, '60', '8');
  await completeSet(page, '60', '7');
  await completeSet(page, '60', '6');
  await expect(dataState(page)).toContainText('SYNCED');
  await expect.poll(() => setsOf(name)).toHaveLength(3);
  await expect(rest(page)).toBeVisible();

  // No signal, and the app is gone. Playwright's WebKit cannot open a service-worker page
  // offline, so there the relaunch has signal; nothing it shows is fetched either way.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  if (browserName !== 'webkit') await goOffline(context);
  await page.close();

  // It is opened again half a minute later. Today offers Resume, and the workout is as it was
  // left: the three uploaded sets, the fourth up next, and the rest still counting from the third
  // set's time, not from the reopening.
  await context.clock.install({ time: Date.now() + 30_000 });
  const reopened = await context.newPage();
  await reopened.goto('/');
  await reopened.getByRole('link', { name: 'Resume workout' }).click();
  for (const row of ['1 60 8', '2 60 7', '3 60 6']) {
    await expect(setRow(reopened, row)).toBeVisible();
  }
  await expect(reopened.getByRole('region', { name: 'SET 4 OF 5' })).toBeVisible();
  const timer = await rest(reopened).getByRole('timer').textContent();
  const [minutes, seconds] = (timer ?? '').split(':').map(Number);
  const shown = (minutes ?? 0) * 60 + (seconds ?? 0);
  expect(shown).toBeLessThanOrEqual(restSeconds - 30);
  expect(shown).toBeGreaterThan(restSeconds - 60);

  // The set after it is the fourth, and everything reaches the server once.
  await completeSet(reopened, '60', '5');
  await expect(setRow(reopened, '4 60 5')).toBeVisible();
  if (browserName !== 'webkit') {
    await expect(dataState(reopened)).toHaveText('1 PENDING');
    await goOnline(context);
  }
  await expect(dataState(reopened)).toContainText('SYNCED');
  await expect
    .poll(() => setsOf(name))
    .toEqual([
      [60, 8],
      [60, 7],
      [60, 6],
      [60, 5],
    ]);

  await finish(reopened);
});
