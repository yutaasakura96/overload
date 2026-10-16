import { expect, test, type Page } from '@playwright/test';
import { apiFixture, chooseTimezone } from './fixture';

type Cookies = Parameters<import('@playwright/test').BrowserContext['addCookies']>[0];

type StoredWorkout = {
  name: string;
  routineId: string | null;
  endedAt: string | null;
  exercises: { name: string; sets: { weightKg: number; reps: number }[] }[];
};

// S4 in a live workout (docs/09 F3 step 4) and a workout from no routine (F2 step 3), on the real
// write path: every change goes to the set store first and uploads through sync. A user of its own,
// so its workouts never reach the other specs' account.
const EMAIL = 'workout-changes@example.test';
let userId = '';

const stored = (): StoredWorkout[] => JSON.parse(apiFixture('workouts', userId));

test.beforeEach(async ({ context }) => {
  const created: { userId: string } = JSON.parse(apiFixture('user', EMAIL));
  ({ userId } = created);
  const cookies: Cookies = JSON.parse(apiFixture('cookies', userId, 'localhost'));
  await context.addCookies(cookies);
});

test.afterAll(() => {
  apiFixture('delete', EMAIL);
});

const dataState = (page: Page) => page.locator('.data-state');
const brief = (page: Page) => page.locator('.brief');
const changes = (page: Page) => page.getByRole('region', { name: 'Change exercises' });

async function saveProfile(page: Page) {
  await page.goto('/');
  await chooseTimezone(page, 'Asia/Tokyo');
  await page.getByRole('button', { name: /^Save (profile|and finish setup)$/ }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
}

async function addExercises(page: Page, names: string[]) {
  await changes(page).getByRole('button', { name: 'Add exercises' }).click();
  for (const name of names) await page.getByRole('checkbox', { name, exact: true }).check();
  await page
    .getByRole('button', {
      name: `Add ${names.length} ${names.length === 1 ? 'exercise' : 'exercises'}`,
    })
    .click();
  await expect(changes(page).getByRole('button', { name: 'Add exercises' })).toBeFocused();
}

async function completeSet(page: Page, weight: string, reps: string) {
  await page.getByRole('textbox', { name: /^Weight in/ }).fill(weight);
  await page.getByRole('textbox', { name: 'Reps', exact: true }).fill(reps);
  await page.getByRole('button', { name: 'Complete set' }).click();
}

const order = (page: Page) => changes(page).locator('.slot__name');

test('starts an empty workout, adds two exercises, logs a set and finishes', async ({ page }) => {
  await saveProfile(page);
  const empty = page.getByRole('region', { name: 'No routines yet' });
  await expect(empty.getByRole('button', { name: 'Create a routine' })).toBeVisible();
  await empty.getByRole('button', { name: 'Start an empty workout' }).click();
  await expect(page.getByRole('textbox', { name: 'Workout name' })).toBeFocused();
  await page.getByRole('button', { name: 'Start workout' }).click();

  await expect(page).toHaveURL('/workout');
  await expect(page.getByRole('heading', { name: 'Workout', level: 1 })).toBeVisible();
  await expect(page.getByText('No exercises yet.')).toBeVisible();
  await addExercises(page, ['Barbell Bench Press', 'Barbell Back Squat']);
  await expect(page.getByRole('heading', { name: 'Barbell Bench Press', level: 2 })).toBeVisible();
  await expect(page.getByText('1 OF 2')).toBeVisible();

  await completeSet(page, '80', '10');
  await expect(page.getByRole('row', { name: /^1 80 10/ })).toBeVisible();
  await expect(dataState(page)).toContainText('SYNCED');
  await page.getByRole('button', { name: 'Finish workout' }).click();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page).toHaveURL(/\/workouts\/[0-9a-f-]{36}$/);

  await expect.poll(() => stored()[0]?.endedAt ?? null).not.toBeNull();
  const [workout] = stored();
  expect(workout?.name).toBe('Workout');
  expect(workout?.routineId).toBeNull();
  expect(workout?.exercises.map((exercise) => exercise.name)).toEqual([
    'Barbell Bench Press',
    'Barbell Back Squat',
  ]);
  expect(workout?.exercises[0]?.sets).toMatchObject([{ weightKg: 80, reps: 10 }]);

  // The next one is named, and an exercise added to it opens on last time and its target (F3 step 1).
  await page.goto('/');
  await page.getByRole('button', { name: 'Start an empty workout', exact: true }).click();
  await page.getByRole('textbox', { name: 'Workout name' }).fill('Upper day');
  await page.getByRole('button', { name: 'Start workout' }).click();
  await expect(page.getByRole('heading', { name: 'Upper day', level: 1 })).toBeVisible();
  await addExercises(page, ['Barbell Bench Press']);
  await expect(brief(page)).toContainText('80 kg × 10');
  await expect(brief(page)).toContainText('82.5 kg × 6–10');

  // One workout at a time: while it is open, Today offers to resume it and no other start.
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Resume workout' })).toBeVisible();
  await expect(page.getByRole('button', { name: /empty workout/i })).toHaveCount(0);
  await page.getByRole('link', { name: 'Resume workout' }).click();
  await expect(page).toHaveURL('/workout');

  // Finished with no set, it is not kept.
  await page.getByRole('button', { name: 'Finish workout' }).click();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page).toHaveURL('/');
  await expect(dataState(page)).toContainText('SYNCED');
  await expect.poll(() => stored().length).toBe(1);
});

test('adds, reorders and removes exercises offline, then uploads them, leaving the routine as it was', async ({
  page,
  context,
}) => {
  await saveProfile(page);
  const routine = `Push ${Date.now()}`;
  await page.goto('/routines/new');
  await page.getByRole('textbox', { name: 'Name' }).fill(routine);
  await page.getByRole('button', { name: 'Add exercises' }).click();
  await page.getByRole('checkbox', { name: 'Barbell Bench Press', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Barbell Back Squat', exact: true }).check();
  await page.getByRole('button', { name: 'Add 2 exercises' }).click();
  await page.getByRole('button', { name: 'Create routine' }).click();
  await expect(page).toHaveURL('/routines');

  await page.getByRole('link', { name: 'Today' }).click();
  await page.getByRole('button', { name: new RegExp(`${routine}.*Start this workout`) }).click();
  await expect(page).toHaveURL('/workout');
  await completeSet(page, '80', '10');
  await expect(dataState(page)).toContainText('SYNCED');
  await page.getByRole('button', { name: /^Barbell Back Squat/ }).click();
  await completeSet(page, '100', '5');
  await expect(dataState(page)).toContainText('SYNCED');

  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await context.route('**/api/**', (route) => route.abort('internetdisconnected'));

  await addExercises(page, ['Barbell Deadlift']);
  await changes(page).getByRole('button', { name: 'Reorder or remove' }).click();
  await expect(order(page)).toHaveText([
    'Barbell Bench Press',
    'Barbell Back Squat · Open',
    'Barbell Deadlift',
  ]);
  const up = page.getByRole('button', { name: 'Move Barbell Deadlift up' });
  await up.click();
  await expect(up).toBeFocused();
  await up.click();
  await expect(up).toHaveAttribute('aria-disabled', 'true');
  await expect(order(page)).toHaveText([
    'Barbell Deadlift',
    'Barbell Bench Press',
    'Barbell Back Squat · Open',
  ]);

  // A logged set goes with its exercise, so that asks first.
  await page.getByRole('button', { name: 'Remove Barbell Back Squat' }).click();
  await expect(
    page.getByText('Remove Barbell Back Squat? Its 1 logged set goes with it.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Keep' })).toBeFocused();
  await changes(page).getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(order(page)).toHaveText(['Barbell Deadlift · Open', 'Barbell Bench Press']);
  await expect(dataState(page)).toContainText('PENDING');
  expect(stored()[0]?.exercises.map((exercise) => exercise.name)).toEqual([
    'Barbell Bench Press',
    'Barbell Back Squat',
  ]);

  await context.unrouteAll();
  await context.setOffline(false);
  await expect(dataState(page)).toContainText('SYNCED');
  await expect
    .poll(() => stored()[0]?.exercises.map((exercise) => exercise.name))
    .toEqual(['Barbell Deadlift', 'Barbell Bench Press']);
  expect(stored()[0]?.exercises[1]?.sets).toMatchObject([{ weightKg: 80, reps: 10 }]);

  // One workout at a time: an empty one asks first while this one is open (docs/09 F3).
  await page.goto('/');
  await page.getByRole('button', { name: /Empty workout.*Start an empty workout/ }).click();
  await expect(page.getByText(`Finish ${routine} first?`)).toBeVisible();
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page).toHaveURL('/workout');

  // The routine is as it was made (S4).
  await page.goto('/routines');
  await expect(page.getByRole('link', { name: new RegExp(routine) })).toContainText('2 EXERCISES');
  await expect(page.getByRole('link', { name: new RegExp(routine) })).toContainText(
    'Barbell Bench Press, Barbell Back Squat',
  );
});
