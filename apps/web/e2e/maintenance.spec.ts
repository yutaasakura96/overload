import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { WEB_ORIGIN } from '../playwright.config';
import { apiFixture } from './fixture';

type Cookies = Parameters<BrowserContext['addCookies']>[0];

// The maintenance check card on Weight (S18a, docs/10 §6, docs/09 F13, issue #82): each of its
// states from seeded plan days and weigh-ins, and applying it by hand. A user of its own, in Tokyo,
// on a cut with a plan for the last three weeks; days past the 7-day confirm lock are marked
// complete through the API's fixture script (owner, 2026-10-16: seeded data is fine).
const EMAIL = 'maintenance@example.test';
const TIME_ZONE = 'Asia/Tokyo';
const headers = { Origin: WEB_ORIGIN };
let userId = '';

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
  { name: 'Olive oil', state: 'raw', ...per100g(894, 0, 0, 100) },
];

const todayInZone = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date());
const daysAgo = (days: number) =>
  new Date(Date.parse(`${todayInZone()}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
const range = (from: number, to: number) =>
  Array.from({ length: from - to + 1 }, (_, index) => from - index);
const kcal = (value: number) => value.toLocaleString('en-US');

async function ok(response: Promise<{ ok: () => boolean }>) {
  expect((await response).ok()).toBe(true);
}

/** A typed weigh-in at 07:00 Tokyo, `ago` days back. */
const weighIn = (page: Page, ago: number, weightKg: number) =>
  ok(
    page.request.post('/api/weigh-ins', {
      headers,
      data: {
        id: randomUUID(),
        measuredAt: new Date(`${daysAgo(ago)}T07:00:00+09:00`).toISOString(),
        weightKg,
      },
    }),
  );

const completeDays = (agos: number[]) =>
  apiFixture('complete-days', userId, ...agos.map((ago) => daysAgo(ago)));

const card = (page: Page) => page.getByRole('region', { name: 'Maintenance check' });

async function openWeight(page: Page) {
  await page.goto('/progress/weight');
  await expect(card(page)).toBeVisible();
}

test.use({ serviceWorkers: 'block' });

test.afterAll(() => {
  apiFixture('delete', EMAIL);
});

test.beforeEach(async ({ context, page }) => {
  const created: { userId: string } = JSON.parse(apiFixture('user', EMAIL));
  ({ userId } = created);
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
  await weighIn(page, 25, 83);
  for (const food of FOODS) {
    await ok(
      page.request.post('/api/foods', {
        headers,
        data: { id: randomUUID(), source: 'manual', ...food },
      }),
    );
  }
  await ok(
    page.request.post('/api/goal-phases', {
      headers,
      data: {
        id: randomUUID(),
        type: 'cut',
        startedOn: daysAgo(30),
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
          { time: '12:30', label: 'Lunch' },
          { time: '19:00', label: 'Dinner' },
        ],
      },
    }),
  );
  await ok(
    page.request.post('/api/plan-days/generate', {
      headers,
      data: { from: daysAgo(21), to: todayInZone() },
    }),
  );
});

test('under 14 complete days, says how many remain', async ({ page }) => {
  completeDays(range(8, 0));
  await openWeight(page);
  await expect(card(page)).toContainText('9 of 14 complete days');
  await expect(card(page)).toContainText(/5\s*complete days to go/);
  await expect(card(page).getByRole('button')).toHaveCount(0);
});

test('shows collecting and weigh-in states with no weigh-ins', async ({ page }) => {
  const weighIns: { weighIns: { id: string }[] } = await (
    await page.request.get('/api/weigh-ins')
  ).json();
  for (const { id } of weighIns.weighIns) {
    await ok(page.request.delete(`/api/weigh-ins/${id}`, { headers }));
  }
  completeDays(range(8, 0));
  await openWeight(page);
  await expect(page.getByText('No weigh-ins yet')).toBeVisible();
  await expect(card(page)).toContainText(/5\s*complete days to go/);

  completeDays(range(13, 9));
  await page.reload();
  await expect(card(page).getByText('Weigh in to see this')).toBeVisible();
});

test('refreshes the maintenance check when the local date changes', async ({ page }) => {
  await page.clock.install({ time: new Date(`${todayInZone()}T23:59:00+09:00`) });
  let requests = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/maintenance-check')) requests += 1;
  });
  await openWeight(page);
  await expect.poll(() => requests).toBe(1);
  await page.clock.fastForward('02:00');
  await expect.poll(() => requests).toBe(2);
});

test('shows a notice when the maintenance check cannot load', async ({ page }) => {
  await page.route('**/api/maintenance-check', (route) => route.abort());
  await openWeight(page);
  await expect(card(page)).toContainText('Not updated');
  await expect(card(page)).toContainText(
    'Couldn’t reach Overload. Try again when you have signal.',
  );
});

test('with too few weigh-ins, asks for one and opens Type a weight', async ({ page }) => {
  completeDays(range(13, 0));
  await weighIn(page, 9, 82.6);
  await weighIn(page, 2, 82.4);
  await openWeight(page);
  await expect(card(page)).toContainText('Last 14 days · 14 complete');
  await expect(card(page).getByText('Weigh in to see this')).toBeVisible();
  await expect(card(page)).toContainText('You have 2, the newest on');
  await expect(card(page).getByText('So your maintenance is about')).toHaveCount(0);
  await card(page).getByRole('button', { name: 'Type a weight' }).click();
  await expect(page).toHaveURL('/progress/weight/new');
});

test('labels a figure resting on too little recent logging', async ({ page }) => {
  completeDays([...range(20, 7), 5, 2, 0]);
  for (const ago of [12, 6, 3, 1]) await weighIn(page, ago, 82.5);
  await openWeight(page);
  await expect(card(page)).toContainText('Last 14 days · 10 complete');
  await expect(card(page).getByText('So your maintenance is about')).toBeVisible();
  await expect(card(page)).toContainText(
    'Based on too little recent logging: 3 of the last 7 days are complete.',
  );
  await expect(card(page).getByRole('button', { name: 'Apply to targets' })).toBeEnabled();
});

test('shows intake, trend and maintenance, changes nothing, and applies by hand', async ({
  page,
}) => {
  completeDays(range(13, 0));
  for (const [ago, kg] of [
    [16, 82.9],
    [12, 82.7],
    [8, 82.6],
    [4, 82.4],
    [1, 82.3],
  ] as const) {
    await weighIn(page, ago, kg);
  }
  const check: {
    meanIntakeKcal: number;
    trendChangeKgPerWeek: number;
    maintenanceKcal: number;
    apply: { calorieTargetKcal: number; adjustmentKcal: number };
  } = await (await page.request.get('/api/maintenance-check')).json();
  const target = check.apply.calorieTargetKcal;

  await openWeight(page);
  await expect(card(page)).toContainText('Last 14 days · 14 complete');
  await expect(card(page)).toContainText(
    new RegExp(`You ate, on average\\s*${kcal(check.meanIntakeKcal)} kcal a day`),
  );
  await expect(card(page)).toContainText(
    new RegExp(`Your trend moved\\s*−${Math.abs(check.trendChangeKgPerWeek).toFixed(2)} kg a week`),
  );
  await expect(card(page)).toContainText(`≈ ${kcal(check.maintenanceKcal)} kcal`);
  await expect(card(page)).toContainText('Read-only. Your targets stay at 2,300 kcal');
  await expect(card(page)).not.toContainText('too little recent logging');

  // Reading the card never moved the phase.
  type Phase = { endedOn: string | null; calorieTargetKcal: number; calorieBasis: string };
  const open = async () => {
    const { items }: { items: Phase[] } = await (await page.request.get('/api/goal-phases')).json();
    return items.find((each) => each.endedOn === null);
  };
  expect(await open()).toMatchObject({ calorieTargetKcal: 2300, calorieBasis: 'manual' });

  // Not now leaves it as it was.
  await card(page).getByRole('button', { name: 'Apply to targets' }).click();
  const sheet = page.getByRole('dialog', { name: 'Apply to targets' });
  await expect(sheet).toContainText(`Set your calories to ${kcal(target)} kcal a day?`);
  await expect(sheet).toContainText(
    `Your maintenance of about ${kcal(check.maintenanceKcal)} kcal, less ${kcal(-check.apply.adjustmentKcal)} kcal for your cut of 0.5% a week.`,
  );
  await expect(sheet).toContainText('Now 2,300 yours');
  await expect(sheet).toContainText(`New ${kcal(target)} measured`);
  await sheet.getByRole('button', { name: 'Not now' }).click();
  await expect(sheet).toBeHidden();
  expect(await open()).toMatchObject({ calorieTargetKcal: 2300, calorieBasis: 'manual' });

  await card(page).getByRole('button', { name: 'Apply to targets' }).click();
  await sheet.getByRole('button', { name: `Apply ${kcal(target)} kcal` }).click();
  await expect(sheet).toBeHidden();
  await expect(card(page)).toContainText(
    `Applied: your calories are ${kcal(target)} kcal a day, measured.`,
  );
  await expect(card(page).getByRole('button', { name: 'Apply to targets' })).toHaveCount(0);
  expect(await open()).toMatchObject({ calorieTargetKcal: target, calorieBasis: 'measured' });
});
