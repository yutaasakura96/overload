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

async function adjustLunch(page: Page) {
  const lunch = page
    .getByRole('region', { name: 'The day', exact: true })
    .getByRole('button', { name: /^Lunch/ });
  if ((await lunch.getAttribute('aria-expanded')) !== 'true') await lunch.click();
  await page.getByRole('button', { name: 'Adjust Lunch' }).click();
  await expect(page.getByRole('heading', { name: 'Adjust Lunch' })).toBeVisible();
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

test('swap back after saving restores the planned item', async ({ page }) => {
  const today = todayInZone();
  const read: {
    days: {
      meals: {
        id: string;
        label: string;
        items: {
          id: string;
          foodId: string | null;
          plannedGrams: number | null;
          actualGrams: number | null;
        }[];
      }[];
    }[];
  } = await (await page.request.get(`/api/plan-days?from=${today}&to=${today}`)).json();
  const meal = read.days[0]?.meals.find((each) => each.label === 'Lunch');
  const planned = meal?.items.find((item) => item.plannedGrams !== null && item.foodId !== null);
  if (meal === undefined || planned?.foodId === null || planned === undefined) {
    throw new Error('no planned food for Lunch');
  }
  const listed: { items: { id: string; name: string }[] } = await (
    await page.request.get('/api/foods')
  ).json();
  const alternative = listed.items.find(
    (food) => food.id !== planned.foodId && !meal.items.some((item) => item.foodId === food.id),
  );
  if (alternative === undefined) throw new Error('no alternative food');
  await ok(
    page.request.post('/api/rotation-groups', {
      headers,
      data: { id: randomUUID(), name: 'Lunch swaps', foodIds: [planned.foodId, alternative.id] },
    }),
  );
  await page.goto('/');
  await adjustLunch(page);
  const original = listed.items.find((food) => food.id === planned.foodId);
  if (original === undefined) throw new Error('planned food missing');
  await page
    .getByRole('button', { name: `Swap ${original.name} for ${alternative.name}` })
    .first()
    .click();
  await page.getByRole('button', { name: 'Save as eaten, adjusted' }).click();
  await expect(
    page.getByText('Saved as eaten, adjusted. It replaces the plan for this meal.'),
  ).toBeVisible();
  await adjustLunch(page);
  await page
    .getByRole('button', { name: `Swap ${alternative.name} for ${original.name}` })
    .first()
    .click();
  await page.getByRole('button', { name: 'Save as eaten, adjusted' }).click();
  await expect(
    page.getByText('Saved as eaten, adjusted. It replaces the plan for this meal.'),
  ).toBeVisible();
  const after: typeof read = await (
    await page.request.get(`/api/plan-days?from=${today}&to=${today}`)
  ).json();
  const items = after.days[0]?.meals.find((each) => each.id === meal.id)?.items ?? [];
  expect(items.find((item) => item.id === planned.id)?.actualGrams).toBeGreaterThan(0);
  expect(items.some((item) => item.foodId === alternative.id)).toBe(false);
});

test('swapping through planned and eaten foods keeps each stored snapshot', async ({ page }) => {
  const today = todayInZone();
  type Item = {
    id: string;
    foodId: string | null;
    plannedGrams: number | null;
    actualGrams: number | null;
    per100g: { energyKcal: number };
  };
  const readLunch = async () => {
    const read: { days: { meals: { id: string; label: string; items: Item[] }[] }[] } = await (
      await page.request.get(`/api/plan-days?from=${today}&to=${today}`)
    ).json();
    const lunch = read.days[0]?.meals.find((each) => each.label === 'Lunch');
    if (lunch === undefined) throw new Error('no Lunch');
    return lunch;
  };
  const lunch = await readLunch();
  const planned = lunch.items.find((item) => item.plannedGrams !== null && item.foodId !== null);
  if (planned?.foodId === null || planned === undefined) throw new Error('no planned food');
  const listed: { items: { id: string; name: string; energyKcal: number }[] } = await (
    await page.request.get('/api/foods')
  ).json();
  const [eaten, other] = listed.items.filter(
    (food) => food.id !== planned.foodId && !lunch.items.some((item) => item.foodId === food.id),
  );
  const start = listed.items.find((food) => food.id === planned.foodId);
  if (eaten === undefined || other === undefined || start === undefined) {
    throw new Error('not enough foods');
  }
  const groups: { items: { id: string; name: string }[] } = await (
    await page.request.get('/api/rotation-groups')
  ).json();
  const foodIds = [planned.foodId, eaten.id, other.id];
  const group = groups.items.find((each) => each.name === 'Lunch swaps');
  await ok(
    group === undefined
      ? page.request.post('/api/rotation-groups', {
          headers,
          data: { id: randomUUID(), name: 'Lunch swaps', foodIds },
        })
      : page.request.patch(`/api/rotation-groups/${group.id}`, { headers, data: { foodIds } }),
  );
  await page.goto('/');
  const saved = page.getByText('Saved as eaten, adjusted. It replaces the plan for this meal.');
  const swap = (from: string, to: string) =>
    page
      .getByRole('button', { name: `Swap ${from} for ${to}` })
      .first()
      .click();

  // Swap the planned food for F and save: F is stored as eaten, at its values of that moment.
  await adjustLunch(page);
  await swap(start.name, eaten.name);
  await page.getByRole('button', { name: 'Save as eaten, adjusted' }).click();
  await expect(saved).toBeVisible();
  const stored = (await readLunch()).items.find((item) => item.foodId === eaten.id);
  if (stored === undefined) throw new Error('the eaten food was not stored');
  expect(stored.per100g.energyKcal).toBe(eaten.energyKcal);

  // F is edited afterwards; the stored item must not follow it.
  const edited = eaten.energyKcal + 100;
  await ok(page.request.patch(`/api/foods/${eaten.id}`, { headers, data: { energyKcal: edited } }));

  // Swap F to G and back to F, and save: nothing changed, so the snapshot stays.
  await page.goto('/');
  await adjustLunch(page);
  await swap(eaten.name, other.name);
  await swap(other.name, eaten.name);
  await page.getByRole('button', { name: 'Save as eaten, adjusted' }).click();
  await expect(saved).toBeVisible();
  const after = (await readLunch()).items.find((item) => item.foodId === eaten.id);
  expect(after?.id).toBe(stored.id);
  expect(after?.per100g.energyKcal).toBe(eaten.energyKcal);

  // The zero-gram planned food must not replace F as this row's starting item.
  await page.goto('/');
  await adjustLunch(page);
  await swap(eaten.name, start.name);
  await swap(start.name, eaten.name);
  await page.getByRole('button', { name: 'Save as eaten, adjusted' }).click();
  await expect(saved).toBeVisible();
  const backToEaten = (await readLunch()).items.find((item) => item.foodId === eaten.id);
  expect(backToEaten?.id).toBe(stored.id);
  expect(backToEaten?.per100g.energyKcal).toBe(eaten.energyKcal);

  // Returning to the planned food through G must keep the planned item's id and snapshot.
  await ok(
    page.request.patch(`/api/foods/${start.id}`, {
      headers,
      data: { energyKcal: start.energyKcal + 100 },
    }),
  );
  await page.goto('/');
  await adjustLunch(page);
  await swap(eaten.name, start.name);
  await swap(start.name, other.name);
  await swap(other.name, start.name);
  await page.getByRole('button', { name: 'Save as eaten, adjusted' }).click();
  await expect(saved).toBeVisible();
  const backToPlanned = (await readLunch()).items;
  expect(backToPlanned.find((item) => item.id === planned.id)?.actualGrams).toBeGreaterThan(0);
  expect(backToPlanned.find((item) => item.id === planned.id)?.per100g.energyKcal).toBe(
    planned.per100g.energyKcal,
  );
  expect(backToPlanned.some((item) => item.foodId === eaten.id)).toBe(false);
});

test('shows zero eaten before adjusting a skipped meal', async ({ page }) => {
  const today = todayInZone();
  const read: { days: { meals: { id: string; label: string }[] }[] } = await (
    await page.request.get(`/api/plan-days?from=${today}&to=${today}`)
  ).json();
  const meal = read.days[0]?.meals.find((each) => each.label === 'Lunch');
  if (meal === undefined) throw new Error('no Lunch');
  await ok(
    page.request.post(`/api/plan-meals/${meal.id}/confirm`, {
      headers,
      data: { status: 'skipped' },
    }),
  );
  await page.goto('/');
  await adjustLunch(page);
  await expect(page.locator('.adjust__sum-fig').first()).toHaveText(/^0 →/);
  await expect(page.locator('.adjust__sum-fig').nth(1)).toHaveText(/^0 →/);
});

test('keeps the end-of-day choice open when device storage refuses it', async ({ page }) => {
  const today = todayInZone();
  await page.clock.install({ time: new Date(`${today}T22:30:00+09:00`) });
  await page.goto('/');
  await page.getByRole('button', { name: /5 meals not confirmed yet/ }).click();
  await page.evaluate(() => {
    Object.defineProperty(IDBObjectStore.prototype, 'put', {
      configurable: true,
      value: () => {
        throw new Error('storage refused');
      },
    });
  });
  await page.getByRole('button', { name: 'Leave day incomplete' }).click();
  await expect(
    page.getByText('Couldn’t save this choice on your device. Try again.'),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: '5 meals are not confirmed' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to Today' }).click();
  await expect(page.locator('.eod-card')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.eod-card')).toHaveCount(1);
});
