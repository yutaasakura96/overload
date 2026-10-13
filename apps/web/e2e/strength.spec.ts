import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { apiFixture } from './fixture';

type Cookies = Parameters<BrowserContext['addCookies']>[0];

// The strength overview (docs/10 §9, issue #49): every lift under its status, the average of
// them, a lift with too few workouts said as that, and a lift's row opening its chart on the same
// span. A user of its own, with workouts put there through the sync batch.
const EMAIL = 'strength@example.test';
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

/**
 * One finished workout of one exercise, `daysAgo` days back: one working set of 30 reps, so its
 * e1RM is twice the weight.
 */
async function log(page: Page, exercise: string, daysAgo: number, weightKg: number) {
  const stamp = new Date(Date.now() - daysAgo * DAY_MS).toISOString();
  const workoutId = randomUUID();
  const workoutExerciseId = randomUUID();
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
        {
          id: randomUUID(),
          workoutExerciseId,
          position: 0,
          weightKg,
          reps: 30,
          rir: null,
          rpe: null,
          isWarmup: false,
          performedAt: stamp,
          clientUpdatedAt: stamp,
        },
      ],
    },
  });
  expect(response.ok()).toBe(true);
}

const sections = (page: Page) => page.getByRole('navigation', { name: 'Progress' });
const headline = (page: Page) => page.getByRole('region', { name: /^All lifts · trend over/ });
const tally = (page: Page) => page.getByRole('definition');

test('strength says per lift and overall whether it is gaining, holding or losing', async ({
  page,
}) => {
  const bench = await exerciseId(page, 'Barbell Bench Press');
  const squat = await exerciseId(page, 'Barbell Back Squat');
  const row = await exerciseId(page, 'Seated Cable Row');
  const curl = await exerciseId(page, 'Dumbbell Curl');
  // Bench: 100 once, then 106 four times: a line up 6.4% over 12 weeks, and flat over the last 4.
  await log(page, bench, 61, 50);
  await log(page, bench, 22, 53);
  await log(page, bench, 15, 53);
  await log(page, bench, 8, 53);
  await log(page, bench, 1, 53);
  // Squat falls 200 to 192, the row stays where it is, and the curl has two workouts.
  await log(page, squat, 15, 100);
  await log(page, squat, 8, 98);
  await log(page, squat, 1, 96);
  await log(page, row, 15, 40);
  await log(page, row, 8, 40);
  await log(page, row, 1, 40);
  await log(page, curl, 9, 10);
  await log(page, curl, 2, 11);

  await page.goto('/progress');
  await sections(page).getByRole('link', { name: 'Strength' }).click();
  await expect(page).toHaveURL('/progress/strength');
  await expect(sections(page).getByRole('link', { name: 'Strength' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByText('4 LIFTS', { exact: true })).toBeVisible();

  // 12 weeks, as the screen opens. Bench +6.4%, the row 0.0%, squat −4.0%: their plain average.
  await expect(page.getByRole('radio', { name: '12 weeks' })).toBeChecked();
  await expect(headline(page)).toContainText('trend over 12 weeks');
  await expect(headline(page)).toContainText('+0.8');
  await expect(headline(page)).toContainText('HOLDING');
  await expect(headline(page)).toContainText('3 lifts averaged');
  await expect(tally(page)).toHaveText(['1', '1', '1']);

  const gaining = page.getByRole('region', { name: 'Gaining · 1' }).getByRole('link');
  await expect(gaining).toHaveCount(1);
  await expect(gaining).toContainText('Barbell Bench Press');
  await expect(gaining).toContainText('E1RM 106.0 KG');
  await expect(gaining).toContainText('+6.4%');
  await expect(gaining).toContainText('+6.5 kg');
  const holding = page.getByRole('region', { name: 'Holding · 1' }).getByRole('link');
  await expect(holding).toContainText('Seated Cable Row');
  await expect(holding).toContainText('0.0%');
  const losing = page.getByRole('region', { name: 'Losing · 1' }).getByRole('link');
  await expect(losing).toContainText('Barbell Back Squat');
  await expect(losing).toContainText('−4.0%');
  await expect(losing).toContainText('−8.0 kg');
  await expect(losing).toContainText('Down 4.0 percent');

  // Fewer than three workouts: the lift says so, and carries no verdict.
  const tooFew = page
    .getByRole('region', { name: 'Too few workouts in this span · 1' })
    .getByRole('link');
  await expect(tooFew).toContainText('Dumbbell Curl');
  await expect(tooFew).toContainText('2 WORKOUTS');
  await expect(tooFew).toContainText('no trend yet');
  await expect(tooFew).not.toContainText('%');

  await expect(page.getByText('gaining ≥ +2% · losing ≤ −2%')).toBeVisible();

  // The same lift reads differently in another span: bench holds over 4 weeks.
  await page.getByRole('radio', { name: '4 weeks' }).check();
  await expect(page).toHaveURL('/progress/strength?span=4w');
  await expect(headline(page)).toContainText('trend over 4 weeks');
  await expect(tally(page)).toHaveText(['0', '2', '1']);
  await expect(page.getByRole('region', { name: 'Gaining' })).toHaveCount(0);
  const held = page.getByRole('region', { name: 'Holding · 2' }).getByRole('link');
  await expect(held).toContainText(['Barbell Bench Press', 'Seated Cable Row']);

  // A lift opens its chart on the span it was read in, and Back returns to that span.
  await held.first().click();
  await expect(page).toHaveURL(`/exercises/${bench}/progress?span=4w`);
  await expect(page.getByRole('heading', { name: 'Barbell Bench Press' })).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL('/progress/strength?span=4w');
  await expect(page.getByRole('radio', { name: '4 weeks' })).toBeChecked();

  // A year takes in everything, and says so in words.
  await page.getByRole('radio', { name: '1 year' }).check();
  await expect(headline(page)).toContainText('trend over a year');
});

test('strength in pounds', async ({ page }) => {
  const press = await exerciseId(page, 'Barbell Overhead Press');
  await log(page, press, 15, 25);
  await log(page, press, 8, 26);
  await log(page, press, 1, 27);
  const saved = await page.request.patch('/api/me/profile', {
    data: { timezone: 'Asia/Tokyo', weightUnit: 'lb' },
  });
  expect(saved.ok()).toBe(true);
  await page.goto('/progress/strength?span=4w');
  // 54 kg is 119.0 lb, and the line's 4 kg is 8.8 lb. The percentage is the same in any unit.
  const lift = page.getByRole('link', { name: /Barbell Overhead Press/ });
  await expect(lift).toContainText('E1RM 119.0 LB');
  await expect(lift).toContainText('+8.0%');
  await expect(lift).toContainText('+8.8 lb');
});

test('strength with no lift in the span', async ({ page, context }) => {
  const other: { userId: string } = JSON.parse(apiFixture('user', 'strength-empty@example.test'));
  try {
    await context.clearCookies();
    const cookies: Cookies = JSON.parse(apiFixture('cookies', other.userId, 'localhost'));
    await context.addCookies(cookies);
    const profile = await page.request.patch('/api/me/profile', {
      data: { timezone: 'Asia/Tokyo', weightUnit: 'kg' },
    });
    expect(profile.ok()).toBe(true);

    await page.goto('/progress/strength');
    await expect(page.getByText('0 LIFTS', { exact: true })).toBeVisible();
    await expect(headline(page)).toContainText('No lift has a trend yet');
    await expect(headline(page)).toContainText('0 lifts averaged');
    await expect(tally(page)).toHaveText(['0', '0', '0']);
    await expect(page.getByRole('heading', { name: 'No lifts in this span' })).toBeVisible();
  } finally {
    apiFixture('delete', 'strength-empty@example.test');
  }
});
