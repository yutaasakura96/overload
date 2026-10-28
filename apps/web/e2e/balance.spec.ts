import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { apiFixture } from './fixture';

type Cookies = Parameters<BrowserContext['addCookies']>[0];

// Muscle balance (docs/10 §9, issue #50): every group's sets a week against the 10–20 range, the
// half count for indirect work, a row opened on its sources, the evidence tag's sources sheet, and
// the second view; then a custom exercise given the groups it also trains. A user of its own, with
// workouts put there through the sync batch.
const EMAIL = 'balance@example.test';
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

const DAY_MS = 24 * 60 * 60 * 1000;

async function exerciseId(page: Page, name: string) {
  const library = await page.request.get('/api/exercises');
  const { items }: { items: { id: string; name: string }[] } = await library.json();
  const found = items.find((item) => item.name === name);
  if (found === undefined) throw new Error(`no exercise named ${name}`);
  return found.id;
}

/** One finished workout, `daysAgo` days back, of each exercise with its working sets. */
async function log(page: Page, daysAgo: number, exercises: [id: string, working: number][]) {
  const stamp = new Date(Date.now() - daysAgo * DAY_MS).toISOString();
  const workoutId = randomUUID();
  const slots = exercises.map(([id, working]) => ({ id, working, slot: randomUUID() }));
  const response = await page.request.post('/api/workouts/sync', {
    data: {
      workouts: [
        {
          id: workoutId,
          routineId: null,
          name: 'Push A',
          startedAt: stamp,
          endedAt: stamp,
          note: null,
          clientUpdatedAt: stamp,
        },
      ],
      workoutExercises: slots.map((each, position) => ({
        id: each.slot,
        workoutId,
        exerciseId: each.id,
        routineExerciseId: null,
        position,
        targetSets: each.working,
        repLow: 6,
        repHigh: 10,
        incrementKg: 2.5,
        clientUpdatedAt: stamp,
      })),
      sets: slots.flatMap((each) =>
        Array.from({ length: each.working }, (_, position) => ({
          id: randomUUID(),
          workoutExerciseId: each.slot,
          position,
          weightKg: 60,
          reps: 8,
          rir: null,
          rpe: null,
          isWarmup: false,
          performedAt: stamp,
          clientUpdatedAt: stamp,
        })),
      ),
    },
  });
  expect(response.ok()).toBe(true);
}

const row = (page: Page, name: string) =>
  page.getByRole('button', { name: new RegExp(`^${name}, `) });

/** A row's name opening on its figure: `Chest, 12.5 sets a week, `. */
const reads = (name: string, sets: number) =>
  new RegExp(`^${name}, ${String(sets).replace('.', '\\.')} sets a week, `);

test('balance reads each group against the range, with indirect work at half', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const bench = await exerciseId(page, 'Barbell Bench Press');
  const press = await exerciseId(page, 'Seated Dumbbell Shoulder Press');
  const squat = await exerciseId(page, 'Barbell Back Squat');
  // Four weeks of bench 12 and press 12 a week, and one week of squats: chest 12 and shoulders
  // 12 + 6 in range, triceps 6 + 6 from halves alone, quads 1 low, glutes 0.5 low.
  for (const days of [1, 8, 15, 22]) {
    await log(page, days, [
      [bench, 12],
      [press, 12],
    ]);
  }
  await log(page, 3, [[squat, 4]]);

  await page.goto('/progress/balance');
  await expect(page.getByRole('radio', { name: '4-week average' })).toBeChecked();
  const tally = page.getByRole('definition');
  await expect(tally).toHaveText(['3', '2', '6']);
  await expect(row(page, 'Chest')).toHaveAccessibleName('Chest, 12 sets a week, In range');
  await expect(row(page, 'Shoulders')).toHaveAccessibleName('Shoulders, 18 sets a week, In range');
  // Bench and shoulder press alone: triceps is trained, at half.
  await expect(row(page, 'Triceps')).toHaveAccessibleName('Triceps, 12 sets a week, In range');
  await expect(row(page, 'Quads')).toHaveAccessibleName('Quads, 1 sets a week, Low');
  await expect(row(page, 'Glutes')).toHaveAccessibleName('Glutes, 0.5 sets a week, Low');
  await expect(row(page, 'Back')).toHaveAccessibleName('Back, 0 sets a week, Not trained');
  const directKey = page.locator('.legend__swatch').first();
  const directBar = row(page, 'Quads').locator('.meter__direct');
  const [keyColour, barColour] = await Promise.all([
    directKey.evaluate((node) => getComputedStyle(node).backgroundColor),
    directBar.evaluate((node) => getComputedStyle(node).backgroundColor),
  ]);
  expect(keyColour).not.toBe(barColour);

  // A row opens on where its sets came from.
  await row(page, 'Triceps').click();
  await expect(row(page, 'Triceps')).toHaveAttribute('aria-expanded', 'true');
  await expect(
    page.getByText('Barbell Bench Press (half) 6 · Seated Dumbbell Shoulder Press (half) 6'),
  ).toBeVisible();
  await row(page, 'Back').click();
  await expect(page.getByText('No exercise in the last four weeks trains it.')).toBeVisible();
  await testInfo.attach('balance-390', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });

  // The evidence tag opens its sources, and gives focus back when the sheet closes.
  const tag = page.getByRole('button', { name: /open the sources/ });
  expect((await tag.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await tag.click();
  const sheet = page.getByRole('dialog', { name: 'Evidence' });
  await expect(sheet).toBeVisible();
  await expect(
    sheet.getByText(
      'Ten to twenty working sets a week per muscle group is a sound range to grow in.',
    ),
  ).toBeVisible();
  const sources = sheet.getByRole('link');
  await expect(sources).toHaveCount(3);
  await expect(sources.nth(0)).toHaveAttribute(
    'href',
    'https://doi.org/10.1080/02640414.2016.1210197',
  );
  await expect(sources.nth(1)).toContainText('Baz-Valle et al. · J Hum Kinet · 2022');
  await expect(sources.nth(2)).toContainText('Pelland et al. · Sports Med · 2026');
  await testInfo.attach('sources-sheet', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(tag).toBeFocused();
  await tag.click();
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toBeHidden();

  // This week is the second view, and in the address.
  await page.getByRole('radio', { name: 'This week' }).check();
  await expect(page).toHaveURL('/progress/balance?view=week');
  await page.reload();
  await expect(page.getByRole('radio', { name: 'This week' })).toBeChecked();
  await expect(page.getByText(/ – TODAY$/)).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

test('a custom exercise counts half for the groups it also trains', async ({ page }) => {
  await page.goto('/exercises/new');
  await page.getByRole('textbox', { name: 'Name' }).fill('Landmine Press');
  await page.getByRole('combobox', { name: 'Equipment' }).selectOption('barbell');
  await page.getByRole('combobox', { name: 'Muscle group' }).selectOption('shoulders');
  const also = page.getByRole('group', { name: /Also trains/ });
  // The group it is filed under is not offered.
  await expect(also.getByRole('checkbox', { name: 'Shoulders' })).toHaveCount(0);
  await also.getByRole('checkbox', { name: 'Triceps' }).check();
  await also.getByRole('checkbox', { name: 'Chest' }).check();
  await page.getByRole('button', { name: 'Create exercise' }).click();
  await expect(page).toHaveURL('/exercises');

  const landmine = await exerciseId(page, 'Landmine Press');
  const stored = await page.request.get('/api/exercises');
  const { items }: { items: { id: string; secondaryMuscleGroups: string[] }[] } =
    await stored.json();
  expect(items.find((item) => item.id === landmine)?.secondaryMuscleGroups).toEqual([
    'chest',
    'triceps',
  ]);

  await log(page, 0, [[landmine, 4]]);
  await page.goto('/progress/balance?view=week');
  await expect(row(page, 'Triceps')).toHaveAccessibleName(/^Triceps, \d+(\.\d)? sets a week/);
  await row(page, 'Triceps').click();
  await expect(page.getByText(/Landmine Press \(half\) 2/)).toBeVisible();
});

test.describe('with no service worker', () => {
  // page.route cannot hold a request a service worker forwards (WebKit).
  test.use({ serviceWorkers: 'block' });

  test('this week counts a set as soon as it is logged, and once when it reaches the server', async ({
    page,
  }) => {
    const weekly = async (group: string) => {
      const response = await page.request.get('/api/training/balance?view=week');
      const { groups }: { groups: { muscleGroup: string; sets: number }[] } = await response.json();
      return groups.find((each) => each.muscleGroup === group)?.sets ?? 0;
    };
    const chest = await weekly('chest');
    const triceps = await weekly('triceps');
    const name = `Bench ${Date.now()}`;
    await page.goto('/routines/new');
    await page.getByRole('textbox', { name: 'Name' }).fill(name);
    await page.getByRole('button', { name: 'Add exercises' }).click();
    await page.getByRole('checkbox', { name: 'Barbell Bench Press', exact: true }).check();
    await page.getByRole('button', { name: 'Add 1 exercise' }).click();
    await page.getByRole('button', { name: 'Create routine' }).click();
    await expect(page).toHaveURL('/routines');
    await page.goto('/');
    await page.getByRole('button', { name: new RegExp(`${name}.*Start this workout`) }).click();
    await expect(page).toHaveURL('/workout');
    await expect(page.locator('.data-state')).toContainText('SYNCED');

    // The set is logged with no upload getting through: only the device has it.
    await page.route('**/api/workouts/sync', (route) => route.abort('internetdisconnected'));
    await page.getByRole('textbox', { name: /^Weight in/ }).fill('60');
    await page.getByRole('textbox', { name: 'Reps', exact: true }).fill('8');
    await page.getByRole('button', { name: 'Complete set' }).click();
    await expect(page.locator('.data-state')).toHaveText('1 PENDING');
    await page.goto('/progress/balance?view=week');
    await expect(row(page, 'Chest')).toHaveAccessibleName(reads('Chest', chest + 1));
    await expect(row(page, 'Triceps')).toHaveAccessibleName(reads('Triceps', triceps + 0.5));
    expect(await weekly('chest')).toBe(chest);

    // The upload gets through: the server counts the set, and the screen still counts it once.
    await page.unrouteAll();
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect.poll(() => weekly('chest')).toBe(chest + 1);
    await expect(row(page, 'Chest')).toHaveAccessibleName(reads('Chest', chest + 1));
    await page.reload();
    await expect(row(page, 'Chest')).toHaveAccessibleName(reads('Chest', chest + 1));
  });
});
