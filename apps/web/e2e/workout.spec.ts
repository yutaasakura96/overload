import { expect, test, type Page } from '@playwright/test';
import { apiFixture } from './fixture';

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
  await page.getByRole('textbox', { name: 'Time zone' }).fill('Asia/Tokyo');
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
  await page.getByRole('link', { name: /Barbell Overhead Press/ }).click();
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
  // Chromium's emulated offline lapses for a moment after a reload, so the API is cut here too.
  await context.route('**/api/**', (route) => route.abort('internetdisconnected'));
  await completeSet(page, { reps: '8' });
  await expect(page.getByRole('row', { name: /^2 60 8/ })).toBeVisible();
  await expect(dataState(page)).toHaveText('1 PENDING');
  // Playwright’s WebKit fails to reload a service-worker page offline.
  if (browserName !== 'webkit') {
    await page.reload();
    await expect(page.getByRole('row', { name: /^2 60 8/ })).toBeVisible();
    await expect(dataState(page)).toHaveText('1 PENDING');
  }
  expect(stored()[0]?.exercises[0]?.sets).toHaveLength(1);

  // The connection returns: the set uploads with no action from the user.
  await context.unrouteAll();
  await context.setOffline(false);
  await expect(dataState(page)).toContainText('SYNCED');
  await expect.poll(() => stored()[0]?.exercises[0]?.sets.length).toBe(2);

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
  await page.getByRole('link', { name: /Barbell Overhead Press/ }).click();
  await expect(page.getByRole('textbox', { name: /Increment/ })).toHaveValue('2.8');
  await page.getByRole('textbox', { name: /Increment/ }).fill('5');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL('/exercises');
  await expect(page.getByRole('link', { name: /Barbell Overhead Press/ })).toContainText(
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
});

test('an exercise with no rest shows no rest bar after a set', async ({ page }) => {
  const name = `No rest ${Date.now()}`;
  await saveProfile(page);
  await page.goto('/exercises');
  await page.getByRole('link', { name: /Barbell Curl/ }).click();
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

test('a longer or skipped rest stays so after leaving the app and coming back', async ({
  page,
}) => {
  const name = `Away ${Date.now()}`;
  await page.clock.install();
  await saveProfile(page);
  await page.goto('/exercises');
  await page.getByRole('link', { name: /Dumbbell Hammer Curl/ }).click();
  await page.getByRole('textbox', { name: /Rest/ }).fill('120');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL('/exercises');
  await createRoutine(page, name, ['Dumbbell Hammer Curl']);
  await page.getByRole('button', { name: 'Create routine' }).click();
  await expect(page).toHaveURL('/routines');
  await start(page, name);

  // Coming back asks /api/me again, and the workout is rebuilt from the set store once it answers.
  const comeBack = async () => {
    const me = page.waitForResponse((response) => response.url().endsWith('/api/me'));
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
    await me;
    await expect(page.getByRole('heading', { name: 'Dumbbell Hammer Curl' })).toBeVisible();
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const open = indexedDB.open('overload-sets');
          open.addEventListener('error', () => reject(open.error));
          open.addEventListener('success', () => {
            const read = open.result.transaction('rows', 'readonly').objectStore('rows').getAll();
            read.addEventListener('success', () => resolve());
            read.addEventListener('error', () => reject(read.error));
          });
        }),
    );
  };

  const rest = page.getByRole('region', { name: 'Rest timer' });
  await completeSet(page, { weight: '12', reps: '10' });
  await rest.getByRole('button', { name: '+30s rest' }).click();
  await expect(rest.getByRole('timer')).toHaveText(/^2:[23]\d$/);
  await page.clock.fastForward('02:10');
  await comeBack();
  await expect(rest.getByRole('timer')).toHaveText(/^0:[012]\d$/);

  await completeSet(page, { reps: '10' });
  await rest.getByRole('button', { name: 'Skip rest' }).click();
  await expect(rest).toHaveCount(0);
  await comeBack();
  await expect(page.getByRole('region', { name: 'SET 3 OF 3' })).toBeVisible();
  await expect(rest).toHaveCount(0);
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
    await expect(page.getByText('1 set not uploaded yet.')).toBeVisible();
    await expect(page).toHaveURL('/');

    // Uploaded, the workout in progress still stops the sign-out: it is finished first.
    await page.unrouteAll();
    await page.getByRole('button', { name: 'Upload now' }).click();
    await expect(page.getByText('A workout is in progress')).toBeVisible();
    await expect.poll(setsOfLatest).toBe(1);

    // Discarding is the user's explicit choice, and nothing of the workout stays on the device.
    await page.route('**/api/workouts/sync', (route) => route.abort());
    await page.getByRole('link', { name: 'Resume workout' }).click();
    await completeSet(page, { reps: '5' });
    await expect(dataState(page)).toHaveText('1 PENDING');
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByRole('button', { name: 'Discard and sign out' }).click();
    await expect(page).toHaveURL('/sign-in');
    expect(setsOfLatest()).toBe(1);
    const kept = await page.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          const open = indexedDB.open('overload-sets');
          open.addEventListener('error', () => reject(open.error));
          open.addEventListener('success', () => {
            const count = open.result.transaction('rows', 'readonly').objectStore('rows').count();
            count.addEventListener('success', () => resolve(count.result));
            count.addEventListener('error', () => reject(count.error));
          });
        }),
    );
    expect(kept).toBe(0);
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
    await expect(page.getByText('1 set not uploaded yet.')).toBeVisible();
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
    await expect(page.getByText('1 set not uploaded yet.')).toBeVisible();
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
});
