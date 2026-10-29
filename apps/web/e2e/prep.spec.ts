import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { WEB_ORIGIN } from '../playwright.config';
import { cacheKey, deviceStore, putDeviceValue, savedCache } from './device-store';
import { apiFixture } from './fixture';

type Cookies = Parameters<BrowserContext['addCookies']>[0];

// Batches, the prep plan and the grocery list (S13, S17, docs/10 §5, issue #81): record a batch,
// read the week's prep plan with its second cook day, and read the grocery list summing both cooks.
// A user of its own, with a plan set up through the API: chicken keeps 4 days, so one batch from
// the Sunday before cannot last the week.
const EMAIL = 'prep@example.test';
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
  { name: 'Chicken breast, skinless', state: 'raw', keepsDays: 4, ...per100g(105, 23.3, 0.1, 1.9) },
  { name: 'Rolled oats', state: 'raw', ...per100g(350, 13.7, 69.1, 5.7, 9.4) },
  { name: 'Cooked rice', state: 'cooked', keepsDays: 3, ...per100g(156, 2.5, 37.1, 0.3) },
  { name: 'Olive oil', state: 'raw', ...per100g(894, 0, 0, 100) },
];

async function send(page: Page, method: 'POST' | 'PATCH' | 'PUT', path: string, data: unknown) {
  const res = await page.request.fetch(path, { method, data, headers: { Origin: WEB_ORIGIN } });
  expect(res.ok(), `${method} ${path}`).toBe(true);
}

async function prepareWeek(page: Page) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date());
  const day = new Date(`${today}T00:00:00Z`);
  const nextMonday = new Date(day.getTime() + ((8 - day.getUTCDay()) % 7 || 7) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const sunday = new Date(Date.parse(`${nextMonday}T00:00:00Z`) + 6 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  await send(page, 'POST', '/api/plan-days/generate', { from: nextMonday, to: sunday });
  await page.clock.install({ time: new Date(`${nextMonday}T12:00:00+09:00`) });
}

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
  const foods: { items: unknown[] } = await (await page.request.get('/api/foods')).json();
  if (foods.items.length > 0) {
    await prepareWeek(page);
    return;
  }
  await send(page, 'PATCH', '/api/me/profile', {
    timezone: 'Asia/Tokyo',
    heightCm: 176,
    sex: 'male',
    birthDate: '1995-03-08',
    trainingWeekdays: [],
  });
  await send(page, 'POST', '/api/weigh-ins', {
    id: randomUUID(),
    measuredAt: new Date(Date.now() - 60_000).toISOString(),
    weightKg: 82.4,
  });
  for (const food of FOODS) {
    await send(page, 'POST', '/api/foods', { id: randomUUID(), source: 'manual', ...food });
  }
  await send(page, 'POST', '/api/goal-phases', {
    id: randomUUID(),
    type: 'cut',
    startedOn: new Date().toISOString().slice(0, 10),
    targetRatePctPerWeek: 0.5,
    proteinGPerKg: 2.2,
    fatPctCalories: 25,
    calorieTargetKcal: 2350,
    calorieBasis: 'manual',
  });
  await send(page, 'PUT', '/api/day-routines/rest', {
    wakeTime: '07:30',
    workStart: null,
    workEnd: null,
    trainingTime: null,
    bedTime: '23:00',
    slots: [
      { time: '08:00', label: 'Breakfast' },
      { time: '12:30', label: 'Lunch' },
      { time: '17:00', label: 'Afternoon' },
      { time: '21:30', label: 'Dinner' },
    ],
  });
  await prepareWeek(page);
});

test('records a batch, reads the prep plan’s second cook day and the grocery list', async ({
  page,
}) => {
  await page.goto('/food/batches');
  await expect(
    page.getByText('No batch weighed yet. Cooked amounts are approximate.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Record a batch' }).click();
  await expect(page.getByRole('heading', { name: 'Record a batch' })).toBeVisible();
  await expect(page.getByLabel('Food')).toHaveValue(/.+/);
  await page
    .getByRole('textbox', { name: 'Cooked on' })
    .fill(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date()));
  await page.getByRole('textbox', { name: /Raw weight/ }).fill('1400');
  await page.getByRole('textbox', { name: /Cooked weight/ }).fill('1050');
  await expect(page.getByText('100 g cooked counts as 133 g raw.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Save batch' }).click();

  await expect(page.getByText('Batch saved. Plans made from now on use its yield.')).toBeVisible();
  await expect(page.getByText('CURRENT')).toBeVisible();
  await expect(page.getByText('1,400 g raw → 1,050 g cooked', { exact: false })).toBeVisible();
  await expect(page.getByText('75%')).toBeVisible();

  await page.getByRole('link', { name: 'Prep' }).click();
  await expect(page.getByRole('heading', { name: /First cook day/ })).toBeVisible();
  // The app bar, with the data-state slot, stays while the screen scrolls under it (docs/10 §7.3).
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect
    .poll(() => page.locator('header.app-bar').evaluate((bar) => bar.getBoundingClientRect().top))
    .toBe(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.getByRole('heading', { name: /Second cook day/ })).toBeVisible();
  await expect(
    page.getByText('Chicken breast, skinless keeps 4 days; cook again for the rest of the week.', {
      exact: false,
    }),
  ).toBeVisible();
  const cooks = page.locator('.cook__row', { hasText: 'Chicken breast, skinless' });
  await expect(cooks).toHaveCount(2);
  await expect(cooks.first()).toContainText('Yield 75% from your batch of');
  // A food with no shelf life is bought and weighed at its meals: not a row to cook, with no tick.
  await expect(page.locator('.cook__row', { hasText: 'Rolled oats' })).toHaveCount(0);
  const raws = (await cooks.locator('.cook__raw').allInnerTexts()).map((text) =>
    Number(text.replace(/[^0-9]/g, '')),
  );

  await page.getByRole('link', { name: 'Grocery list' }).click();
  await expect(page.getByRole('heading', { name: 'For the cook days' })).toBeVisible();
  const chicken = page.getByRole('button', { name: /Chicken breast, skinless/ });
  await expect(chicken).toContainText(
    `${raws.map((raw) => raw.toLocaleString('en-US')).join(' + ')} for two cooks`,
  );
  await expect(chicken).toContainText(
    raws.reduce((sum, raw) => sum + raw, 0).toLocaleString('en-US'),
  );
  await expect(page.getByRole('button', { name: /Rolled oats/ })).toContainText('for the week');
  const tick = chicken.locator('.check-cell');
  const name = chicken.locator('.grocery__name');
  expect((await tick.boundingBox())!.x).toBeGreaterThan((await name.boundingBox())!.x);
  // Each section names the weight its figures are in: raw to cook, as weighed at the meal otherwise.
  await expect(page.getByText('RAW WEIGHT', { exact: true })).toHaveCount(1);
  await expect(page.getByText('AS WEIGHED AT THE MEAL', { exact: true })).toHaveCount(1);

  // A tick stays on this phone, across a reload.
  await chicken.click();
  await expect(chicken).toHaveAttribute('aria-pressed', 'true');
  // The tick is written to the device store after it shows; reload once it has landed.
  await expect
    .poll(async () =>
      Object.entries(await deviceStore(page)).some(
        ([key, ids]) => key.startsWith(`ticks:${userId}:`) && Array.isArray(ids) && ids.length > 0,
      ),
    )
    .toBe(true);
  await page.reload();
  await expect(page.getByRole('button', { name: /Chicken breast, skinless/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('real prep API supplies piece-counted batch food to Prep and Grocery', async ({ page }) => {
  await send(page, 'POST', '/api/foods', {
    id: randomUUID(),
    source: 'manual',
    name: 'Egg, M',
    state: 'raw',
    keepsDays: 4,
    pieceWeightG: 55,
    ...per100g(142, 12.2, 0.4, 10.2),
  });
  await prepareWeek(page);
  await page.goto('/food');
  const eggs = page.locator('.cook__row', { hasText: 'Egg, M' });
  await expect(eggs).toHaveCount(2);
  const counts = (await eggs.locator('.cook__raw').allInnerTexts()).map((label) => {
    expect(label).toContain('pc');
    return Number(label.replace(/[^0-9]/g, ''));
  });
  await page.goto('/food/grocery');
  const grocery = page.getByRole('button', { name: /Egg, M/ });
  await expect(grocery).toContainText(`${counts.join(' + ')} for two cooks`);
  await expect(grocery.locator('.grocery__qty')).toHaveText(`${counts[0]! + counts[1]!} pieces`);
});

/** A cook row as an API from before 2026-10-27 answered it, with no `pieces`. */
const oldCook = (foodId: string, name: string, keepsDays: number | null, rawGrams: number) => ({
  foodId,
  name,
  keepsDays,
  rawGrams,
  cookedGrams: null,
  approximate: false,
  dates: ['2099-01-02'],
});

// A page the service worker controls fetches through it, where a route sees nothing.
test.describe('with no service worker', () => {
  test.use({ serviceWorkers: 'block' });

  test('drops a prep plan saved in the shape from before pieces, offline', async ({ page }) => {
    await page.goto('/food');
    await expect(page.locator('.food-lede')).toBeVisible();
    await expect.poll(() => savedCache(page, userId)).toContain('"prep"');
    // The copy an earlier release saved: a food with no shelf life on the cook day, no `pieces`.
    type Saved = {
      clientState: {
        queries: { queryKey: unknown[]; queryHash: string; state: { data: unknown } }[];
      };
    };
    const saved: Saved = JSON.parse(await savedCache(page, userId));
    for (const query of saved.clientState.queries) {
      if (query.queryKey[1] !== 'prep') continue;
      const weekStart = query.queryKey.at(-1);
      query.queryKey = ['plan', 'prep', weekStart];
      query.queryHash = JSON.stringify(query.queryKey);
      query.state.data = {
        weekStart,
        missing: [],
        generatedAt: new Date().toISOString(),
        cookDays: [
          {
            date: '2099-01-01',
            which: 'first',
            covers: ['2099-01-02'],
            because: null,
            cooks: [
              {
                foodId: randomUUID(),
                name: 'Banana',
                keepsDays: null,
                rawGrams: 2400,
                cookedGrams: null,
                approximate: false,
                dates: ['2099-01-02'],
              },
            ],
          },
        ],
        foods: [],
        uncovered: [],
        grocery: [],
      };
    }
    await page.route(
      (url) => url.pathname === '/api/prep-plan',
      (route) => route.abort('internetdisconnected'),
    );
    await putDeviceValue(page, cacheKey(userId), JSON.stringify(saved));
    await page.reload();
    await expect(page.getByText('Couldn’t reach Overload.', { exact: false })).toBeVisible();
    await expect(page.getByText('Banana')).toHaveCount(0);
  });

  test('reads a prep plan from an API without pieces, which put foods with no shelf life on the cook day', async ({
    page,
  }) => {
    await page.route(
      (url) => url.pathname === '/api/prep-plan',
      async (route) => {
        const response = await route.fetch();
        const { weekStart }: { weekStart: string } = await response.json();
        await route.fulfill({
          response,
          json: {
            weekStart,
            missing: [],
            generatedAt: new Date().toISOString(),
            cookDays: [
              {
                date: '2099-01-01',
                which: 'first',
                covers: ['2099-01-02'],
                because: null,
                cooks: [
                  oldCook(randomUUID(), 'Banana', null, 2400),
                  oldCook(randomUUID(), 'Chicken breast', 4, 1400),
                ],
              },
            ],
            foods: [],
            uncovered: [],
            grocery: [],
          },
        });
      },
    );

    await page.goto('/food');
    const rows = page.locator('.cook__row');
    await expect(rows).toHaveCount(1);
    await expect(rows.locator('.cook__raw')).toHaveText('Raw 1,400 g');
    await expect(page.getByText('Banana')).toHaveCount(0);
  });

  test('counts a batch-cooked food counted in pieces in pieces on Prep and Grocery', async ({
    page,
  }) => {
    // The API's prep plan for eggs boiled in batches (apps/api/test/prep.test.ts works the figures),
    // answered for this account.
    const egg = randomUUID();
    const cook = (
      which: 'first' | 'second',
      date: string,
      pieces: number,
      rawGrams: number,
      dates: string[],
    ) => ({
      date,
      which,
      covers: dates,
      because: null,
      cooks: [
        {
          foodId: egg,
          name: 'Egg',
          keepsDays: 4,
          rawGrams,
          pieces,
          cookedGrams: null,
          approximate: false,
          dates,
        },
      ],
    });
    await page.route(
      (url) => url.pathname === '/api/prep-plan',
      async (route) => {
        const response = await route.fetch();
        const { weekStart }: { weekStart: string } = await response.json();
        await route.fulfill({
          response,
          json: {
            weekStart,
            missing: [],
            generatedAt: new Date().toISOString(),
            cookDays: [
              cook('first', '2099-01-01', 6, 330, ['2099-01-02']),
              cook('second', '2099-01-04', 8, 440, ['2099-01-05']),
            ],
            foods: [{ foodId: egg, name: 'Egg', keepsDays: 4, batch: null, weighDue: true }],
            uncovered: [],
            grocery: [
              {
                foodId: egg,
                name: 'Egg',
                section: 'cook_days',
                unit: 'pieces',
                quantity: 14,
                cooks: [6, 8],
                approximate: false,
              },
            ],
          },
        });
      },
    );

    await page.goto('/food');
    const eggs = page.locator('.cook__row', { hasText: 'Egg' }).locator('.cook__raw');
    await expect(eggs).toHaveCount(2);
    await expect(eggs.first()).toHaveText('Raw 6 pc pieces');
    await expect(eggs.last()).toHaveText('Raw 8 pc pieces');

    await page.goto('/food/grocery');
    const row = page.getByRole('button', { name: /Egg/ });
    await expect(row).toContainText('6 + 8 for two cooks');
    await expect(row.locator('.grocery__qty')).toHaveText('14 pieces');
  });
});

test('refuses a batch for a cooked-state food in the form', async ({ page }) => {
  await page.goto('/food/batches/new');
  await page.getByLabel('Food').selectOption({ label: 'Cooked rice' });
  await page.getByRole('textbox', { name: /Raw weight/ }).fill('100');
  await page.getByRole('textbox', { name: /Cooked weight/ }).fill('200');
  await page.getByRole('button', { name: 'Save batch' }).click();
  await expect(page.getByText('Batches need a food with raw values.')).toBeVisible();
});
