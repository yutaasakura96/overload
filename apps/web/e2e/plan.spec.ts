import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext } from '@playwright/test';
import { WEB_ORIGIN } from '../playwright.config';
import { apiFixture } from './fixture';

type Cookies = Parameters<BrowserContext['addCookies']>[0];

// The generated plan (S14 to S16, docs/10 §3 and §8.6, issue #79): from a list of foods, set the
// details, a goal phase and the day's routine on their screens, and Today shows the day's meals with
// the workout in them; the week from today is made. A user of its own, set up afresh each test.
const EMAIL = 'plan@example.test';
const TIME_ZONE = 'Asia/Tokyo';
const DAY_MS = 24 * 60 * 60 * 1000;
let userId = '';

const per100g = (
  energyKcal: number,
  proteinG: number,
  carbG: number,
  fatG: number,
  fiberG = 0,
) => ({
  basis: { kind: 'per_100g', grams: 100 },
  energyKcal,
  proteinG,
  carbG,
  fatG,
  fiberG,
});

const FOODS = [
  { name: 'Chicken breast, skinless', state: 'raw', ...per100g(105, 23.3, 0.1, 1.9) },
  { name: 'White rice', state: 'cooked', ...per100g(156, 2.5, 37.1, 0.3, 1.5) },
  { name: 'Rolled oats', state: 'raw', ...per100g(350, 13.7, 69.1, 5.7, 9.4) },
  { name: 'Broccoli', state: 'raw', ...per100g(37, 5.4, 6.6, 0.6, 5.1) },
  { name: 'Egg, M', state: 'raw', pieceWeightG: 55, ...per100g(142, 12.2, 0.4, 10.2) },
  { name: 'Greek yogurt, plain, 0% fat', state: 'raw', ...per100g(59, 10.3, 3.6, 0.4) },
  { name: 'Olive oil', state: 'raw', ...per100g(894, 0, 0, 100) },
];

/** The ISO weekday and date of today in the profile's time zone. */
function todayInZone() {
  const parts = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: TIME_ZONE,
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((each) => each.type === type)?.value ?? '';
  return { weekday: part('weekday'), date: `${part('year')}-${part('month')}-${part('day')}` };
}

test.afterAll(() => {
  apiFixture('delete', EMAIL);
});

test.beforeEach(async ({ context, page }) => {
  // A fresh user each time: no phase, routine or plan carried over from a retry.
  const created: { userId: string } = JSON.parse(apiFixture('user', EMAIL));
  ({ userId } = created);
  const cookies: Cookies = JSON.parse(apiFixture('cookies', userId, 'localhost'));
  await context.addCookies(cookies);
  const headers = { Origin: WEB_ORIGIN };
  const profile = await page.request.patch('/api/me/profile', {
    headers,
    data: { timezone: TIME_ZONE, weightUnit: 'kg' },
  });
  expect(profile.ok()).toBe(true);
  for (const food of FOODS) {
    const made = await page.request.post('/api/foods', {
      headers,
      data: { id: randomUUID(), source: 'manual', ...food },
    });
    expect(made.ok()).toBe(true);
  }
  const exercises: { items: { id: string }[] } = await (
    await page.request.get('/api/exercises')
  ).json();
  const exerciseId = exercises.items[0]?.id;
  expect(exerciseId).toBeDefined();
  const routine = await page.request.post('/api/routines', {
    headers,
    data: {
      id: randomUUID(),
      name: 'Push A',
      exercises: [{ id: randomUUID(), exerciseId, targetSets: 3, repLow: 6, repHigh: 10 }],
    },
  });
  expect(routine.ok()).toBe(true);
});

test('sets up a phase and a day, and Today shows the day’s plan', async ({ page }) => {
  const today = todayInZone();
  await page.goto('/');

  // Step 1: about you. The foods are on the list already, so the goal phase follows.
  await expect(page.getByRole('heading', { name: 'First, a little about you' })).toBeVisible();
  await page.getByRole('button', { name: 'Add your details' }).click();
  await page.getByRole('textbox', { name: /^Weight/ }).fill('82.5');
  await page.getByRole('textbox', { name: /^Height/ }).fill('176');
  await page.getByLabel('Birth date').fill('1994-05-01');
  await page.getByRole('radio', { name: 'Male', exact: true }).check();
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Set your goal phase' })).toBeVisible();

  // Step 3: a cut on its defaults, each with its source, the calories provisional.
  await page.getByRole('button', { name: 'Set your goal' }).click();
  await page.getByRole('radio', { name: 'Cut' }).check();
  await expect(page.getByText('Provisional', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Save targets' }).click();
  await expect(page.getByRole('heading', { name: 'Tell the plan your day' })).toBeVisible();

  // Step 4: today is the one training day, so both day types are asked for in turn.
  await page.getByRole('button', { name: 'Set your day' }).click();
  await page.getByRole('radio', { name: 'Training day' }).check();
  await page.getByRole('button', { name: today.weekday, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Recommended' })).toBeVisible();
  await page.getByRole('button', { name: 'Use these meals' }).click();
  await expect(page.getByText('Training day saved. Now your rest day.')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Rest day' })).toBeChecked();
  await page.getByRole('button', { name: 'Use these meals' }).click();

  // Today: the day's totals and meals, the workout in its place, still started from here.
  await expect(page.getByText('Saved. The week’s plan is made again from it.')).toBeVisible();
  await expect(page.getByText(/ · TRAINING DAY$/)).toBeVisible();
  const totals = page.getByRole('region', { name: 'The day’s totals' });
  await expect(totals).toContainText('kcal planned');
  const timeline = page.getByRole('region', { name: 'The day', exact: true });
  await expect(timeline.getByRole('heading', { level: 3 }).first()).toBeVisible();
  expect(await timeline.getByRole('heading', { level: 3 }).count()).toBeGreaterThanOrEqual(4);
  await expect(timeline.getByRole('button', { name: 'Start Push A' })).toBeEnabled();

  // The week from today is made, each day within ±5% of its calories or saying what it is short.
  const to = new Date(Date.parse(`${today.date}T00:00:00Z`) + 6 * DAY_MS)
    .toISOString()
    .slice(0, 10);
  const week: {
    days: {
      date: string;
      targets: { energyKcal: number };
      planned: { energyKcal: number };
      shortfalls: unknown[];
    }[];
    missing: string[];
  } = await (await page.request.get(`/api/plan-days?from=${today.date}&to=${to}`)).json();
  expect(week.missing).toEqual([]);
  expect(week.days).toHaveLength(7);
  const offTarget = week.days.filter(
    (day) =>
      day.shortfalls.length === 0 &&
      Math.abs(day.planned.energyKcal - day.targets.energyKcal) > day.targets.energyKcal * 0.05,
  );
  expect(offTarget).toEqual([]);

  await timeline.getByRole('button', { name: 'Start Push A' }).click();
  await expect(page).toHaveURL(/\/workout/);
});

test('Today reports a failed plan generation', async ({ page }) => {
  const headers = { Origin: WEB_ORIGIN };
  const profile = await page.request.patch('/api/me/profile', {
    headers,
    data: {
      timezone: TIME_ZONE,
      heightCm: 176,
      sex: 'male',
      birthDate: '1994-05-01',
      trainingWeekdays: [1, 2, 3, 4, 5, 6, 7],
    },
  });
  expect(profile.ok()).toBe(true);
  expect(
    (
      await page.request.post('/api/weigh-ins', {
        headers,
        data: { id: randomUUID(), measuredAt: new Date().toISOString(), weightKg: 82.5 },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await page.request.post('/api/goal-phases', {
        headers,
        data: {
          id: randomUUID(),
          type: 'cut',
          startedOn: todayInZone().date,
          targetRatePctPerWeek: 0.5,
          proteinGPerKg: 2.2,
          fatPctCalories: 25,
          calorieTargetKcal: 2350,
          calorieBasis: 'manual',
        },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await page.request.put('/api/day-routines/training', {
        headers,
        data: {
          wakeTime: '06:30',
          workStart: null,
          workEnd: null,
          trainingTime: '18:30',
          bedTime: '23:00',
          slots: [
            { time: '07:00', label: 'Breakfast' },
            { time: '12:00', label: 'Lunch' },
            { time: '16:30', label: 'Before training' },
            { time: '19:45', label: 'After training' },
          ],
        },
      })
    ).ok(),
  ).toBe(true);
  await page.route('**/api/plan-days/generate', async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: 'urn:overload:problem:internal',
        title: 'Internal error',
        status: 500,
        code: 'internal',
        requestId: 'test',
      }),
    });
  });
  await page.goto('/');
  await expect(
    page.getByText('Couldn’t make today’s plan. Try again when you have signal.'),
  ).toBeVisible();
  await expect(page.getByText('Today’s plan is ready.')).toHaveCount(0);
});
