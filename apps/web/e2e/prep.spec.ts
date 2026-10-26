import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { WEB_ORIGIN } from '../playwright.config';
import { deviceStore } from './device-store';
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
  { name: 'Olive oil', state: 'raw', ...per100g(894, 0, 0, 100) },
];

async function send(page: Page, method: 'POST' | 'PATCH' | 'PUT', path: string, data: unknown) {
  const res = await page.request.fetch(path, { method, data, headers: { Origin: WEB_ORIGIN } });
  expect(res.ok(), `${method} ${path}`).toBe(true);
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
  if (foods.items.length > 0) return;
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
  await expect(page.getByRole('heading', { name: /Second cook day/ })).toBeVisible();
  await expect(
    page.getByText(
      'Chicken breast, skinless keeps 4 days, so Sunday’s batch runs out after Wednesday.',
      {
        exact: false,
      },
    ),
  ).toBeVisible();
  const cooks = page.locator('.cook__row', { hasText: 'Chicken breast, skinless' });
  await expect(cooks).toHaveCount(2);
  await expect(cooks.first()).toContainText('Yield 75% from your batch of');
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
