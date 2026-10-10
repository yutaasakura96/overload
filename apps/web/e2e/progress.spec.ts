import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { apiFixture } from './fixture';

type Cookies = Parameters<BrowserContext['addCookies']>[0];

// Screen 2 (docs/10 §2, S7): the chart opens from the exercise, follows the span, reads out the
// workout picked on it, and says so when there is too little to draw. A user of its own, with
// workouts put there through the sync batch.
const EMAIL = 'progress@example.test';
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

/** One finished workout of one exercise, `daysAgo` days back: a warm-up, then one working set. */
async function log(page: Page, exercise: string, daysAgo: number, weightKg: number, reps: number) {
  const stamp = new Date(Date.now() - daysAgo * DAY_MS).toISOString();
  const workoutId = randomUUID();
  const workoutExerciseId = randomUUID();
  const set = { workoutExerciseId, rir: null, rpe: null, performedAt: stamp };
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
      workoutExercises: [
        {
          id: workoutExerciseId,
          workoutId,
          exerciseId: exercise,
          routineExerciseId: null,
          position: 0,
          targetSets: 1,
          repLow: 6,
          repHigh: 10,
          incrementKg: 2.5,
          clientUpdatedAt: stamp,
        },
      ],
      sets: [
        // Heavier than any working set: it must move no number on the screen (S6).
        { ...set, id: randomUUID(), position: 0, weightKg: 200, reps: 1, isWarmup: true },
        { ...set, id: randomUUID(), position: 1, weightKg, reps, isWarmup: false },
      ].map((row) => ({ ...row, clientUpdatedAt: stamp })),
    },
  });
  expect(response.ok()).toBe(true);
}

const headline = (page: Page) => page.getByRole('region', { name: 'Estimated 1RM' });
const chart = (page: Page) => page.getByRole('slider', { name: 'Workout on the chart' });

test('the chart opens from the exercise, follows the span and reads out a workout', async ({
  page,
}) => {
  const bench = await exerciseId(page, 'Barbell Bench Press');
  await log(page, bench, 60, 70, 8);
  await log(page, bench, 20, 75, 8);
  await log(page, bench, 10, 80, 8);
  await log(page, bench, 3, 82.5, 10);

  await page.goto(`/exercises/${bench}`);
  await page.getByRole('link', { name: /^Progress/ }).click();
  await expect(page).toHaveURL(`/exercises/${bench}/progress`);
  await expect(page.getByRole('heading', { name: 'Barbell Bench Press' })).toBeVisible();

  // 12 weeks, as the screen opens: the latest e1RM, 82.5 × (1 + 10/30), and its change since the
  // span's first workout, 70 × (1 + 8/30) = 88.7.
  await expect(page.getByRole('radio', { name: '12 weeks' })).toBeChecked();
  await expect(headline(page)).toContainText('110.0');
  await expect(headline(page)).toContainText('Up 21.3 kilograms');
  await expect(headline(page)).toContainText('Over 12W');
  await expect(chart(page)).toHaveAttribute('max', '3');
  const stats = page.getByRole('definition');
  await expect(stats.nth(0)).toContainText('82.5');
  await expect(stats.nth(0)).toContainText('10');
  await expect(stats.nth(1)).toContainText('2,625');

  await page.getByRole('radio', { name: '4 weeks' }).check();
  await expect(headline(page)).toContainText('Up 15.0 kilograms');
  await expect(chart(page)).toHaveAttribute('max', '2');
  await expect(stats.nth(1)).toContainText('2,065');
  // The span is in the address, so a reload opens the same chart.
  await expect(page).toHaveURL(`/exercises/${bench}/progress?span=4w`);
  await page.reload();
  await expect(page.getByRole('radio', { name: '4 weeks' })).toBeChecked();
  await expect(chart(page)).toHaveAttribute('max', '2');

  // From the keyboard: the workout before the latest, read by the headline and said by the slider.
  await chart(page).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(headline(page)).toContainText('101.3');
  await expect(headline(page)).toContainText('80 × 8');
  await expect(chart(page)).toHaveAttribute('aria-valuetext', /101\.3 kilograms, top set 80 for 8/);
  await chart(page).blur();
  await expect(headline(page)).toContainText('110.0');

  // By pointer: the workout nearest in time, here the span's first, 75 × (1 + 8/30).
  await page.locator('.chart__canvas').hover({ position: { x: 26, y: 100 } });
  await expect(headline(page)).toContainText('95.0');
  await expect(headline(page)).toContainText('75 × 8');
  await page.mouse.move(0, 0);
  await expect(headline(page)).toContainText('110.0');

  // Every value the chart draws is also in the list under it, newest first.
  await page.getByRole('button', { name: 'Workouts in this span' }).click();
  const rows = page.getByRole('table').locator('tbody tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText('110.0');
  await expect(rows.first()).toContainText('82.5 × 10');
  await expect(rows.last()).toContainText('95.0');

  await page.getByRole('button', { name: 'Back to the exercise' }).click();
  await expect(page).toHaveURL(`/exercises/${bench}`);
});

test('with fewer than two workouts it says so and draws no chart', async ({ page }) => {
  const squat = await exerciseId(page, 'Barbell Back Squat');
  await page.goto(`/exercises/${squat}/progress`);
  await expect(page.getByRole('heading', { name: 'Not enough data yet' })).toBeVisible();
  await expect(chart(page)).toHaveCount(0);
  await expect(headline(page)).toContainText('No workouts');

  await log(page, squat, 2, 100, 5);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Not enough data yet' })).toBeVisible();
  await expect(chart(page)).toHaveCount(0);
  // The one workout still has its figures: 100 × (1 + 5/30).
  await expect(headline(page)).toContainText('116.7');
  await expect(page.getByRole('definition').nth(0)).toContainText('100');
});

test('with every workout on one day it draws no chart, on any span', async ({ page }) => {
  const curl = await exerciseId(page, 'Barbell Curl');
  await log(page, curl, 0, 30, 10);
  await log(page, curl, 0, 32.5, 10);

  await page.goto(`/exercises/${curl}/progress`);
  await expect(page.getByRole('radio', { name: '12 weeks' })).toBeChecked();
  await expect(page.getByRole('heading', { name: 'Not enough data yet' })).toBeVisible();
  await expect(page.getByText('on two days')).toBeVisible();
  await expect(chart(page)).toHaveCount(0);
  // Both workouts still have their figures: 32.5 × (1 + 10/30), up from 30 × (1 + 10/30).
  await expect(headline(page)).toContainText('43.3');
  await expect(headline(page)).toContainText('Up 3.3 kilograms');
  await expect(page.getByRole('definition').nth(1)).toContainText('625');

  await page.getByRole('radio', { name: 'All time' }).check();
  await expect(page).toHaveURL(`/exercises/${curl}/progress?span=all`);
  await expect(headline(page)).toContainText('All time');
  await expect(page.getByText('on two days')).toBeVisible();
  await expect(chart(page)).toHaveCount(0);
});

test('a pounds lifter reads the chart in pounds', async ({ page }) => {
  const deadlift = await exerciseId(page, 'Barbell Romanian Deadlift');
  await log(page, deadlift, 9, 80, 10);
  await log(page, deadlift, 2, 90, 10);
  const profile = await page.request.patch('/api/me/profile', { data: { weightUnit: 'lb' } });
  expect(profile.ok()).toBe(true);

  await page.goto(`/exercises/${deadlift}/progress`);
  // 90 × (1 + 10/30) = 120 kg, and the 90 kg top set.
  await expect(headline(page)).toContainText('264.6');
  await expect(headline(page)).toContainText('pounds');
  // The API's 13.333 kg change, 120 less 80 × (1 + 10/30) = 106.666…, in pounds.
  await expect(headline(page)).toContainText('Up 29.4 pounds');
  await expect(page.getByRole('definition').nth(0)).toContainText('198.4');
});
