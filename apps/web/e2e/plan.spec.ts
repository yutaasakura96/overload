import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
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

// Both tests answer the plan's generate request themselves; a service worker would send it past
// page.route in WebKit.
test.use({ serviceWorkers: 'block' });

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
  // Batch-cooked and entered by hand: no MEXT cooked counterpart, so it is planned raw and says so.
  {
    name: 'Chicken breast, skinless',
    state: 'raw',
    keepsDays: 4,
    ...per100g(105, 23.3, 0.1, 1.9),
  },
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
  await page.clock.install({ time: new Date(`${today.date}T12:00:00+09:00`) });
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
  await expect(timeline.getByText('raw, no cooked match').first()).toBeVisible();
  await expect(
    page.getByText(/planned at its raw weight, because the food table has/),
  ).toBeVisible();
  if (process.env.NO_MISTAKES_EVIDENCE_DIR) {
    await page.screenshot({
      path: `${process.env.NO_MISTAKES_EVIDENCE_DIR}/today-generated-plan.png`,
      fullPage: true,
    });
  }

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

  await page.route('**/api/plan-days/generate', async (route) => {
    await route.fulfill({ status: 500, body: 'Generation failed' });
  });
  await page.goto('/plan/phase');
  await page.getByRole('button', { name: 'Save targets' }).click();
  await expect(
    page.getByText('Saved. The plan couldn’t be made again; try again when you have signal.'),
  ).toBeVisible();
  await expect(page.getByText('Not saved')).toHaveCount(0);
  await page.unroute('**/api/plan-days/generate');
  await page.goto('/');

  await timeline.getByRole('button', { name: 'Start Push A' }).click();
  await expect(page).toHaveURL(/\/workout/);
});

test('About you keeps refusals until each field is valid', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add your details' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('A weight between 20 and 300 kg.')).toBeVisible();
  await expect(page.getByText('A height between 100 and 250 cm.')).toBeVisible();

  await page.getByRole('textbox', { name: /^Weight/ }).fill('5');
  await expect(page.getByText('A weight between 20 and 300 kg.')).toBeVisible();
  await page.getByRole('textbox', { name: /^Weight/ }).fill('82.5');
  await expect(page.getByText('A weight between 20 and 300 kg.')).toHaveCount(0);
  await page.getByRole('textbox', { name: /^Height/ }).fill('5');
  await expect(page.getByText('A height between 100 and 250 cm.')).toBeVisible();
  await page.getByRole('textbox', { name: /^Height/ }).fill('176');
  await page.getByLabel('Birth date').fill('1994-05-01');
  await page.getByRole('radio', { name: 'Male', exact: true }).check();
  await expect(page.getByText('Fix the marked fields.')).toHaveCount(0);
  await expect(page.getByText('Refused', { exact: true })).toHaveCount(0);
});

async function proteinPlanAfterWeighIn(page: Page, proteinGPerKg: number, nextWeightKg: number) {
  const headers = { Origin: WEB_ORIGIN };
  const today = todayInZone().date;
  // The week Today reads. Leaving a day of it unmade makes Today regenerate the plan on load,
  // which would bring today up to the new target and take the shortfall away.
  const weekEnd = new Date(Date.parse(`${today}T00:00:00Z`) + 6 * DAY_MS)
    .toISOString()
    .slice(0, 10);
  expect(
    (
      await page.request.patch('/api/me/profile', {
        headers,
        data: { heightCm: 176, sex: 'male', birthDate: '1994-05-01', trainingWeekdays: [] },
      })
    ).ok(),
  ).toBe(true);
  const weighIn = (weightKg: number) =>
    page.request.post('/api/weigh-ins', {
      headers,
      data: {
        id: randomUUID(),
        measuredAt: new Date(Date.now() - (weightKg === 80 ? 14 * DAY_MS : 0)).toISOString(),
        weightKg,
      },
    });
  expect((await weighIn(80)).ok()).toBe(true);
  expect(
    (
      await page.request.post('/api/goal-phases', {
        headers,
        data: {
          id: randomUUID(),
          type: 'cut',
          startedOn: today,
          targetRatePctPerWeek: 0.5,
          proteinGPerKg,
          fatPctCalories: 25,
          calorieTargetKcal: 1800,
          calorieBasis: 'manual',
        },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await page.request.put('/api/day-routines/rest', {
        headers,
        data: {
          wakeTime: '07:00',
          workStart: null,
          workEnd: null,
          trainingTime: null,
          bedTime: '23:00',
          slots: [
            { time: '08:00', label: 'Breakfast' },
            { time: '12:00', label: 'Lunch' },
            { time: '19:00', label: 'Dinner' },
          ],
        },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await page.request.post('/api/plan-days/generate', {
        headers,
        data: { from: today, to: weekEnd },
      })
    ).ok(),
  ).toBe(true);
  const readPlan = async () => {
    const read: {
      days: {
        id: string;
        targets: { proteinG: number };
        planned: { proteinG: number };
        shortfalls: { target: string }[];
      }[];
    } = await (await page.request.get(`/api/plan-days?from=${today}&to=${today}`)).json();
    const day = read.days[0];
    if (day === undefined) throw new Error('no plan');
    return day;
  };
  const original = await readPlan();

  expect((await weighIn(nextWeightKg)).ok()).toBe(true);
  const current: { proteinG: number } = await (
    await page.request.get('/api/targets/current')
  ).json();
  expect(current.proteinG).not.toBe(original.targets.proteinG);
  expect((await readPlan()).id).toBe(original.id);
  return { original, current };
}

test('Today shows a new protein shortfall after a higher weigh-in', async ({ page }) => {
  const { original, current } = await proteinPlanAfterWeighIn(page, 1, 110);
  expect(original.shortfalls.some((shortfall) => shortfall.target === 'protein')).toBe(false);
  const missing = Math.round(current.proteinG - original.planned.proteinG);
  expect(missing).toBeGreaterThan(5);
  await page.goto('/');
  const target = Math.round(current.proteinG);
  await expect(
    page.locator('.macro').filter({ hasText: 'Protein' }).locator('.macro__of'),
  ).toHaveText(`/ ${target}`);
  await expect(page.getByText(`Protein ${missing} g short`)).toBeVisible();
  await expect(page.getByText(new RegExp(`today’s target of ${target} g`))).toBeVisible();
});

test('Today hides an old protein shortfall after a lower weigh-in', async ({ page }) => {
  const { original, current } = await proteinPlanAfterWeighIn(page, 4, 20);
  expect(original.shortfalls.some((shortfall) => shortfall.target === 'protein')).toBe(true);
  expect(current.proteinG - original.planned.proteinG).toBeLessThanOrEqual(5);
  await page.goto('/');
  await expect(
    page.locator('.macro').filter({ hasText: 'Protein' }).locator('.macro__of'),
  ).toHaveText(`/ ${Math.round(current.proteinG)}`);
  await expect(page.getByText(/^Protein \d+ g short$/)).toHaveCount(0);
});

test('About you reports saved details separately when its weigh-in fails', async ({ page }) => {
  await page.route('**/api/weigh-ins', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({ status: 500, body: 'Weigh-in failed' });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Add your details' }).click();
  await page.getByRole('textbox', { name: /^Weight/ }).fill('82.5');
  await page.getByRole('textbox', { name: /^Height/ }).fill('176');
  await page.getByLabel('Birth date').fill('1994-05-01');
  await page.getByRole('radio', { name: 'Male', exact: true }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(
    page.getByText('Your details saved. The weigh-in wasn’t; save again when you have signal.'),
  ).toBeVisible();
  const saved: { profile: { heightCm: number; sex: string } } = await (
    await page.request.get('/api/me')
  ).json();
  expect(saved.profile).toMatchObject({ heightCm: 176, sex: 'male' });
  if (process.env.E2E_EVIDENCE_DIR) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${process.env.E2E_EVIDENCE_DIR}/partial-about-save.png` });
  }
  await page.unroute('**/api/weigh-ins');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
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
  let failedOnce = false;
  await page.route('**/api/plan-days/generate', async (route) => {
    if (failedOnce) {
      await route.continue();
      return;
    }
    failedOnce = true;
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
  await expect(page.getByText('Couldn’t make today’s plan.', { exact: false })).toBeVisible();
  await expect(page.getByText('Today’s plan is ready.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('region', { name: 'The day’s totals' })).toContainText(
    'kcal planned',
  );

  const today = todayInZone().date;
  expect(
    (
      await page.request.put('/api/day-routines/training', {
        headers,
        data: {
          wakeTime: '09:00',
          workStart: null,
          workEnd: null,
          trainingTime: '23:00',
          bedTime: '02:00',
          slots: [
            { time: '09:30', label: 'Breakfast' },
            { time: '14:00', label: 'Lunch' },
            { time: '21:00', label: 'Before training' },
            { time: '00:15', label: 'After training' },
          ],
        },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await page.request.post('/api/plan-days/generate', {
        headers,
        data: { from: today, to: today },
      })
    ).ok(),
  ).toBe(true);
  // The meal due is the first not yet confirmed (S18): the evening's are eaten, so it is 00:15's.
  const planned: { days: { meals: { id: string; plannedTime: string }[] }[] } = await (
    await page.request.get(`/api/plan-days?from=${today}&to=${today}`)
  ).json();
  for (const meal of planned.days[0]?.meals ?? []) {
    if (meal.plannedTime === '00:15') continue;
    const eaten = await page.request.post(`/api/plan-meals/${meal.id}/confirm`, {
      headers,
      data: { status: 'as_planned' },
    });
    expect(eaten.ok()).toBe(true);
  }
  await page.clock.setFixedTime(new Date(`${today}T14:00:00Z`));
  await page.reload();
  const timeline = page.getByRole('region', { name: 'The day', exact: true });
  await expect(timeline.locator('.timeline__time').getByText('23:00')).toBeVisible();
  await expect(timeline.locator('.timeline__time').getByText('00:15')).toBeVisible();
  const times = await timeline.locator('.timeline__time').allTextContents();
  expect(times.indexOf('23:00')).toBeLessThan(times.indexOf('00:15'));
  await expect(
    timeline
      .locator('.timeline__entry')
      .filter({ hasText: '00:15' })
      .locator('.timeline__dot--active'),
  ).toBeVisible();
  // 00:15 the next calendar day, before its 09:00 wake: still the waking day with the 00:15 meal.
  await page.clock.setFixedTime(new Date(`${today}T15:15:00Z`));
  await page.reload();
  await expect(timeline.locator('.timeline__time').getByText('00:15')).toBeVisible();
  await expect(
    timeline
      .locator('.timeline__entry')
      .filter({ hasText: '00:15' })
      .locator('.timeline__dot--active'),
  ).toBeVisible();

  // A day whose training days arrive but whose routine does not says which part was stored.
  await page.route('**/api/day-routines/*', async (route) => {
    if (route.request().method() !== 'PUT') {
      await route.continue();
      return;
    }
    await route.fulfill({ status: 500, body: 'Routine failed' });
  });
  await page.goto('/plan/day');
  await page.getByRole('radio', { name: 'Training day' }).check();
  await page.getByRole('button', { name: 'Monday', exact: true }).click();
  await page.getByRole('button', { name: 'Use these meals' }).click();
  await expect(
    page.getByText(
      'Training days saved. The training day wasn’t; save again when you have signal.',
    ),
  ).toBeVisible();
  if (process.env.E2E_EVIDENCE_DIR) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${process.env.E2E_EVIDENCE_DIR}/partial-day-save.png` });
  }
  await expect(page.getByText('Not saved')).toHaveCount(0);
  const saved: { profile: { trainingWeekdays: number[] } } = await (
    await page.request.get('/api/me')
  ).json();
  expect(saved.profile.trainingWeekdays).not.toContain(1);
});

test('a Your day save moves the phase’s calories only with the training days', async ({ page }) => {
  const headers = { Origin: WEB_ORIGIN };
  expect(
    (
      await page.request.patch('/api/me/profile', {
        headers,
        data: {
          heightCm: 176,
          sex: 'male',
          birthDate: '1994-05-01',
          trainingWeekdays: [1, 2, 3, 4, 5, 6, 7],
        },
      })
    ).ok(),
  ).toBe(true);
  const weighIn = (weightKg: number) =>
    page.request.post('/api/weigh-ins', {
      headers,
      data: { id: randomUUID(), measuredAt: new Date().toISOString(), weightKg },
    });
  expect((await weighIn(82.5)).ok()).toBe(true);
  const created = await page.request.post('/api/goal-phases', {
    headers,
    data: {
      id: randomUUID(),
      type: 'cut',
      startedOn: todayInZone().date,
      targetRatePctPerWeek: 0.5,
      proteinGPerKg: 2.2,
      fatPctCalories: 25,
      calorieTargetKcal: 2350,
      calorieBasis: 'provisional_formula',
    },
  });
  expect(created.ok()).toBe(true);
  const { calorieTargetKcal: before }: { calorieTargetKcal: number } = await created.json();
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
  // A new weigh-in moves the formula's figure; only a change of training days follows it.
  expect((await weighIn(95)).ok()).toBe(true);

  await page.goto('/plan/day');
  await page.getByLabel('Wake').fill('07:00');
  await page.getByRole('button', { name: 'Use these meals' }).click();
  await expect(page.getByText('Saved. The week’s plan is made again from it.')).toBeVisible();
  const phases: { items: { endedOn: string | null; calorieTargetKcal: number }[] } = await (
    await page.request.get('/api/goal-phases')
  ).json();
  expect(phases.items.find((phase) => phase.endedOn === null)?.calorieTargetKcal).toBe(before);

  // Changing the training days moves the formula's calories with them, in the same write.
  await page.goto('/plan/day');
  await page.getByRole('radio', { name: 'Training day' }).check();
  await page.getByRole('button', { name: 'Monday', exact: true }).click();
  await page.getByRole('button', { name: 'Use these meals' }).click();
  await expect(page.getByText('Saved. The week’s plan is made again from it.')).toBeVisible();
  const defaults: { calories: { value: number } } = await (
    await page.request.get('/api/goal-phases/defaults?type=cut&targetRatePctPerWeek=0.5')
  ).json();
  expect(defaults.calories.value).not.toBe(before);
  const followed: { items: { endedOn: string | null; calorieTargetKcal: number }[] } = await (
    await page.request.get('/api/goal-phases')
  ).json();
  expect(followed.items.find((phase) => phase.endedOn === null)?.calorieTargetKcal).toBe(
    defaults.calories.value,
  );

  // While the meals for an edited time load, the previous answer is on screen but never saved.
  await page.goto('/plan/day');
  const use = page.getByRole('button', { name: 'Use these meals' });
  await expect(use).toHaveAttribute('aria-disabled', 'false');
  const puts: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'PUT') puts.push(request.url());
  });
  const { promise: held, resolve: release } = Promise.withResolvers<void>();
  await page.route('**/api/day-routines/*/recommendation*', async (route) => {
    await held;
    await route.continue();
  });
  await page.getByLabel('Wake').fill('08:15');
  await expect(use).toHaveAttribute('aria-disabled', 'true');
  // Forced: Playwright waits for an aria-disabled button to be enabled before it clicks.
  await use.click({ force: true });
  release();
  await expect(use).toHaveAttribute('aria-disabled', 'false');
  expect(puts).toEqual([]);

  // A cached answer that a goal phase save made out of date is shown while it is asked again, but
  // never saved.
  await page.unroute('**/api/day-routines/*/recommendation*');
  const go = (path: string) =>
    page.evaluate((to) => {
      window.history.pushState({}, '', to);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, path);
  await go('/plan/phase');
  await page.getByLabel('Protein').fill('2.6');
  await page.getByRole('button', { name: 'Save targets' }).click();
  await expect(page).toHaveURL(/\/$/);
  const { promise: heldAgain, resolve: releaseAgain } = Promise.withResolvers<void>();
  await page.route('**/api/day-routines/*/recommendation*', async (route) => {
    await heldAgain;
    await route.continue();
  });
  await go('/plan/day');
  await expect(page.getByLabel('Wake')).toHaveValue('06:30');
  await expect(use).toHaveAttribute('aria-disabled', 'true');
  await use.click({ force: true });
  releaseAgain();
  await expect(use).toHaveAttribute('aria-disabled', 'false');
  expect(puts).toEqual([]);
});

test('a goal phase save waits for the calories of the rate typed', async ({ page }) => {
  const headers = { Origin: WEB_ORIGIN };
  expect(
    (
      await page.request.patch('/api/me/profile', {
        headers,
        data: { heightCm: 176, sex: 'male', birthDate: '1994-05-01', trainingWeekdays: [1, 3, 5] },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await page.request.post('/api/weigh-ins', {
        headers,
        data: { id: randomUUID(), measuredAt: new Date().toISOString(), weightKg: 82.5 },
      })
    ).ok(),
  ).toBe(true);
  await page.goto('/plan/phase');
  const save = page.getByRole('button', { name: 'Save targets' });
  await expect(save).toBeVisible();
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/goal-phases') && request.method() !== 'GET') {
      writes.push(request.method());
    }
  });
  const { promise: held, resolve: release } = Promise.withResolvers<void>();
  await page.route('**/api/goal-phases/defaults*', async (route) => {
    await held;
    await route.continue();
  });
  await page.getByLabel('Target rate, loss a week').fill('1');
  await expect(save).toHaveAttribute('aria-disabled', 'true');
  await save.click({ force: true });
  release();
  await expect(save).not.toHaveAttribute('aria-disabled');
  expect(writes).toEqual([]);
  const faster: { calories: { value: number } } = await (
    await page.request.get('/api/goal-phases/defaults?type=cut&targetRatePctPerWeek=1')
  ).json();
  await save.click();
  await expect.poll(() => writes).toEqual(['POST']);
  await expect
    .poll(async () => {
      const phases: { items: { calorieTargetKcal: number; targetRatePctPerWeek: number }[] } =
        await (await page.request.get('/api/goal-phases')).json();
      return phases.items[0];
    })
    .toMatchObject({ calorieTargetKcal: faster.calories.value, targetRatePctPerWeek: 1 });
});

test('editing an open provisional phase follows the rate unless Calories is edited', async ({
  page,
}) => {
  const headers = { Origin: WEB_ORIGIN };
  expect(
    (
      await page.request.patch('/api/me/profile', {
        headers,
        data: { heightCm: 176, sex: 'male', birthDate: '1994-05-01', trainingWeekdays: [1, 3, 5] },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await page.request.post('/api/weigh-ins', {
        headers,
        data: { id: randomUUID(), measuredAt: new Date().toISOString(), weightKg: 82.5 },
      })
    ).ok(),
  ).toBe(true);
  const defaultCalories = async (rate: number) => {
    const defaults: { calories: { value: number } } = await (
      await page.request.get(`/api/goal-phases/defaults?type=cut&targetRatePctPerWeek=${rate}`)
    ).json();
    return defaults.calories.value;
  };
  const original = await defaultCalories(0.5);
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
          calorieTargetKcal: original,
          calorieBasis: 'provisional_formula',
        },
      })
    ).ok(),
  ).toBe(true);
  const openPhase = async () => {
    const phases: {
      items: {
        endedOn: string | null;
        calorieTargetKcal: number;
        calorieBasis: string;
        targetRatePctPerWeek: number;
      }[];
    } = await (await page.request.get('/api/goal-phases')).json();
    return phases.items.find((phase) => phase.endedOn === null);
  };

  await page.goto('/plan/phase');
  const calories = page.getByRole('textbox', { name: 'Calories in kilocalories a day' });
  const save = page.getByRole('button', { name: 'Save targets' });
  await expect(calories).toHaveValue('');
  await expect(calories).toHaveAttribute('placeholder', String(original));
  await page.getByLabel('Target rate, loss a week').fill('1');
  const current = await defaultCalories(1);
  expect(current).not.toBe(original);
  await expect(calories).toHaveAttribute('placeholder', String(current));
  await save.click();
  await expect.poll(openPhase).toMatchObject({
    calorieTargetKcal: current,
    calorieBasis: 'provisional_formula',
    targetRatePctPerWeek: 1,
  });

  await page.goto('/plan/phase');
  const manual = current + 200;
  await calories.fill(String(manual));
  await page.getByLabel('Target rate, loss a week').fill('1.5');
  await expect(calories).toHaveValue(String(manual));
  await save.click();
  await expect.poll(openPhase).toMatchObject({
    calorieTargetKcal: manual,
    calorieBasis: 'manual',
    targetRatePctPerWeek: 1.5,
  });
  await expect(page).toHaveURL(/\/$/);

  // Clearing your own figure returns the phase to the formula.
  await page.goto('/plan/phase');
  await expect(calories).toHaveValue(String(manual));
  await calories.fill('');
  const formula = await defaultCalories(1.5);
  await expect(calories).toHaveAttribute('placeholder', String(formula));
  await save.click();
  await expect.poll(openPhase).toMatchObject({
    calorieTargetKcal: formula,
    calorieBasis: 'provisional_formula',
    targetRatePctPerWeek: 1.5,
  });
});

test('Goal phase says when the calories missed a change of training days', async ({
  page,
  context,
}) => {
  const headers = { Origin: WEB_ORIGIN };
  expect(
    (
      await page.request.patch('/api/me/profile', {
        headers,
        data: { heightCm: 176, sex: 'male', birthDate: '1994-05-01', trainingWeekdays: [1, 3, 5] },
      })
    ).ok(),
  ).toBe(true);
  const weighIn = async () => {
    const id = randomUUID();
    const weighed = await page.request.post('/api/weigh-ins', {
      headers,
      data: { id, measuredAt: new Date().toISOString(), weightKg: 82.5 },
    });
    expect(weighed.ok()).toBe(true);
    return id;
  };
  const weighInId = await weighIn();
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
          calorieBasis: 'provisional_formula',
        },
      })
    ).ok(),
  ).toBe(true);
  // An offline weekday edit stays on the form; after reconnecting, the real save records that
  // provisional calories could not follow once the member has no current weigh-in.
  await page.goto('/plan/day');
  const useMeals = page.getByRole('button', { name: 'Use these meals' });
  await expect(useMeals).toHaveAttribute('aria-disabled', 'false');
  await page.getByRole('button', { name: 'Tuesday', exact: true }).click();
  await context.setOffline(true);
  await useMeals.click();
  await expect(
    page.getByText(
      'Couldn’t reach Overload. The day is still here; save again when you have signal.',
    ),
  ).toBeVisible();
  if (process.env.E2E_EVIDENCE_DIR) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${process.env.E2E_EVIDENCE_DIR}/offline-day-save.png` });
  }
  await context.setOffline(false);
  const unchanged: { profile: { trainingWeekdays: number[] } } = await (
    await page.request.get('/api/me')
  ).json();
  expect(unchanged.profile.trainingWeekdays).toEqual([1, 3, 5]);
  expect((await page.request.delete(`/api/weigh-ins/${weighInId}`, { headers })).ok()).toBe(true);
  expect(
    (
      await page.request.patch('/api/me/profile', {
        headers,
        data: { trainingWeekdays: [1, 2, 3, 5] },
      })
    ).ok(),
  ).toBe(true);
  const changed: { profile: { trainingWeekdays: number[] } } = await (
    await page.request.get('/api/me')
  ).json();
  expect(changed.profile.trainingWeekdays).toEqual([1, 2, 3, 5]);

  await page.goto('/plan/phase');
  const notice = page.getByText('Calories weren’t updated for your new training days.');
  await expect(notice).toBeVisible();
  if (process.env.E2E_EVIDENCE_DIR) {
    await page.screenshot({ path: `${process.env.E2E_EVIDENCE_DIR}/goal-phase-stale-notice.png` });
  }
  await page.reload();
  await expect(notice).toBeVisible();
  if (process.env.E2E_EVIDENCE_DIR) {
    await page.screenshot({
      path: `${process.env.E2E_EVIDENCE_DIR}/goal-phase-notice-reloaded.png`,
    });
  }
  await weighIn();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Save targets' })).toBeVisible();
  await expect(notice).toBeHidden();
  if (process.env.E2E_EVIDENCE_DIR) {
    await page.screenshot({ path: `${process.env.E2E_EVIDENCE_DIR}/goal-phase-after-reload.png` });
  }
});

test('a measured figure typed again in Calories is saved as yours', async ({ page }) => {
  const headers = { Origin: WEB_ORIGIN };
  expect(
    (
      await page.request.patch('/api/me/profile', {
        headers,
        data: { heightCm: 176, sex: 'male', birthDate: '1994-05-01', trainingWeekdays: [1, 3, 5] },
      })
    ).ok(),
  ).toBe(true);
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
        data: manualCut(todayInZone().date),
      })
    ).ok(),
  ).toBe(true);
  // No API sets a measured figure yet (the maintenance check, S18a): the screen is shown one.
  await page.route('**/api/goal-phases', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body: { items: { endedOn: string | null; calorieBasis: string }[] } =
      await response.json();
    await route.fulfill({
      response,
      json: {
        items: body.items.map((phase) =>
          phase.endedOn === null ? { ...phase, calorieBasis: 'measured' } : phase,
        ),
      },
    });
  });
  const sent: unknown[] = [];
  page.on('request', (request) => {
    if (request.method() === 'PATCH' && request.url().includes('/api/goal-phases/')) {
      sent.push(request.postDataJSON());
    }
  });

  await page.goto('/plan/phase');
  const calories = page.getByRole('textbox', { name: 'Calories in kilocalories a day' });
  const note = page.locator('.field__label-row', { hasText: /^Calories/ }).locator('.field__note');
  await expect(note).toHaveText('Measured');
  const figure = await calories.inputValue();
  await calories.fill('');
  await calories.fill(figure);
  await expect(note).toHaveText('Yours');
  await page.getByRole('button', { name: 'Save targets' }).click();
  await expect
    .poll(() => sent)
    .toEqual([
      expect.objectContaining({ calorieTargetKcal: Number(figure), calorieBasis: 'manual' }),
    ]);
});

const dayFromToday = (offset: number) =>
  new Date(Date.parse(`${todayInZone().date}T00:00:00Z`) + offset * DAY_MS)
    .toISOString()
    .slice(0, 10);

const manualCut = (startedOn: string, endPrevious = false) => ({
  id: randomUUID(),
  type: 'cut',
  startedOn,
  endPrevious,
  targetRatePctPerWeek: 0.5,
  proteinGPerKg: 2.2,
  fatPctCalories: 25,
  calorieTargetKcal: 2350,
  calorieBasis: 'manual',
});

test('refuses a replacement phase that overlaps its open predecessor', async ({ page }) => {
  const headers = { Origin: WEB_ORIGIN };
  const first = dayFromToday(-3);
  expect(
    (await page.request.post('/api/goal-phases', { headers, data: manualCut(first) })).status(),
  ).toBe(201);
  for (const start of [first, dayFromToday(-4)]) {
    const refused = await page.request.post('/api/goal-phases', {
      headers,
      data: manualCut(start, true),
    });
    expect(refused.status()).toBe(422);
    expect(refused.headers()['content-type']).toContain('application/problem+json');
    expect(await refused.json()).toMatchObject({
      code: 'validation_failed',
      errors: [{ path: 'startedOn', message: 'Start after the open phase began' }],
    });
  }
  expect(
    (
      await page.request.post('/api/goal-phases', {
        headers,
        data: manualCut(dayFromToday(-2), true),
      })
    ).status(),
  ).toBe(201);
  const history: { items: { startedOn: string; endedOn: string | null }[] } = await (
    await page.request.get('/api/goal-phases')
  ).json();
  expect(history.items.map(({ startedOn, endedOn }) => [startedOn, endedOn])).toEqual([
    [dayFromToday(-2), null],
    [first, first],
  ]);
});
