import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { WEB_ORIGIN } from '../playwright.config';
import { apiFixture } from './fixture';

type Cookies = Parameters<BrowserContext['addCookies']>[0];

// Confirming the plan (S18, docs/09 F11, docs/10 §3 and §4, issue #80): one meal eaten as planned,
// one adjusted, one replaced from the list, and the rest confirmed from the end-of-day check, which
// Today offers an hour before bed. A user of its own, with a planned rest day made through the API.
const EMAIL = 'confirming@example.test';
const TIME_ZONE = 'Asia/Tokyo';
const headers = { Origin: WEB_ORIGIN };

const per100g = (energyKcal: number, proteinG: number, carbG: number, fatG: number) => ({
  basis: { kind: 'per_100g', grams: 100 },
  energyKcal,
  proteinG,
  carbG,
  fatG,
  fiberG: 0,
});

const FOODS = [
  { name: 'Chicken breast, skinless', state: 'cooked', ...per100g(140, 31.1, 0, 2) },
  { name: 'White rice', state: 'cooked', ...per100g(156, 2.5, 37.1, 0.3) },
  { name: 'Rolled oats', state: 'raw', ...per100g(350, 13.7, 69.1, 5.7) },
  { name: 'Broccoli', state: 'raw', ...per100g(37, 5.4, 6.6, 0.6) },
  { name: 'Greek yogurt, plain, 0% fat', state: 'raw', ...per100g(59, 10.3, 3.6, 0.4) },
  { name: 'Olive oil', state: 'raw', ...per100g(894, 0, 0, 100) },
];

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const todayInZone = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date());

type Day = {
  complete: boolean;
  confirmed: { energyKcal: number };
  meals: { label: string; status: string }[];
};

async function readDay(page: Page, date: string): Promise<Day> {
  const read: { days: Day[] } = await (
    await page.request.get(`/api/plan-days?from=${date}&to=${date}`)
  ).json();
  const [day] = read.days;
  if (day === undefined) throw new Error(`no plan on ${date}`);
  return day;
}

async function ok(response: Promise<{ ok: () => boolean }>) {
  expect((await response).ok()).toBe(true);
}

test.use({ serviceWorkers: 'block' });

test.afterAll(() => {
  apiFixture('delete', EMAIL);
});

test.beforeEach(async ({ context, page }) => {
  const { userId }: { userId: string } = JSON.parse(apiFixture('user', EMAIL));
  const cookies: Cookies = JSON.parse(apiFixture('cookies', userId, 'localhost'));
  await context.addCookies(cookies);
  await ok(
    page.request.patch('/api/me/profile', {
      headers,
      data: {
        timezone: TIME_ZONE,
        weightUnit: 'kg',
        heightCm: 176,
        sex: 'male',
        birthDate: '1994-05-01',
        trainingWeekdays: [],
      },
    }),
  );
  await ok(
    page.request.post('/api/weigh-ins', {
      headers,
      data: {
        id: randomUUID(),
        measuredAt: new Date(Date.now() - 60_000).toISOString(),
        weightKg: 80,
      },
    }),
  );
  for (const food of FOODS) {
    await ok(
      page.request.post('/api/foods', {
        headers,
        data: { id: randomUUID(), source: 'manual', ...food },
      }),
    );
  }
  const today = todayInZone();
  await ok(
    page.request.post('/api/goal-phases', {
      headers,
      data: {
        id: randomUUID(),
        type: 'cut',
        startedOn: today,
        targetRatePctPerWeek: 0.5,
        proteinGPerKg: 2.2,
        fatPctCalories: 25,
        calorieTargetKcal: 2300,
        calorieBasis: 'manual',
      },
    }),
  );
  await ok(
    page.request.put('/api/day-routines/rest', {
      headers,
      data: {
        wakeTime: '06:30',
        workStart: null,
        workEnd: null,
        trainingTime: null,
        bedTime: '23:00',
        slots: [
          { time: '07:00', label: 'Breakfast' },
          { time: '12:00', label: 'Lunch' },
          { time: '16:00', label: 'Afternoon' },
          { time: '19:00', label: 'Dinner' },
          { time: '21:00', label: 'Evening' },
        ],
      },
    }),
  );
  await ok(
    page.request.post('/api/plan-days/generate', {
      headers,
      // The whole week, so Today has nothing to make and its meals keep their ids.
      data: { from: today, to: addDays(today, 6) },
    }),
  );
});

test('confirms meals from Today, then the rest from the end-of-day check', async ({ page }) => {
  const today = todayInZone();
  // Half past ten at night: an hour before bed has begun, so the evening card shows.
  await page.clock.install({ time: new Date(`${today}T22:30:00+09:00`) });
  await page.goto('/');
  const timeline = page.getByRole('region', { name: 'The day', exact: true });

  // As planned, in one tap: the meal due is open with its actions.
  await expect(timeline.getByRole('button', { name: /^Breakfast/ })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await page.getByRole('button', { name: 'Eaten as planned Breakfast' }).click();
  await expect(page.getByText('Eaten as planned. Counted in the day.')).toBeVisible();
  await expect(timeline.locator('.meal').filter({ hasText: 'Breakfast' })).toContainText(
    'Eaten as planned',
  );

  // Adjust: a little more of the first food.
  await page.getByRole('button', { name: 'Adjust Lunch' }).click();
  await expect(page.getByRole('heading', { name: 'Adjust Lunch' })).toBeVisible();
  const before = await page.locator('.adjust__sum-fig b').first().textContent();
  await page
    .getByRole('button', { name: /^More / })
    .first()
    .click();
  await expect(page.locator('.adjust__sum-fig b').first()).not.toHaveText(before ?? '');
  await page.getByRole('button', { name: 'Save as eaten, adjusted' }).click();
  await expect(
    page.getByText('Saved as eaten, adjusted. It replaces the plan for this meal.'),
  ).toBeVisible();
  await expect(timeline.locator('.meal').filter({ hasText: 'Lunch' })).toContainText(
    'Eaten, adjusted',
  );

  // Replaced, from the food list.
  await page.getByRole('button', { name: 'Replaced Afternoon' }).click();
  await expect(page.getByRole('heading', { name: 'Replace Afternoon' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search your foods' }).fill('oats');
  await page.getByRole('button', { name: /^Rolled oats/ }).click();
  await expect(page.getByRole('region', { name: 'Eaten instead' })).toContainText('Rolled oats');
  await page.getByRole('button', { name: 'Save as replaced' }).click();
  await expect(
    page.getByText('Saved as replaced. The planned meal no longer counts.'),
  ).toBeVisible();
  await expect(timeline.locator('.meal').filter({ hasText: 'Afternoon' })).toContainText(
    'Replaced',
  );

  // The rest from the end-of-day check, with one tap.
  await page.getByRole('button', { name: /2 meals not confirmed yet/ }).click();
  await expect(page.getByRole('heading', { name: '2 meals are not confirmed' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm all as planned' }).click();
  await expect(
    page.getByText(/is a complete day\. It counts towards the maintenance check\./),
  ).toBeVisible();
  await expect(page.locator('.eod-card')).toHaveCount(0);

  const day = await readDay(page, today);
  expect(day.complete).toBe(true);
  expect(Object.fromEntries(day.meals.map((meal) => [meal.label, meal.status]))).toEqual({
    Breakfast: 'as_planned',
    Lunch: 'adjusted',
    Afternoon: 'replaced',
    Dinner: 'as_planned',
    Evening: 'as_planned',
  });
});

test('leaves a day incomplete once, and the card does not ask again', async ({ page }) => {
  const today = todayInZone();
  await page.clock.install({ time: new Date(`${today}T22:30:00+09:00`) });
  await page.goto('/');
  await page.getByRole('button', { name: /5 meals not confirmed yet/ }).click();
  await page.getByRole('button', { name: 'Leave day incomplete' }).click();
  await expect(page.getByText(/is left incomplete\. It won’t ask again\./)).toBeVisible();
  await expect(page.locator('.eod-card')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('region', { name: 'The day’s totals' })).toBeVisible();
  await expect(page.locator('.eod-card')).toHaveCount(0);
  expect((await readDay(page, today)).complete).toBe(false);
});
