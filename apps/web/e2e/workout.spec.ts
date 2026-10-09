import { expect, test, type Page } from '@playwright/test';
import { apiFixture, chooseTimezone } from './fixture';

type Cookies = Parameters<import('@playwright/test').BrowserContext['addCookies']>[0];

type StoredWorkout = {
  name: string;
  routineId: string | null;
  startedAt: string;
  endedAt: string | null;
  exercises: {
    name: string;
    targetSets: number | null;
    repLow: number;
    repHigh: number;
    incrementKg: number;
    sets: {
      weightKg: number;
      reps: number;
      rir: number | null;
      isWarmup: boolean;
      performedAt: string;
    }[];
  }[];
};

// Screen 1 on the real write path (docs/09 F3): S1's happy path with S2, S3, S5 and S6 along the
// way, and the 3-hour rule. A user of its own, so workouts never reach the other specs' account.
const EMAIL = 'workout@example.test';
let userId = '';

const stored = (): StoredWorkout[] => JSON.parse(apiFixture('workouts', userId));
const setsOfLatest = () => stored().at(-1)?.exercises[0]?.sets.length;

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

async function saveProfile(page: Page, unit?: 'Kilograms' | 'Pounds') {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
  await chooseTimezone(page, 'Asia/Tokyo');
  if (unit !== undefined) await page.getByRole('radio', { name: unit }).check();
  await page.getByRole('button', { name: /^Save (profile|and finish setup)$/ }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
}

async function createRoutine(page: Page, name: string, exercises: string[]) {
  await page.goto('/routines/new');
  await page.getByRole('textbox', { name: 'Name' }).fill(name);
  await page.getByRole('button', { name: 'Add exercises' }).click();
  for (const exercise of exercises) {
    await page.getByRole('checkbox', { name: exercise, exact: true }).check();
  }
  await page
    .getByRole('button', {
      name: `Add ${exercises.length} ${exercises.length === 1 ? 'exercise' : 'exercises'}`,
    })
    .click();
}

async function start(page: Page, name: string) {
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(`${name}.*Start this workout`) }).click();
  await expect(page).toHaveURL('/workout');
}

async function completeSet(page: Page, figures: { weight?: string; reps?: string; rir?: string }) {
  if (figures.weight !== undefined) {
    await page.getByRole('textbox', { name: /^Weight in/ }).fill(figures.weight);
  }
  if (figures.reps !== undefined) {
    await page.getByRole('textbox', { name: 'Reps', exact: true }).fill(figures.reps);
  }
  if (figures.rir !== undefined) {
    await page.getByRole('textbox', { name: 'Reps in reserve, optional' }).fill(figures.rir);
  }
  await page.getByRole('button', { name: 'Complete set' }).click();
}

test('the library keeps its fetch time after a later workout upload', async ({ page }) => {
  const name = `Sync time ${Date.now()}`;
  await saveProfile(page);
  await createRoutine(page, name, ['Barbell Bench Press']);
  await page.getByRole('button', { name: 'Create routine' }).click();
  await expect(page).toHaveURL('/routines');

  await page.clock.install({ time: new Date('2026-10-06T09:59:40') });
  await page.goto('/exercises');
  await expect(page.getByRole('listitem')).toHaveCount(185);
  await expect(dataState(page)).toHaveText('SYNCED 09:59');

  // Every launch asks again for what it restored (query.ts), so from here the screens change
  // without one: the library on screen at the end is the one fetched at 09:59.
  const tabs = page.getByRole('navigation', { name: 'Sections' });
  await page.clock.setFixedTime(new Date('2026-10-06T10:00:10'));
  await tabs.getByRole('link', { name: 'Today' }).click();
  await page.getByRole('button', { name: new RegExp(`${name}.*Start this workout`) }).click();
  await expect(page).toHaveURL('/workout');
  await expect(dataState(page)).toHaveText('SYNCED 10:00');
  await expect.poll(() => stored().some((workout) => workout.name === name)).toBe(true);

  await page.goBack();
  await tabs.getByRole('link', { name: 'Exercises' }).click();
  await expect(page.getByRole('listitem')).toHaveCount(185);
  await expect(dataState(page)).toHaveText('SYNCED 09:59');

  // Finished with no set, the workout is not kept: the tests after this one start from none. The
  // server takes a deletion only when it is later than the row it has, so the clock moves first.
  await page.clock.setFixedTime(new Date('2026-10-06T10:00:20'));
  await tabs.getByRole('link', { name: 'Today' }).click();
  await page.getByRole('link', { name: 'Resume workout' }).click();
  await finish(page);
  await expect.poll(() => stored().some((workout) => workout.name === name)).toBe(false);
});

test('a workout is logged from a routine, offline and back, and finished', async ({
  page,
  context,
  browserName,
}) => {
  const name = `Push ${Date.now()}`;
  await page.clock.install();
  await saveProfile(page);

  // The user's own rep range, increment and rest for one exercise (docs/09 F2).
  await page.goto('/exercises');
  await page.getByRole('link', { name: /^Barbell Overhead Press/ }).click();
  await page.getByRole('textbox', { name: /Increment/ }).fill('1.25');
  await page.getByRole('textbox', { name: /Rest/ }).fill('60');
  await page.getByRole('textbox', { name: 'Reps low' }).fill('8');
  await page.getByRole('textbox', { name: 'Reps high' }).fill('12');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL('/exercises');

  // The routine's slot carries its own range for the bench press.
  await createRoutine(page, name, ['Barbell Bench Press', 'Barbell Overhead Press']);
  await page.getByRole('textbox', { name: 'Reps low for Barbell Bench Press' }).fill('5');
  await page.getByRole('textbox', { name: 'Reps high for Barbell Bench Press' }).fill('8');
  await page.getByRole('button', { name: 'Create routine' }).click();
  await expect(page).toHaveURL('/routines');

  // One tap starts it (S4). The defaults are resolved here: the slot's range wins.
  await start(page, name);
  await expect(page.getByRole('heading', { name: 'Barbell Bench Press', level: 2 })).toBeVisible();
  await expect(page.getByText('Reps 5–8 · increment +2.5')).toBeVisible();
  const card = page.getByRole('region', { name: 'SET 1 OF 3' });
  await expect(card).toContainText('first workout');

  // RIR is explained where it is entered, and the guide opens in the card without leaving the workout.
  await expect(card).toContainText('RIR is reps in reserve');
  await expect(card).toContainText('Optional');
  await expect(card.getByText('Could not do another')).toBeHidden();
  await card.getByRole('button', { name: 'How to gauge it' }).click();
  await expect(card.getByText('Could not do another')).toBeVisible();
  await expect(card.getByText('Comfortable')).toBeVisible();
  await expect(page).toHaveURL('/workout');
  await card.getByRole('button', { name: 'Hide guide' }).click();
  await expect(card.getByText('Could not do another')).toBeHidden();

  // S1 online: the set shows, rest starts on its own (S5), and the upload needs no action.
  await completeSet(page, { weight: '60', reps: '8', rir: '2' });
  await expect(page.getByRole('row', { name: '1 60 8 2 Done' })).toBeVisible();
  const rest = page.getByRole('region', { name: 'Rest timer' });
  await expect(rest).toContainText('REST');
  await expect(page.getByRole('region', { name: 'SET 2 OF 3' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Weight in kilograms' })).toHaveValue('60');
  await expect(dataState(page)).toContainText('SYNCED');
  await expect.poll(() => stored()[0]?.exercises[0]?.sets.length).toBe(1);

  // S1 offline: saved on the phone at once, counted as pending, kept across a relaunch.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await context.route('**/api/**', (route) => route.abort('internetdisconnected'));
  await completeSet(page, { reps: '8' });
  await expect(page.getByRole('row', { name: /^2 60 8/ })).toBeVisible();
  await expect(dataState(page)).toHaveText('1 PENDING');
  // The relaunch is a second page, not a reload. Chromium's emulated offline lapses for a page
  // being unloaded: it hears `online` on its way out, and the upload that starts gets past both
  // the emulation and the route above. So no page with a pending set is unloaded before the server
  // is asked. Playwright’s WebKit fails to open a service-worker page offline.
  const relaunched = browserName === 'webkit' ? undefined : await context.newPage();
  if (relaunched !== undefined) {
    await relaunched.goto('/workout');
    await expect(relaunched.getByRole('row', { name: /^2 60 8/ })).toBeVisible();
    await expect(dataState(relaunched)).toHaveText('1 PENDING');
  }
  expect(stored()[0]?.exercises[0]?.sets).toHaveLength(1);

  // The connection returns: the set uploads with no action from the user.
  await context.unrouteAll();
  await context.setOffline(false);
  await expect(dataState(page)).toContainText('SYNCED');
  await expect.poll(() => stored()[0]?.exercises[0]?.sets.length).toBe(2);
  expect(stored()[0]?.exercises[0]?.sets[1]?.rir).toBeNull();
  await relaunched?.close();

  // S6: a warm-up is kept and shown, but is not one of the three working sets.
  await page.getByRole('button', { name: 'Warm-up set' }).click();
  await expect(page.getByRole('region', { name: 'WARM-UP' })).toBeVisible();
  await completeSet(page, { weight: '40', reps: '5' });
  await expect(page.getByRole('button', { name: /1 WARM-UP SET/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'SET 3 OF 3' })).toBeVisible();

  // The set that reaches the target moves on to the next exercise, whose range, increment and rest
  // are the user's own.
  await completeSet(page, { weight: '60', reps: '8' });
  await expect(
    page.getByRole('heading', { name: 'Barbell Overhead Press', level: 2 }),
  ).toBeVisible();
  await expect(page.getByText('Reps 8–12 · increment +1.25')).toBeVisible();
  await expect(page.getByRole('button', { name: /Barbell Bench Press 3 sets done/ })).toBeVisible();

  // S5: rest runs out. The bar says so and counts over until dismissed; +30s extends it first.
  await completeSet(page, { weight: '40', reps: '9' });
  await expect(rest.getByRole('timer')).toHaveText(/^(1:00|0:5\d)$/);
  await rest.getByRole('button', { name: '+30s rest' }).click();
  await expect(rest.getByRole('timer')).toHaveText(/^1:[23]\d$/);
  await page.clock.fastForward('01:31');
  await expect(rest).toContainText('REST OVER');
  await expect(rest.getByRole('timer')).toHaveText(/^\+0:0\d$/);
  await rest.getByRole('button', { name: 'Dismiss rest' }).click();
  await expect(rest).toHaveCount(0);

  // Finish: the workout ends and everything reaches the server as it was logged.
  await expect(dataState(page)).toContainText('SYNCED');
  const lastTime = page.waitForResponse(
    (response) => response.url().includes('/api/training/last-time') && response.ok(),
  );
  await page.getByRole('button', { name: 'Finish workout' }).click();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page).toHaveURL('/');
  await expect.poll(() => stored()[0]?.endedAt ?? null).not.toBeNull();
  const [workout] = stored();
  expect(workout?.name).toBe(name);
  expect(workout?.exercises.map(({ sets: _sets, ...exercise }) => exercise)).toEqual([
    { name: 'Barbell Bench Press', targetSets: 3, repLow: 5, repHigh: 8, incrementKg: 2.5 },
    { name: 'Barbell Overhead Press', targetSets: 3, repLow: 8, repHigh: 12, incrementKg: 1.25 },
  ]);
  expect(workout?.exercises[0]?.sets.map(({ performedAt: _performedAt, ...set }) => set)).toEqual([
    { weightKg: 60, reps: 8, rir: 2, isWarmup: false },
    { weightKg: 60, reps: 8, rir: null, isWarmup: false },
    { weightKg: 40, reps: 5, rir: null, isWarmup: true },
    { weightKg: 60, reps: 8, rir: null, isWarmup: false },
  ]);
  await lastTime;

  // The next workout opens on last time (S2) and the suggestion (S3): every working set reached
  // the top of 5–8, the warm-up left out, so it is last weight plus the increment.
  await start(page, name);
  const next = page.getByRole('region', { name: 'SET 1 OF 3' });
  await expect(next).toContainText('LAST60 × 8');
  await expect(next).toContainText('62.5');
  await expect(next).toContainText('hit 8 on every set last time');
  await expect(page.getByRole('textbox', { name: 'Weight in kilograms' })).toHaveValue('62.5');
  // What is typed is never overwritten by it.
  await page.getByRole('textbox', { name: 'Weight in kilograms' }).fill('61');
  await page.getByRole('button', { name: 'Warm-up set' }).click();
  await page.getByRole('button', { name: 'Warm-up set' }).click();
  await expect(page.getByRole('textbox', { name: 'Weight in kilograms' })).toHaveValue('61');

  // Weights are shown in the user's unit; kilograms stay what is stored (docs/06, 2026-09-23).
  await page.goto('/');
  await page.getByRole('radio', { name: 'Pounds' }).check();
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await page.getByRole('link', { name: 'Resume workout' }).click();
  await expect(page.getByRole('region', { name: 'SET 1 OF 3' })).toContainText('LAST132.3 × 8');
  await expect(page.getByRole('textbox', { name: 'Weight in pounds' })).toHaveValue('137.8');

  // One workout at a time: starting another asks first, and Resume goes back to the one open.
  await page.goto('/');
  const again = page.getByRole('button', { name: new RegExp(`${name}.*Start this workout`) });
  await again.click();
  await expect(page.getByText(`Finish ${name} first?`)).toBeVisible();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page).toHaveURL('/workout');
  // Finish ends it and starts the new one. Ended with no set, it is not kept.
  await page.goto('/');
  await again.click();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page).toHaveURL('/workout');
  await expect(dataState(page)).toContainText('SYNCED');
  await expect.poll(() => stored().map((each) => each.endedAt === null)).toEqual([false, true]);

  // The increment is typed in the user's unit too, and stored in kilograms.
  await page.goto('/exercises');
  await page.getByRole('link', { name: /^Barbell Overhead Press/ }).click();
  await expect(page.getByRole('textbox', { name: /Increment/ })).toHaveValue('2.8');
  await page.getByRole('textbox', { name: /Increment/ }).fill('5');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL('/exercises');
  await expect(page.getByRole('link', { name: /^Barbell Overhead Press/ })).toContainText(
    'increment 5 pounds',
  );
  await page.goto('/workout');

  // A workout finished with no set is not kept.
  await page.getByRole('button', { name: 'Finish workout' }).click();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page).toHaveURL('/');
  await expect(dataState(page)).toContainText('SYNCED');
  await expect.poll(() => stored().length).toBe(1);
});

async function finish(page: Page) {
  await page.getByRole('button', { name: 'Finish workout' }).click();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page).toHaveURL('/');
}

/** How many records the set store holds, read over a connection of the test's own. */
const rowsOnDevice = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('overload-sets');
        open.addEventListener('error', () => reject(open.error));
        open.addEventListener('success', () => {
          const count = open.result.transaction('rows', 'readonly').objectStore('rows').count();
          count.addEventListener('success', () => {
            open.result.close();
            resolve(count.result);
          });
          count.addEventListener('error', () => reject(count.error));
        });
      }),
  );

/**
 * Leaves the server holding a newer, still open copy of the workout on the device, as an edit made
 * elsewhere would: what the device then sends for it is the older write.
 */
async function editWorkoutElsewhere(page: Page) {
  const row = await page.evaluate(
    () =>
      new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
        const open = indexedDB.open('overload-sets');
        open.addEventListener('error', () => reject(open.error));
        open.addEventListener('success', () => {
          const all = open.result.transaction('rows', 'readonly').objectStore('rows').getAll();
          all.addEventListener('error', () => reject(all.error));
          all.addEventListener('success', () => {
            open.result.close();
            const records: { table: string; row: Record<string, unknown> }[] = all.result;
            resolve(records.find((record) => record.table === 'workouts')?.row);
          });
        });
      }),
  );
  expect(row).toBeDefined();
  const newer = { ...row, clientUpdatedAt: new Date(Date.now() + 86_400_000).toISOString() };
  const edit = await page.request.post('/api/workouts/sync', { data: { workouts: [newer] } });
  expect(edit.ok()).toBe(true);
  expect((await edit.json()).results[0].status).toBe('stored');
}

/**
 * Refuses every write to the set store from here on, until `mend-sets`. Each refusal is counted on
 * the document, so a test can wait for one.
 */
function refuseSetStoreWrites() {
  const database: {
    transaction: (
      this: IDBDatabase,
      ...args: Parameters<IDBDatabase['transaction']>
    ) => IDBTransaction;
  } = IDBDatabase.prototype;
  const transaction = database.transaction;
  let broken = true;
  let refused = 0;
  window.addEventListener('mend-sets', () => {
    broken = false;
  });
  IDBDatabase.prototype.transaction = function refuse(this: IDBDatabase, stores, mode, options) {
    if (broken && this.name === 'overload-sets' && mode === 'readwrite') {
      refused += 1;
      document.documentElement.dataset.setWritesRefused = String(refused);
      throw new DOMException('The write failed.', 'UnknownError');
    }
    return transaction.call(this, stores, mode, options);
  };
}

test('a weight left as the card opened it is logged as the stored kilograms', async ({ page }) => {
  const name = `Pounds ${Date.now()}`;
  const weights = () =>
    stored()
      .find((workout) => workout.name === name)
      ?.exercises[0]?.sets.map((set) => set.weightKg);
  await saveProfile(page, 'Kilograms');
  await createRoutine(page, name, ['Barbell Deadlift']);
  await page.getByRole('button', { name: 'Create routine' }).click();
  await expect(page).toHaveURL('/routines');
  await start(page, name);
  await completeSet(page, { weight: '82.5', reps: '5' });
  await expect(page.getByRole('row', { name: /^1 82.5 5/ })).toBeVisible();

  // In pounds the card opens on 181.9, which is 82.51 kg typed: untouched, it stays 82.5.
  await saveProfile(page, 'Pounds');
  await page.getByRole('link', { name: 'Resume workout' }).click();
  await expect(page.getByRole('textbox', { name: 'Weight in pounds' })).toHaveValue('181.9');
  await completeSet(page, { reps: '5' });
  await expect(page.getByRole('row', { name: /^2 181.9 5/ })).toBeVisible();
  await expect.poll(weights).toEqual([82.5, 82.5]);

  // What is typed is converted.
  await completeSet(page, { weight: '185', reps: '5' });
  await expect.poll(weights).toEqual([82.5, 82.5, 83.91]);
  await finish(page);

  // The increment follows the same rule: 2.5 kg shows as 5.5, which typed back is still 2.5 kg,
  // not the 2.49 that 5.5 lb converts to.
  await page.goto('/exercises');
  await page.getByRole('link', { name: /^Barbell Deadlift/ }).click();
  await expect(page.getByRole('textbox', { name: /Increment/ })).toHaveValue('5.5');
  await page.getByRole('textbox', { name: /Increment/ }).fill('6');
  await page.getByRole('textbox', { name: /Increment/ }).fill('5.5');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL('/exercises');
  const library: { items: { name: string; incrementKg: number }[] } = await (
    await page.request.get('/api/exercises')
  ).json();
  expect(library.items.find((item) => item.name === 'Barbell Deadlift')?.incrementKg).toBe(2.5);
});

test('a unit changed elsewhere reopens the set card in the new unit', async ({ page }) => {
  const name = `Unit ${Date.now()}`;
  const weights = () =>
    stored()
      .find((workout) => workout.name === name)
      ?.exercises[0]?.sets.map((set) => set.weightKg);
  await saveProfile(page, 'Pounds');
  await createRoutine(page, name, ['Barbell Deadlift']);
  await page.getByRole('button', { name: 'Create routine' }).click();
  await expect(page).toHaveURL('/routines');
  await start(page, name);
  await completeSet(page, { weight: '181.9', reps: '5' });
  await expect(page.getByRole('row', { name: /^1 (\S+ × \d+ )?181.9 5 / })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Weight in pounds' })).toHaveValue('181.9');

  // Another device saves kilograms; coming back to the app asks /api/me again.
  const elsewhere = await page.request.patch('/api/me/profile', {
    headers: { Origin: new URL(page.url()).origin },
    data: { weightUnit: 'kg' },
  });
  expect(elsewhere.ok()).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('textbox', { name: 'Weight in kilograms' })).toHaveValue('82.51');

  // Left as it reopened, the set is the stored kilograms, not 181.9 kg.
  await completeSet(page, { reps: '5' });
  await expect.poll(weights).toEqual([82.51, 82.51]);
  await finish(page);
});

test('a profile changed elsewhere reaches the open form without undoing an edit in hand', async ({
  page,
}) => {
  await saveProfile(page, 'Kilograms');
  const timezone = page.getByRole('combobox', { name: 'Time zone' });
  await chooseTimezone(page, 'Europe/Paris');

  // Another device saves pounds; coming back to the app asks /api/me again.
  const elsewhere = await page.request.patch('/api/me/profile', {
    headers: { Origin: new URL(page.url()).origin },
    data: { weightUnit: 'lb' },
  });
  expect(elsewhere.ok()).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('radio', { name: 'Pounds' })).toBeChecked();
  await expect(timezone).toHaveValue('Europe/Paris');

  // Saving the edit keeps the unit the other device chose.
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  const me: { profile: { timezone: string; weightUnit: string } } = await (
    await page.request.get('/api/me')
  ).json();
  expect(me.profile).toMatchObject({ timezone: 'Europe/Paris', weightUnit: 'lb' });
});

test('an exercise with no rest shows no rest bar after a set', async ({ page }) => {
  const name = `No rest ${Date.now()}`;
  await saveProfile(page);
  await page.goto('/exercises');
  await page.getByRole('link', { name: /^Barbell Curl/ }).click();
  await page.getByRole('textbox', { name: /Rest/ }).fill('0');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL('/exercises');
  await createRoutine(page, name, ['Barbell Curl']);
  await page.getByRole('button', { name: 'Create routine' }).click();
  await expect(page).toHaveURL('/routines');

  await start(page, name);
  await completeSet(page, { weight: '30', reps: '10' });
  await expect(page.getByRole('region', { name: 'SET 2 OF 3' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Rest timer' })).toHaveCount(0);
  await completeSet(page, { reps: '10' });
  await expect(page.getByRole('region', { name: 'SET 3 OF 3' })).toBeVisible();
  await completeSet(page, { reps: '10' });
  await expect(page.getByRole('region', { name: 'SET 4 · EXTRA' })).toBeVisible();
  await completeSet(page, { reps: '10' });
  await expect(page.getByRole('region', { name: 'SET 5 · EXTRA' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Rest timer' })).toHaveCount(0);
  await finish(page);
});

test('leaving the app and coming back keeps the workout screen as it was', async ({ page }) => {
  const name = `Away ${Date.now()}`;
  await page.clock.install();
  await saveProfile(page);
  await page.goto('/exercises');
  await page.getByRole('link', { name: /^Dumbbell Hammer Curl/ }).click();
  await page.getByRole('textbox', { name: /Rest/ }).fill('120');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL('/exercises');
  await createRoutine(page, name, ['Dumbbell Hammer Curl', 'Dumbbell Lateral Raise']);
  await page.getByRole('button', { name: 'Create routine' }).click();
  await expect(page).toHaveURL('/routines');
  await start(page, name);

  // A set logged and its rest made longer, then another exercise opened with a set half typed.
  const rest = page.getByRole('region', { name: 'Rest timer' });
  await completeSet(page, { weight: '12', reps: '10' });
  await rest.getByRole('button', { name: '+30s rest' }).click();
  await page.getByRole('button', { name: /Dumbbell Lateral Raise/ }).click();
  await page.getByRole('textbox', { name: /^Weight in/ }).fill('7.5');
  await page.getByRole('textbox', { name: 'Reps', exact: true }).fill('12');
  await page.getByRole('textbox', { name: 'Reps in reserve, optional' }).fill('2');
  await page.getByRole('button', { name: 'Warm-up set' }).click();
  const asLeft = async () => {
    await expect(page.getByRole('heading', { name: 'Dumbbell Lateral Raise' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'WARM-UP' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /^Weight in/ })).toHaveValue('7.5');
    await expect(page.getByRole('textbox', { name: 'Reps', exact: true })).toHaveValue('12');
    await expect(page.getByRole('textbox', { name: 'Reps in reserve, optional' })).toHaveValue('2');
    await expect(rest.getByRole('timer')).toHaveText(/^2:[012]\d$/);
  };
  await asLeft();

  // Coming back asks /api/me again. The screen stays as it was while that is away, and after.
  const comeBack = async (check: () => Promise<void>) => {
    const { promise: held, resolve: release } = Promise.withResolvers<void>();
    await page.route('**/api/me', async (route) => {
      await held;
      await route.continue();
    });
    const asked = page.waitForRequest('**/api/me');
    const answered = page.waitForResponse('**/api/me');
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
    await asked;
    await check();
    release();
    await answered;
    await page.unroute('**/api/me');
    await expect(dataState(page)).toContainText('SYNCED');
    await check();
  };
  await comeBack(asLeft);

  await rest.getByRole('button', { name: 'Skip rest' }).click();
  await comeBack(async () => {
    await expect(page.getByRole('textbox', { name: /^Weight in/ })).toHaveValue('7.5');
    await expect(rest).toHaveCount(0);
  });
  await page.getByRole('button', { name: 'Complete set' }).click();
  await expect(page.getByRole('button', { name: /1 WARM-UP SET/ })).toBeVisible();
  await finish(page);
});

test('finishing after deleting the routine keeps the workout on the server', async ({ page }) => {
  const name = `Deleted routine ${Date.now()}`;
  await saveProfile(page, 'Kilograms');
  await createRoutine(page, name, ['Barbell Bench Press']);
  await page.getByRole('button', { name: 'Create routine' }).click();
  await expect(page).toHaveURL('/routines');

  await start(page, name);
  await completeSet(page, { weight: '60', reps: '8' });
  // SYNCED already shows from the start; the row says the set is on the device before the page goes.
  await expect(page.getByRole('row', { name: /^1 (60 × 8 )?60 8 / })).toBeVisible();
  await expect(dataState(page)).toContainText('SYNCED');

  await page.goto('/routines');
  await page.getByRole('link', { name: new RegExp(name) }).click();
  await page.getByRole('button', { name: 'Delete routine' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page).toHaveURL('/routines');

  await page.goto('/');
  await page.getByRole('link', { name: 'Resume workout' }).click();
  await finish(page);
  await expect(dataState(page)).toContainText('SYNCED');
  await expect.poll(() => stored().find((workout) => workout.name === name)?.endedAt).toBeTruthy();
  expect(stored().find((workout) => workout.name === name)).toMatchObject({
    routineId: null,
    exercises: [{ sets: [expect.objectContaining({ weightKg: 60, reps: 8 })] }],
  });
});

test('each slot of an exercise a routine holds twice keeps its own last time through a reorder', async ({
  page,
}) => {
  const name = `Twice ${Date.now()}`;
  const bench = 'Barbell Bench Press';
  await saveProfile(page, 'Kilograms');
  await createRoutine(page, name, [bench]);
  await page.getByRole('button', { name: 'Add exercises' }).click();
  await page.getByRole('checkbox', { name: bench, exact: true }).check();
  await page.getByRole('button', { name: 'Add 1 exercise' }).click();
  const figures = (label: string, slot: number) =>
    page.getByRole('textbox', { name: `${label} for ${bench}` }).nth(slot);
  await figures('Sets', 0).fill('1');
  await figures('Reps low', 0).fill('5');
  await figures('Reps high', 0).fill('8');
  await figures('Sets', 1).fill('1');
  await figures('Reps low', 1).fill('8');
  await figures('Reps high', 1).fill('12');
  await page.getByRole('button', { name: 'Create routine' }).click();
  await expect(page).toHaveURL('/routines');

  // The 5–8 slot reaches 8; the 8–12 slot stops at 10.
  await start(page, name);
  await expect(page.getByText('Reps 5–8')).toBeVisible();
  await completeSet(page, { weight: '80', reps: '8' });
  await expect(page.getByText('Reps 8–12')).toBeVisible();
  await completeSet(page, { weight: '60', reps: '10' });
  await expect(dataState(page)).toContainText('SYNCED');
  const lastTime = page.waitForResponse(
    (response) => response.url().includes('/api/training/last-time') && response.ok(),
  );
  await finish(page);
  await lastTime;

  // The 8–12 slot is moved above the other.
  await page.goto('/routines');
  await page.getByRole('link', { name: new RegExp(name) }).click();
  await page
    .getByRole('button', { name: `Move ${bench} up` })
    .nth(1)
    .click();
  await expect(figures('Reps high', 0)).toHaveValue('12');
  await page.getByRole('button', { name: 'Save routine' }).click();
  await expect(page).toHaveURL('/routines');

  // Each slot opens on its own sets, judged against its own range.
  await start(page, name);
  await expect(page.getByText('Reps 8–12')).toBeVisible();
  const card = page.getByRole('region', { name: 'SET 1 OF 1' });
  await expect(card).toContainText('LAST60 × 10');
  await expect(card).toContainText('set 1 stopped at 10 of 12 last time');
  await expect(page.getByRole('textbox', { name: 'Weight in kilograms' })).toHaveValue('60');
  await completeSet(page, { reps: '12' });
  await expect(page.getByText('Reps 5–8')).toBeVisible();
  await expect(card).toContainText('LAST80 × 8');
  await expect(card).toContainText('hit 8 on the only set last time');
  await expect(page.getByRole('textbox', { name: 'Weight in kilograms' })).toHaveValue('82.5');
});

test('a workout left for three hours ends at its last set', async ({ page }) => {
  const name = `Idle ${Date.now()}`;
  const before = stored().length;
  await page.clock.install();
  await saveProfile(page);
  await createRoutine(page, name, ['Chin-Up']);
  await page.getByRole('button', { name: 'Create routine' }).click();
  await expect(page).toHaveURL('/routines');

  await start(page, name);
  await completeSet(page, { reps: '6' });
  await expect(page.getByRole('row', { name: /^1 0 6/ })).toBeVisible();
  await expect(dataState(page)).toContainText('SYNCED');

  // Just short of three hours it is still in progress.
  await page.clock.fastForward('02:59:00');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Chin-Up', level: 2 })).toBeVisible();

  // Past three hours, the next launch ends it at its last set's time, and the server is told.
  await page.clock.fastForward('00:01:30');
  await page.reload();
  await expect(page).toHaveURL('/');
  await expect(page.getByText(new RegExp(`${name} ended at \\d\\d:\\d\\d`))).toBeVisible();
  await expect.poll(() => stored().at(-1)?.endedAt ?? null).not.toBeNull();
  const workout = stored().at(-1);
  expect(workout?.name).toBe(name);
  expect(workout?.endedAt).toBe(workout?.exercises[0]?.sets[0]?.performedAt);

  // One that never logged a set is deleted instead.
  await start(page, name);
  await expect.poll(() => stored().length).toBe(before + 2);
  await page.clock.fastForward('03:00:30');
  await page.reload();
  await expect(page).toHaveURL('/');
  await expect.poll(() => stored().length).toBe(before + 1);
});

test.describe('sign-out with a workout on the device', () => {
  // page.route cannot hold a request a service worker forwards (WebKit).
  test.use({ serviceWorkers: 'block' });

  test('never drops a set without the user choosing to', async ({ page }) => {
    const name = `Pull ${Date.now()}`;
    await saveProfile(page);
    await createRoutine(page, name, ['Chin-Up']);
    await page.getByRole('button', { name: 'Create routine' }).click();
    await expect(page).toHaveURL('/routines');
    await start(page, name);
    await expect(dataState(page)).toContainText('SYNCED');

    // A set the server has not answered for.
    await page.route('**/api/workouts/sync', (route) => route.abort());
    await completeSet(page, { reps: '6' });
    await expect(dataState(page)).toHaveText('1 PENDING');
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign out' }).click();

    // The workout in progress stops the sign-out whatever is waiting: it is finished first, and
    // neither choice is offered until it is.
    await expect(page.getByText('A workout is in progress')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Upload now' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Discard and sign out' })).toHaveCount(0);
    await expect(page).toHaveURL('/');

    // Finished on the device, its ending has not reached the server: still neither choice, and a
    // retry that cannot upload says so again.
    await page.getByRole('link', { name: 'Resume workout' }).click();
    await finish(page);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByText('Your workout has not finished uploading.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Upload now' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Discard and sign out' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeEnabled();
    await expect(page).toHaveURL('/');
    expect(stored().at(-1)?.endedAt).toBeNull();

    // With signal the retry uploads the ending and the set, and only then signs out.
    await page.unrouteAll();
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page).toHaveURL('/sign-in');
    expect(stored().at(-1)?.endedAt).not.toBeNull();
    expect(setsOfLatest()).toBe(1);
    expect(await rowsOnDevice(page)).toBe(0);
  });

  test('offers to discard a set the server refused once its workout has ended there', async ({
    page,
  }) => {
    const name = `Refused ${Date.now()}`;
    await saveProfile(page);
    await createRoutine(page, name, ['Chin-Up']);
    await page.getByRole('button', { name: 'Create routine' }).click();
    await expect(page).toHaveURL('/routines');
    await start(page, name);
    await expect(dataState(page)).toContainText('SYNCED');

    // The server answers the set as refused; the workout's own rows are stored.
    await page.route('**/api/workouts/sync', async (route) => {
      const response = await route.fetch();
      const body: { results: { table: string; id: string }[] } = await response.json();
      const results = body.results.map((result) =>
        result.table === 'sets'
          ? {
              table: result.table,
              id: result.id,
              status: 'refused',
              problem: { code: 'validation_failed', status: 422 },
            }
          : result,
      );
      await route.fulfill({ response, json: { results } });
    });
    await completeSet(page, { reps: '6' });
    await expect(dataState(page)).toContainText('1 REFUSED');
    await finish(page);
    await expect.poll(() => stored().at(-1)?.endedAt ?? null).not.toBeNull();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByText('1 set not uploaded yet.')).toBeVisible();
    await expect(page).toHaveURL('/');
    await page.getByRole('button', { name: 'Discard and sign out' }).click();
    await expect(page).toHaveURL('/sign-in');
    expect(await rowsOnDevice(page)).toBe(0);
  });

  test('keeps a Finish the server did not take, and the sign-out it stops', async ({ page }) => {
    const name = `Newer ${Date.now()}`;
    await saveProfile(page);
    await createRoutine(page, name, ['Chin-Up']);
    await page.getByRole('button', { name: 'Create routine' }).click();
    await expect(page).toHaveURL('/routines');
    await start(page, name);
    await completeSet(page, { reps: '6' });
    await expect(dataState(page)).toContainText('SYNCED');

    // The server's copy of the workout is the newer one and stays open: its answer is not an
    // acknowledgment of the ending.
    await editWorkoutElsewhere(page);
    const answered = page.waitForResponse(
      (response) => response.url().includes('/api/workouts/sync') && response.ok(),
    );
    await finish(page);
    await answered;
    await expect(dataState(page)).toHaveText('1 PENDING');
    expect(stored().at(-1)?.endedAt).toBeNull();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByText('Your workout has not finished uploading.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Discard and sign out' })).toHaveCount(0);
    await expect(page).toHaveURL('/');
  });

  test('keeps a workout with no sets whose removal the server did not take', async ({ page }) => {
    const name = `Newer ${Date.now()}`;
    const before = stored().length;
    await saveProfile(page);
    await createRoutine(page, name, ['Chin-Up']);
    await page.getByRole('button', { name: 'Create routine' }).click();
    await expect(page).toHaveURL('/routines');
    await start(page, name);
    await expect(dataState(page)).toContainText('SYNCED');

    // The server's copy is the newer one, so it survives the removal and comes back to the device
    // still in progress.
    await editWorkoutElsewhere(page);
    const answered = page.waitForResponse(
      (response) => response.url().includes('/api/workouts/sync') && response.ok(),
    );
    await finish(page);
    await answered;
    await expect(page.getByRole('link', { name: 'Resume workout' })).toBeVisible();
    expect(stored().length).toBe(before + 1);
    expect(stored().at(-1)?.endedAt).toBeNull();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByText('A workout is in progress')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Discard and sign out' })).toHaveCount(0);
    await expect(page).toHaveURL('/');
  });

  test('waits for the device’s sets to be read before it can start', async ({ page }) => {
    const name = `Reload ${Date.now()}`;
    await saveProfile(page);
    await createRoutine(page, name, ['Chin-Up']);
    await page.getByRole('button', { name: 'Create routine' }).click();
    await expect(page).toHaveURL('/routines');
    await start(page, name);
    await expect(dataState(page)).toContainText('SYNCED');
    await page.route('**/api/workouts/sync', (route) => route.abort());
    await completeSet(page, { reps: '6' });
    await expect(dataState(page)).toHaveText('1 PENDING');

    // The app opens again with the set store slow to answer: Today is up before the sets are read.
    await page.addInitScript(() => {
      const factory: {
        open: (this: IDBFactory, ...args: Parameters<IDBFactory['open']>) => IDBOpenDBRequest;
      } = IDBFactory.prototype;
      const open = factory.open;
      IDBFactory.prototype.open = function held(this: IDBFactory, database, version) {
        const request = open.call(this, database, version);
        if (database !== 'overload-sets') return request;
        const released = new Promise((resolve) => {
          window.addEventListener('release-sets', resolve, { once: true });
        });
        const proxy = new EventTarget();
        Object.defineProperty(proxy, 'result', { get: () => request.result });
        Object.defineProperty(proxy, 'error', { get: () => request.error });
        request.addEventListener('success', () => {
          void released.then(() => proxy.dispatchEvent(new Event('success')));
        });
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- stands in for the request
        return proxy as IDBOpenDBRequest;
      };
    });
    await page.goto('/');
    const signOut = page.getByRole('button', { name: 'Sign out' });
    await expect(signOut).toBeDisabled();

    await page.evaluate(() => window.dispatchEvent(new Event('release-sets')));
    await signOut.click();
    await expect(page.getByText('A workout is in progress')).toBeVisible();
    await expect(page).toHaveURL('/');
  });

  test('with the set store unreadable, starts nothing and signs nobody out', async ({ page }) => {
    const name = `Unread ${Date.now()}`;
    await saveProfile(page);
    await createRoutine(page, name, ['Chin-Up']);
    await page.getByRole('button', { name: 'Create routine' }).click();
    await expect(page).toHaveURL('/routines');
    await start(page, name);
    await expect(dataState(page)).toContainText('SYNCED');
    await page.route('**/api/workouts/sync', (route) => route.abort());
    await completeSet(page, { reps: '6' });
    await expect(dataState(page)).toHaveText('1 PENDING');

    await page.addInitScript(() => {
      const rows: {
        getAll: (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['getAll']>) => IDBRequest;
      } = IDBObjectStore.prototype;
      const getAll = rows.getAll;
      let broken = true;
      window.addEventListener('mend-sets', () => {
        broken = false;
      });
      IDBObjectStore.prototype.getAll = function unreadable(this: IDBObjectStore, query, count) {
        if (broken && this.transaction.db.name === 'overload-sets') {
          throw new DOMException('The read failed.', 'UnknownError');
        }
        return getAll.call(this, query, count);
      };
    });
    await page.goto('/');
    await expect(page.getByText('Couldn’t read this device’s sets.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Start this workout/ })).toHaveCount(0);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByText("Couldn't sign out. Try again.")).toBeVisible();
    await expect(page).toHaveURL('/');

    await page.evaluate(() => window.dispatchEvent(new Event('mend-sets')));
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('link', { name: 'Resume workout' })).toBeVisible();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByText('A workout is in progress')).toBeVisible();
  });

  test('says so when the set store could not be cleared', async ({ page }) => {
    await saveProfile(page);
    await page.evaluate(() => {
      const database: {
        transaction: (
          this: IDBDatabase,
          ...args: Parameters<IDBDatabase['transaction']>
        ) => IDBTransaction;
      } = IDBDatabase.prototype;
      const transaction = database.transaction;
      IDBDatabase.prototype.transaction = function refused(
        this: IDBDatabase,
        stores,
        mode,
        options,
      ) {
        if (this.name === 'overload-sets' && mode === 'readwrite') {
          throw new DOMException('The wipe failed.', 'UnknownError');
        }
        return transaction.call(this, stores, mode, options);
      };
    });

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL('/sign-in?wipe=failed');
    await expect(page.getByText("Saved data couldn't be cleared from this device.")).toBeVisible();
  });

  test('stays usable when the upload it asks for cannot be written to the device', async ({
    page,
  }) => {
    const name = `Unwritten ${Date.now()}`;
    const errors: Error[] = [];
    page.on('pageerror', (error) => errors.push(error));
    await page.clock.install();
    await saveProfile(page);
    await createRoutine(page, name, ['Chin-Up']);
    await page.getByRole('button', { name: 'Create routine' }).click();
    await expect(page).toHaveURL('/routines');
    await start(page, name);
    await expect(dataState(page)).toContainText('SYNCED');

    // The server stores the set, but its answer for it never arrives: the workout ends and is
    // acknowledged with one set still waiting.
    let endedAnswered = false;
    let setSentAgain = false;
    await page.route('**/api/workouts/sync', async (route) => {
      const sent: { workouts?: { endedAt?: string | null }[] } = route.request().postDataJSON();
      const response = await route.fetch();
      const body: { results: { table: string }[] } = await response.json();
      const results = body.results.filter((result) => result.table !== 'sets');
      await route.fulfill({ response, json: { results } });
      if (endedAnswered) setSentAgain = true;
      if (sent.workouts?.some((workout) => typeof workout.endedAt === 'string')) {
        endedAnswered = true;
      }
    });
    await completeSet(page, { reps: '6' });
    await finish(page);
    // The clock stops here, so the uploader's own timer asks for no upload the steps below do not.
    await page.clock.pauseAt(Date.now() + 1000);
    const signOut = page.getByRole('button', { name: 'Sign out' });
    await expect(async () => {
      await signOut.click();
      await expect(page.getByText('1 set not uploaded yet.')).toBeVisible({ timeout: 1000 });
    }).toPass();
    // The workout's answer changed the records, which sends the waiting set once more. That
    // request is answered before the device and the routes change under it.
    await expect.poll(() => setSentAgain).toBe(true);

    // The device stops taking writes. The uploader's own try reaches the server and cannot note
    // the answer; so does the one Upload now asks for.
    await page.evaluate(refuseSetStoreWrites);
    await page.unrouteAll();
    const refusals = page.locator('html');
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(refusals).toHaveAttribute('data-set-writes-refused', '1');
    await page.getByRole('button', { name: 'Upload now' }).click();
    await expect(page.getByText("Couldn't sign out. Try again.")).toBeVisible();
    await expect(refusals).toHaveAttribute('data-set-writes-refused', '2');
    await expect(signOut).toBeEnabled();
    await expect(page).toHaveURL('/');

    // Once the device takes writes again, the same way out works.
    await page.evaluate(() => window.dispatchEvent(new Event('mend-sets')));
    await signOut.click();
    await page.getByRole('button', { name: 'Upload now' }).click();
    await expect(page).toHaveURL('/sign-in');
    expect(setsOfLatest()).toBe(1);
    expect(errors).toEqual([]);
  });

  test('a launch that cannot end an idle workout on the device leaves it in progress', async ({
    page,
  }) => {
    const name = `Idle unwritten ${Date.now()}`;
    const errors: Error[] = [];
    page.on('pageerror', (error) => errors.push(error));
    await page.clock.install();
    await saveProfile(page);
    await createRoutine(page, name, ['Chin-Up']);
    await page.getByRole('button', { name: 'Create routine' }).click();
    await expect(page).toHaveURL('/routines');
    await start(page, name);
    await completeSet(page, { reps: '6' });
    await expect(page.getByRole('row', { name: /^1 (\S+ × \d+ )?0 6/ })).toBeVisible();
    await expect(dataState(page)).toContainText('SYNCED');

    // Past three hours, with the device refusing the write that would end it.
    await page.clock.fastForward('03:00:30');
    await page.addInitScript(refuseSetStoreWrites);
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-set-writes-refused', /^\d+$/);
    await expect(page.getByRole('link', { name: 'Resume workout' })).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('the set store’s connection, lost under the open app', () => {
  // The app's connections to the set store, kept where the test can end them as the browser does:
  // `lose-sets` closes them and says so (the `close` event).
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const factory: {
        open: (this: IDBFactory, ...args: Parameters<IDBFactory['open']>) => IDBOpenDBRequest;
      } = IDBFactory.prototype;
      const open = factory.open;
      const held = new Set<IDBDatabase>();
      IDBFactory.prototype.open = function kept(this: IDBFactory, database, version) {
        const request = open.call(this, database, version);
        if (database === 'overload-sets') {
          request.addEventListener('success', () => held.add(request.result));
        }
        return request;
      };
      window.addEventListener('lose-sets', () => {
        for (const connection of held) {
          connection.close();
          connection.dispatchEvent(new Event('close'));
        }
        held.clear();
      });
    });
  });

  test('the browser closes it: the next set is saved, and Finish works', async ({ page }) => {
    const name = `Closed ${Date.now()}`;
    await saveProfile(page, 'Kilograms');
    await createRoutine(page, name, ['Chin-Up']);
    await page.getByRole('button', { name: 'Create routine' }).click();
    await expect(page).toHaveURL('/routines');
    await start(page, name);
    await completeSet(page, { reps: '6' });
    await expect(page.getByRole('row', { name: /^1 (\S+ × \d+ )?0 6/ })).toBeVisible();
    await expect(dataState(page)).toContainText('SYNCED');

    await page.evaluate(() => window.dispatchEvent(new Event('lose-sets')));
    await completeSet(page, { reps: '5' });
    await expect(page.getByRole('row', { name: /^2 (\S+ × \d+ )?0 5/ })).toBeVisible();
    await expect(page.getByText('Couldn’t save the set on this device')).toHaveCount(0);
    // The workout, its exercise and both sets.
    expect(await rowsOnDevice(page)).toBe(4);

    await finish(page);
    await expect
      .poll(() => stored().find((workout) => workout.name === name)?.exercises[0]?.sets.length)
      .toBe(2);
  });

  test('another connection asks for the database: it is let go, and the next set is saved', async ({
    page,
  }) => {
    const name = `Asked ${Date.now()}`;
    await saveProfile(page, 'Kilograms');
    await createRoutine(page, name, ['Chin-Up']);
    await page.getByRole('button', { name: 'Create routine' }).click();
    await expect(page).toHaveURL('/routines');
    await start(page, name);
    await completeSet(page, { reps: '6' });
    await expect(page.getByRole('row', { name: /^1 (\S+ × \d+ )?0 6/ })).toBeVisible();
    await expect(dataState(page)).toContainText('SYNCED');

    // The device's storage is cleared from elsewhere, which asks every connection to close
    // (`versionchange`). One that stays open blocks it.
    const cleared = await page.evaluate(
      () =>
        new Promise<string>((resolve, reject) => {
          const request = indexedDB.deleteDatabase('overload-sets');
          request.addEventListener('success', () => resolve('cleared'));
          request.addEventListener('blocked', () => resolve('blocked'));
          request.addEventListener('error', () => reject(request.error));
        }),
    );
    expect(cleared).toBe('cleared');

    await completeSet(page, { reps: '5' });
    await expect(page.getByRole('row', { name: /^2 (\S+ × \d+ )?0 5/ })).toBeVisible();
    // Only the set logged since: what was cleared is gone from the device.
    expect(await rowsOnDevice(page)).toBe(1);
    await finish(page);
  });
});
