import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { savedCache } from './device-store';
import { apiFixture } from './fixture';

type Cookies = Parameters<BrowserContext['addCookies']>[0];

// History (docs/10 §9, docs/09 F3a): the Progress tab lists finished workouts, a workout's page
// shows every set, and a set is corrected or deleted there and from its tick during the workout,
// with or without signal. A user of its own; past workouts are put there through the sync batch.
const EMAIL = 'history@example.test';
let userId = '';

test.beforeAll(() => {
  const created: { userId: string } = JSON.parse(apiFixture('user', EMAIL));
  ({ userId } = created);
});

test.afterAll(() => {
  apiFixture('delete', EMAIL);
});

test.beforeEach(async ({ context, page }) => {
  const cookies: Cookies = JSON.parse(apiFixture('cookies', userId, 'localhost'));
  await context.addCookies(cookies);
  const profile = await page.request.patch('/api/me/profile', {
    data: { timezone: 'Asia/Tokyo', weightUnit: 'kg' },
  });
  expect(profile.ok()).toBe(true);
});

const WORKOUT_PAGE = /\/workouts\/[0-9a-f-]{36}$/;
const MINUTE_MS = 60 * 1000;

const dataState = (page: Page) => page.locator('.data-state');
const tabs = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const sections = (page: Page) => page.getByRole('navigation', { name: 'Progress' });
/** The line a screen says once about what was just done. */
const said = (page: Page, words: string | RegExp) =>
  page.getByRole('status').filter({ hasText: words });

async function exerciseId(page: Page, name: string) {
  const library = await page.request.get('/api/exercises');
  const { items }: { items: { id: string; name: string }[] } = await library.json();
  const found = items.find((item) => item.name === name);
  if (found === undefined) throw new Error(`no exercise named ${name}`);
  return found.id;
}

type Logged = { weightKg: number; reps: number; rir?: number; isWarmup?: boolean };

/** One finished workout of one exercise, as the sync batch takes it. */
function workoutRows(
  exercise: string,
  {
    name,
    startedAt,
    minutes,
    sets,
  }: { name: string; startedAt: string; minutes: number; sets: Logged[] },
) {
  const started = Date.parse(startedAt);
  const endedAt = new Date(started + minutes * MINUTE_MS).toISOString();
  const workoutId = randomUUID();
  const workoutExerciseId = randomUUID();
  return {
    workoutId,
    workouts: [
      {
        id: workoutId,
        routineId: null,
        name,
        startedAt,
        endedAt,
        note: null,
        clientUpdatedAt: endedAt,
      },
    ],
    workoutExercises: [
      {
        id: workoutExerciseId,
        workoutId,
        exerciseId: exercise,
        routineExerciseId: null,
        position: 0,
        targetSets: sets.length,
        repLow: 6,
        repHigh: 10,
        incrementKg: 2.5,
        clientUpdatedAt: startedAt,
      },
    ],
    sets: sets.map((set, position) => {
      const performedAt = new Date(started + (position + 1) * MINUTE_MS).toISOString();
      return {
        id: randomUUID(),
        workoutExerciseId,
        position,
        weightKg: set.weightKg,
        reps: set.reps,
        rir: set.rir ?? null,
        rpe: null,
        isWarmup: set.isWarmup ?? false,
        performedAt,
        clientUpdatedAt: performedAt,
      };
    }),
  };
}

/** Puts one finished workout on the server, and resolves to its id. */
async function log(page: Page, exercise: string, workout: Parameters<typeof workoutRows>[1]) {
  const { workoutId, ...rows } = workoutRows(exercise, workout);
  const response = await page.request.post('/api/workouts/sync', { data: rows });
  expect(response.ok()).toBe(true);
  return workoutId;
}

/** A workout's sets as the server holds them, `[kg, reps, rir]` each, or `undefined` with none. */
async function onServer(page: Page, workoutId: string) {
  const response = await page.request.get(`/api/workouts/${workoutId}`);
  if (response.status() === 404) return undefined;
  expect(response.ok()).toBe(true);
  const workout: {
    exercises: { sets: { weightKg: number; reps: number; rir: number | null }[] }[];
  } = await response.json();
  return workout.exercises.flatMap((exercise) =>
    exercise.sets.map((set) => [set.weightKg, set.reps, set.rir]),
  );
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
          count.addEventListener('error', () => reject(count.error));
          count.addEventListener('success', () => {
            open.result.close();
            resolve(count.result);
          });
        });
      }),
  );

async function goOffline(context: BrowserContext) {
  await context.setOffline(true);
  await context.route('**/api/**', (route) => route.abort('internetdisconnected'));
}

async function goOnline(context: BrowserContext) {
  await context.unrouteAll();
  await context.setOffline(false);
}

/** The sets of one exercise on a workout's page, as its list items. */
const setsOf = (page: Page, exercise: string) =>
  page.getByRole('region', { name: new RegExp(`^${exercise}`) }).getByRole('listitem');

/** Opens the editor of one set on a workout's page: `set 2`, or `the warm-up set`. */
async function openEditor(page: Page, exercise: string, row: number, name: string) {
  await setsOf(page, exercise).nth(row).getByRole('button', { name: /EDIT$/ }).click();
  const editor = page.getByRole('form', { name: `Edit ${name}` });
  await expect(editor).toBeVisible();
  return editor;
}

test('the Progress tab lists finished workouts by month, newest first, and opens one', async ({
  page,
}) => {
  const bench = await exerciseId(page, 'Barbell Bench Press');
  const squat = await exerciseId(page, 'Barbell Back Squat');
  // 18:30 on Friday 6 March 2026 and 19:00 on Wednesday 17 September 2025, in Tokyo.
  const push = await log(page, bench, {
    name: 'Push A',
    startedAt: '2026-03-06T09:30:00.000Z',
    minutes: 54,
    sets: [
      // Heavier than any working set: it is listed on the workout's page and counted nowhere (S6).
      { weightKg: 200, reps: 1, isWarmup: true },
      { weightKg: 80, reps: 10, rir: 2 },
      { weightKg: 80, reps: 9, rir: 1 },
      { weightKg: 82.5, reps: 6 },
    ],
  });
  await log(page, squat, {
    name: 'Legs A',
    startedAt: '2025-09-17T10:00:00.000Z',
    minutes: 40,
    sets: [{ weightKg: 100, reps: 5 }],
  });

  await page.goto('/');
  await tabs(page).getByRole('link', { name: 'Progress' }).click();
  await expect(page).toHaveURL('/progress');
  await expect(page.getByRole('heading', { name: 'Progress', level: 1 })).toBeVisible();
  await expect(page.getByText('2 WORKOUTS')).toBeVisible();
  await expect(sections(page).getByRole('link', { name: 'History' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  // A list a month, newest first, each workout with its date, length, working sets and top sets.
  await expect(page.getByRole('heading', { name: /^\w+ 202\d$/, level: 2 })).toHaveText([
    'March 2026',
    'September 2025',
  ]);
  const march = page.getByRole('region', { name: 'March 2026' }).getByRole('link');
  await expect(march).toHaveCount(1);
  await expect(march).toContainText('Push A');
  await expect(march).toContainText('FRI 6 MAR · 54 MIN · 3 SETS');
  await expect(march).toContainText('Barbell Bench Press 82.5 × 6');
  // Every month is three letters, September too.
  const september = page.getByRole('region', { name: 'September 2025' }).getByRole('link');
  await expect(september).toContainText('WED 17 SEP · 40 MIN · 1 SET');
  await expect(september).toContainText('Barbell Back Squat 100 × 5');

  // Strength and Balance are places already, and say they hold nothing yet.
  await sections(page).getByRole('link', { name: 'Strength' }).click();
  await expect(page).toHaveURL('/progress/strength');
  await expect(page.getByRole('heading', { name: 'Strength is not here yet' })).toBeVisible();
  await sections(page).getByRole('link', { name: 'Balance' }).click();
  await expect(page).toHaveURL('/progress/balance');
  await expect(page.getByRole('heading', { name: 'Balance is not here yet' })).toBeVisible();
  await expect(tabs(page).getByRole('link', { name: 'Progress' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  // Today's last workout is the newest one, and Back from it returns to Today.
  await tabs(page).getByRole('link', { name: 'Today' }).click();
  const last = page.getByRole('region', { name: 'Last workout' }).getByRole('link');
  await expect(last).toContainText('Push A · Fri 6 Mar');
  await expect(last).toContainText('3 working sets · 54 min');
  await last.click();
  await expect(page).toHaveURL(`/workouts/${push}`);
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL('/');

  // The workout's page: when it was, its three figures, and every set as logged.
  await tabs(page).getByRole('link', { name: 'Progress' }).click();
  await march.click();
  await expect(page).toHaveURL(`/workouts/${push}`);
  await expect(page.getByRole('heading', { name: 'Push A', level: 1 })).toBeVisible();
  await expect(page.getByText('FRI 6 MAR · 18:30 · 54 MIN')).toBeVisible();
  const stats = page.getByRole('definition');
  await expect(stats.nth(0)).toContainText('3');
  // 80 × 10 + 80 × 9 + 82.5 × 6, the warm-up left out.
  await expect(stats.nth(1)).toContainText('2,015');
  await expect(stats.nth(2)).toContainText('54');
  const sets = setsOf(page, 'Barbell Bench Press');
  await expect(sets).toHaveCount(4);
  await expect(sets.nth(0).getByRole('button')).toHaveAccessibleName(/Warm-up set.*200.*1 reps/s);
  await expect(sets.nth(1).getByRole('button')).toHaveAccessibleName(
    /Set\s*1.*80.*10 reps.*RIR\s*2.*EDIT/s,
  );
  await expect(sets.nth(3).getByRole('button')).toHaveAccessibleName(
    /Set\s*3.*82\.5.*6 reps.*not recorded/s,
  );

  // An exercise's name opens its chart, whose past sets lead back to the workout.
  await page.getByRole('link', { name: /^Barbell Bench Press/ }).click();
  await expect(page).toHaveURL(`/exercises/${bench}/progress`);
  await page.getByRole('radio', { name: 'All time' }).check();
  const past = page.getByRole('region', { name: 'Past sets · 1 workout' }).getByRole('listitem');
  await expect(past).toContainText('Fri 6 Mar · Push A');
  await expect(past).toContainText('80×10 · 80×9 · 82.5×6');
  // 80 × (1 + 10/30), the best working set's estimate.
  await expect(past).toContainText('106.7');
  await past.getByRole('link').click();
  await expect(page).toHaveURL(`/workouts/${push}`);

  // Back retraces the way in: the chart, the workout, then History.
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL(`/exercises/${bench}/progress?span=all`);
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL(`/workouts/${push}`);
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL('/progress');
});

test('a workout that is not in the account’s history says so', async ({ page }) => {
  await page.goto(`/workouts/${randomUUID()}`);
  await expect(page.getByText('This workout is not in your history.')).toBeVisible();
  // Opened by its address, Back goes to History.
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL('/progress');
});

test('History is read a page at a time', async ({ page }) => {
  const curl = await exerciseId(page, 'Barbell Curl');
  // 31 workouts, a day apart, in one batch: one more than a page.
  const first = Date.parse('2025-11-01T09:00:00.000Z');
  const batch = Array.from({ length: 31 }, (_, day) =>
    workoutRows(curl, {
      name: `Paged ${day + 1}`,
      startedAt: new Date(first + day * 24 * 60 * MINUTE_MS).toISOString(),
      minutes: 30,
      sets: [{ weightKg: 30, reps: 10 }],
    }),
  );
  const response = await page.request.post('/api/workouts/sync', {
    data: {
      workouts: batch.flatMap((rows) => rows.workouts),
      workoutExercises: batch.flatMap((rows) => rows.workoutExercises),
      sets: batch.flatMap((rows) => rows.sets),
    },
  });
  expect(response.ok()).toBe(true);
  const { total }: { total: number } = await (await page.request.get('/api/workouts')).json();
  expect(total).toBeGreaterThanOrEqual(31);

  await page.goto('/progress');
  // The count is of every finished workout, not of the page loaded.
  await expect(page.getByText(`${total} WORKOUTS`)).toBeVisible();
  const rows = page.getByRole('main').getByRole('link', { name: /MIN ·/ });
  await expect(rows).toHaveCount(30);
  await expect(page.getByRole('link', { name: /^Paged 1(?!\d)/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Show earlier workouts' }).click();
  await expect(rows).toHaveCount(total);
  await expect(page.getByRole('link', { name: /^Paged 1(?!\d)/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show earlier workouts' })).toHaveCount(0);
});

test('a finished workout opens its page, and a set corrected there reaches the server, the chart and the next target', async ({
  page,
}) => {
  const name = `Corrected ${Date.now()}`;
  const press = await exerciseId(page, 'Barbell Overhead Press');
  const routine = await page.request.post('/api/routines', {
    data: {
      id: randomUUID(),
      name,
      exercises: [{ id: randomUUID(), exerciseId: press, targetSets: 2, repLow: 6, repHigh: 10 }],
    },
  });
  expect(routine.ok()).toBe(true);
  const start = async () => {
    await page.goto('/');
    await page.getByRole('button', { name: new RegExp(`${name}.*Start this workout`) }).click();
    await expect(page).toHaveURL('/workout');
  };
  const weight = page.getByRole('textbox', { name: 'Weight in kilograms' });

  // Two sets of 6–10 at 50 kg: the second stops at 9, so the weight is not due to go up.
  await start();
  await weight.fill('50');
  await page.getByRole('textbox', { name: 'Reps', exact: true }).fill('10');
  await page.getByRole('button', { name: 'Complete set' }).click();
  await expect(page.getByRole('region', { name: 'SET 2 OF 2' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Reps', exact: true }).fill('9');
  await page.getByRole('button', { name: 'Complete set' }).click();
  await expect(page.getByRole('region', { name: 'SET 3 · EXTRA' })).toBeVisible();

  // Finish lands on the workout's own page in History, which says so once.
  await page.getByRole('button', { name: 'Finish workout' }).click();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page).toHaveURL(WORKOUT_PAGE);
  const workoutId = new URL(page.url()).pathname.split('/').at(-1) ?? '';
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  await expect(said(page, 'Workout finished. It is in History from now on.')).toBeVisible();
  const sets = setsOf(page, 'Barbell Overhead Press');
  await expect(sets).toHaveCount(2);
  // The upload's answer lets the workout's rows leave the device; the page keeps what they said.
  await expect(dataState(page)).toContainText('SYNCED');
  await expect.poll(() => rowsOnDevice(page)).toBe(0);
  await expect(sets).toHaveCount(2);
  await expect
    .poll(() => onServer(page, workoutId))
    .toEqual([
      [50, 10, null],
      [50, 9, null],
    ]);
  await page.reload();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  await expect(said(page, 'Workout finished')).toHaveCount(0);
  // Back from a workout Finish opened goes to History, where it is listed.
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL('/progress');
  await page.getByRole('link', { name: new RegExp(`^${name}`) }).click();
  await expect(page).toHaveURL(`/workouts/${workoutId}`);

  // The second set is corrected to 10 reps. A figure the server would refuse is refused first.
  const editor = await openEditor(page, 'Barbell Overhead Press', 1, 'set 2');
  await expect(editor.getByRole('textbox', { name: /^Kg of set 2/ })).toHaveValue('50');
  const reps = editor.getByRole('textbox', { name: 'Reps of set 2' });
  await reps.fill('0');
  await editor.getByRole('button', { name: 'Save set' }).click();
  await expect(editor.getByRole('alert')).toContainText('Reps are a whole number, 1 to 100');
  await expect(reps).toBeFocused();
  await reps.fill('10');
  await editor.getByRole('textbox', { name: 'RIR of set 2, optional' }).fill('1');
  // Last time is asked again once the edit has uploaded: the answer that carries the new target.
  const lastTime = page.waitForResponse(async (response) => {
    if (!response.url().includes('/api/training/last-time') || !response.ok()) return false;
    const body: { exercises: { exerciseId: string; suggestion: { weightKg: number } }[] } =
      await response.json();
    return body.exercises.some(
      (each) => each.exerciseId === press && each.suggestion.weightKg === 52.5,
    );
  });
  await editor.getByRole('button', { name: 'Save set' }).click();
  await expect(
    said(page, 'Set saved. Charts, last time and the target use the new figures.'),
  ).toBeVisible();
  await expect(editor).toHaveCount(0);
  await expect(sets.nth(1).getByRole('button')).toBeFocused();
  await expect(sets.nth(1).getByRole('button')).toHaveAccessibleName(/50.*10 reps.*RIR\s*1/s);
  await expect
    .poll(() => onServer(page, workoutId))
    .toEqual([
      [50, 10, null],
      [50, 10, 1],
    ]);
  await lastTime;
  await expect(dataState(page)).toContainText('SYNCED');
  await expect.poll(() => rowsOnDevice(page)).toBe(0);

  // The chart draws the corrected set: 50 × (1 + 10/30) either way, with both sets now at 10.
  await page.getByRole('link', { name: /^Barbell Overhead Press/ }).click();
  const past = page.getByRole('region', { name: /^Past sets/ }).getByRole('listitem');
  await expect(past.first()).toContainText('50 × 10 · 10');
  await expect(past.first()).toContainText('66.7');

  // And the next workout's target follows it: every set reached 10, so the weight goes up.
  await start();
  await expect(weight).toHaveValue('52.5');
  // Finished with no set, this one is not kept.
  await page.getByRole('button', { name: 'Finish workout' }).click();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page).toHaveURL('/');
});

test('a past set is edited and another deleted with no signal, and both arrive when it returns', async ({
  page,
  context,
  browserName,
}) => {
  const squat = await exerciseId(page, 'Barbell Front Squat');
  const workoutId = await log(page, squat, {
    name: 'Legs B',
    startedAt: '2026-04-10T09:00:00.000Z',
    minutes: 45,
    sets: [
      { weightKg: 60, reps: 5, isWarmup: true },
      { weightKg: 90, reps: 5, rir: 2 },
      { weightKg: 90, reps: 5, rir: 1 },
      { weightKg: 90, reps: 4, rir: 0 },
    ],
  });
  const before = await onServer(page, workoutId);

  // Opened from History with signal, so the device has a copy of both.
  await page.goto('/progress');
  await page.getByRole('link', { name: /^Legs B/ }).click();
  await expect(page).toHaveURL(`/workouts/${workoutId}`);
  const sets = setsOf(page, 'Barbell Front Squat');
  await expect(sets).toHaveCount(4);
  await expect(dataState(page)).toContainText('SYNCED');
  // The saved copy is written at most once a second: a relaunch reads what has landed.
  await expect.poll(() => savedCache(page, userId)).toContain('"queryKey":["workouts","list"]');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await goOffline(context);

  // Set 3 is corrected, RIR cleared with it.
  const edit = await openEditor(page, 'Barbell Front Squat', 3, 'set 3');
  await edit.getByRole('textbox', { name: /^Kg of set 3/ }).fill('92.5');
  await edit.getByRole('textbox', { name: 'Reps of set 3' }).fill('5');
  await edit.getByRole('textbox', { name: 'RIR of set 3, optional' }).fill('');
  await edit.getByRole('button', { name: 'Save set' }).click();
  await expect(said(page, 'Set saved.')).toBeVisible();
  await expect(sets.nth(3).getByRole('button')).toHaveAccessibleName(
    /92\.5.*5 reps.*not recorded/s,
  );
  await expect(dataState(page)).toHaveText('1 PENDING');
  // The three figures follow at once: three working sets, 90 × 5 twice and 92.5 × 5.
  await expect(page.getByRole('definition').nth(1)).toContainText('1,363');

  // Cancel changes nothing, and Delete asks first: Keep goes back to the editor.
  const cancelled = await openEditor(page, 'Barbell Front Squat', 1, 'set 1');
  await cancelled.getByRole('textbox', { name: 'Reps of set 1' }).fill('1');
  await cancelled.getByRole('button', { name: 'Cancel' }).click();
  await expect(sets.nth(1).getByRole('button')).toHaveAccessibleName(/90.*5 reps/s);
  await expect(sets.nth(1).getByRole('button')).toBeFocused();
  const warmup = await openEditor(page, 'Barbell Front Squat', 0, 'the warm-up set');
  await warmup.getByRole('button', { name: 'Delete set' }).click();
  await expect(
    warmup.getByText('Delete the warm-up set? It leaves this workout, your charts and last time.'),
  ).toBeVisible();
  await expect(warmup.getByRole('button', { name: 'Keep' })).toBeFocused();
  await warmup.getByRole('button', { name: 'Keep' }).click();
  await expect(warmup.getByRole('button', { name: 'Delete set' })).toBeFocused();
  await warmup.getByRole('button', { name: 'Delete set' }).click();
  await warmup.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(
    said(page, 'Set deleted. Charts, last time and the target no longer count it.'),
  ).toBeVisible();
  await expect(sets).toHaveCount(3);
  await expect(sets.nth(0).getByRole('button')).toHaveAccessibleName(/Set\s*1.*90.*5 reps/s);
  await expect(dataState(page)).toHaveText('1 PENDING');

  // Nothing has reached the server, and a relaunch with no signal still shows both changes. The
  // relaunch is a second page (workout.spec.ts says why); Playwright's WebKit cannot open a
  // service-worker page offline.
  expect(await onServer(page, workoutId)).toEqual(before);
  if (browserName !== 'webkit') {
    const relaunched = await context.newPage();
    await relaunched.goto(`/workouts/${workoutId}`);
    const kept = setsOf(relaunched, 'Barbell Front Squat');
    await expect(kept).toHaveCount(3);
    await expect(kept.nth(2).getByRole('button')).toHaveAccessibleName(/92\.5.*5 reps/s);
    await expect(dataState(relaunched)).toHaveText('1 PENDING');
    // History lists it as the device has it: three working sets, the corrected one on top.
    await relaunched.goto('/progress');
    const listed = relaunched.getByRole('link', { name: /^Legs B/ });
    await expect(listed).toContainText('3 SETS');
    await expect(listed).toContainText('Barbell Front Squat 92.5 × 5');
    await relaunched.close();
  }

  // The signal returns: the edit and the delete go in one batch, and the rows leave the device.
  await goOnline(context);
  await expect(dataState(page)).toContainText('SYNCED');
  await expect
    .poll(() => onServer(page, workoutId))
    .toEqual([
      [90, 5, 2],
      [90, 5, 1],
      [92.5, 5, null],
    ]);
  await expect.poll(() => rowsOnDevice(page)).toBe(0);
  await expect(sets).toHaveCount(3);
  await page.reload();
  await expect(sets).toHaveCount(3);
  await expect(sets.nth(2).getByRole('button')).toHaveAccessibleName(/92\.5.*5 reps/s);
});

test('deleting the last set of a workout removes the workout', async ({ page }) => {
  const row = await exerciseId(page, 'Bent Over Barbell Row');
  const workoutId = await log(page, row, {
    name: 'Pull once',
    startedAt: '2026-05-12T09:00:00.000Z',
    minutes: 20,
    sets: [{ weightKg: 70, reps: 8 }],
  });

  await page.goto('/progress');
  await page.getByRole('link', { name: /^Pull once/ }).click();
  await expect(page).toHaveURL(`/workouts/${workoutId}`);
  const editor = await openEditor(page, 'Bent Over Barbell Row', 0, 'set 1');
  await editor.getByRole('button', { name: 'Delete set' }).click();
  await editor.getByRole('button', { name: 'Delete', exact: true }).click();

  // It lands on History, which says why, and no longer lists it.
  await expect(page).toHaveURL('/progress');
  await expect(said(page, 'That was its last set, so the workout was removed.')).toBeVisible();
  await expect(page.getByRole('link', { name: /^Pull once/ })).toHaveCount(0);
  await expect.poll(() => onServer(page, workoutId)).toBeUndefined();
  await expect(dataState(page)).toContainText('SYNCED');
  await expect.poll(() => rowsOnDevice(page)).toBe(0);

  // Said once: a reload does not say it again, and the workout stays gone.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Progress', level: 1 })).toBeVisible();
  await expect(said(page, 'That was its last set')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /^Pull once/ })).toHaveCount(0);
  await page.goto(`/workouts/${workoutId}`);
  await expect(page.getByText('This workout is not in your history.')).toBeVisible();
});

test('a set logged today is corrected and deleted from its tick, with the same editor', async ({
  page,
}) => {
  const name = `Ticked ${Date.now()}`;
  const curl = await exerciseId(page, 'Dumbbell Hammer Curl');
  const routine = await page.request.post('/api/routines', {
    data: { id: randomUUID(), name, exercises: [{ id: randomUUID(), exerciseId: curl }] },
  });
  expect(routine.ok()).toBe(true);
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(`${name}.*Start this workout`) }).click();
  await expect(page).toHaveURL('/workout');

  const weight = page.getByRole('textbox', { name: 'Weight in kilograms' });
  const reps = page.getByRole('textbox', { name: 'Reps', exact: true });
  await weight.fill('14');
  await reps.fill('12');
  await page.getByRole('button', { name: 'Complete set' }).click();
  await expect(page.getByRole('region', { name: 'SET 2 OF 3' })).toBeVisible();
  await reps.fill('11');
  await page.getByRole('button', { name: 'Complete set' }).click();
  await expect(page.getByRole('region', { name: 'SET 3 OF 3' })).toBeVisible();
  await expect(dataState(page)).toContainText('SYNCED');

  // The tick of set 2 opens the editor under its row; the weight was 16, not 14.
  const tick = page.getByRole('button', { name: 'Set 2 done. Edit' });
  await expect(tick).toHaveAttribute('aria-expanded', 'false');
  await tick.click();
  await expect(tick).toHaveAttribute('aria-expanded', 'true');
  const editor = page.getByRole('form', { name: 'Edit set 2' });
  await editor.getByRole('textbox', { name: /^Kg of set 2/ }).fill('16');
  await editor.getByRole('button', { name: 'Save set' }).click();
  await expect(editor).toHaveCount(0);
  await expect(tick).toBeFocused();
  await expect(page.getByRole('row', { name: /^2 (\S+ × \S+ )?16 11 / })).toBeVisible();
  // The card for the next set opens on the corrected weight.
  await expect(weight).toHaveValue('16');
  await expect(dataState(page)).toContainText('SYNCED');
  const workoutId = async () => {
    const list: { items: { id: string; name: string }[] } = await (
      await page.request.get('/api/workouts')
    ).json();
    return list.items.find((item) => item.name === name)?.id;
  };

  // Deleting set 1 from its tick asks first, then the set after it is the first.
  await page.getByRole('button', { name: 'Set 1 done. Edit' }).click();
  const first = page.getByRole('form', { name: 'Edit set 1' });
  await first.getByRole('button', { name: 'Delete set' }).click();
  await expect(first.getByText('Delete set 1? It leaves this workout')).toBeVisible();
  await first.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('row', { name: /^1 (\S+ × \S+ )?16 11 / })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Set 2 done. Edit' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'SET 2 OF 3' })).toBeVisible();

  // Finished, the server holds the one set as corrected.
  await page.getByRole('button', { name: 'Finish workout' }).click();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page).toHaveURL(WORKOUT_PAGE);
  await expect(setsOf(page, 'Dumbbell Hammer Curl')).toHaveCount(1);
  await expect.poll(workoutId).toBeDefined();
  await expect
    .poll(async () => onServer(page, (await workoutId()) ?? ''))
    .toEqual([[16, 11, null]]);
});
