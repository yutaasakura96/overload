import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { planFoods } from '../src/db/plans';
import { localDateIn } from '../src/db/training';
import { goalPhase, planDay, planMeal } from '../src/db/schema';
import { sender } from './account-fixture';
import { useTestApp } from './harness';

// S14 to S16's routes (docs/07 §4, issue #79): the goal phase and its defaults with their sources,
// the day routine and its recommendation, the targets in force, and generating and reading plan
// days: a confirmed day is never made again, setup steps are named in order, and every route's
// cross-user case (docs/08 §10).
const t = useTestApp();

type Send = ReturnType<typeof sender>;
type Phase = { id: string; type: string; startedOn: string; endedOn: string | null };
type PlanDayBody = {
  id: string;
  date: string;
  dayType: string;
  complete: boolean;
  targets: { energyKcal: number; proteinG: number };
  planned: { energyKcal: number; proteinG: number };
  shortfalls: { target: string; missingG?: number }[];
  meals: {
    id: string;
    label: string;
    isPreTraining: boolean;
    isPostTraining: boolean;
    evidence: { sourceKey: string }[];
    items: {
      name: string;
      plannedGrams: number;
      pieceCount: number | null;
      cooked: boolean;
      approximate: boolean;
      noCookedMatch: boolean;
      per100g: { energyKcal: number; proteinG: number };
    }[];
  }[];
};
type Days = { missing: string[]; days: PlanDayBody[] };

const today = () => localDateIn('Asia/Tokyo')(new Date());
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

async function member(email: string) {
  const { cookie, user } = await t.createSignedInUser(email);
  return { user, send: sender(t, cookie) };
}

async function aboutYou(send: Send) {
  expect(
    (
      await send('PATCH', '/api/me/profile', {
        timezone: 'Asia/Tokyo',
        heightCm: 176,
        sex: 'male',
        birthDate: '1995-03-08',
        trainingWeekdays: [1, 2, 4, 5],
      })
    ).status,
  ).toBe(200);
  const weighed = await send('POST', '/api/weigh-ins', {
    id: randomUUID(),
    measuredAt: new Date(Date.now() - 60_000).toISOString(),
    weightKg: 82.4,
  });
  expect(weighed.status).toBe(201);
}

const per100 = (energyKcal: number, proteinG: number, carbG: number, fatG: number, fiberG = 0) => ({
  basis: { kind: 'per_100g', grams: 100 },
  energyKcal,
  proteinG,
  carbG,
  fatG,
  fiberG,
});

async function addFoods(send: Send, foods = 'all' as 'all' | 'weak') {
  const list =
    foods === 'weak'
      ? [
          { name: 'Tofu', state: 'raw', ...per100(73, 7, 1.5, 4.9, 1.1) },
          { name: 'Rice, cooked', state: 'cooked', ...per100(156, 2.5, 37.1, 0.3, 1.5) },
        ]
      : [
          { name: 'Chicken breast', state: 'raw', keepsDays: 4, ...per100(105, 23.3, 0.1, 1.9) },
          { name: 'Rice, cooked', state: 'cooked', ...per100(156, 2.5, 37.1, 0.3, 1.5) },
          { name: 'Rolled oats', state: 'raw', ...per100(350, 13.7, 69.1, 5.7, 9.4) },
          { name: 'Broccoli', state: 'raw', ...per100(37, 5.4, 6.6, 0.6, 5.1) },
          { name: 'Egg', state: 'raw', pieceWeightG: 55, ...per100(142, 12.2, 0.4, 10.2) },
          { name: 'Greek yogurt', state: 'raw', ...per100(59, 10.3, 3.6, 0.4) },
          { name: 'Olive oil', state: 'raw', ...per100(894, 0, 0, 100) },
        ];
  for (const each of list) {
    const res = await send('POST', '/api/foods', { id: randomUUID(), source: 'manual', ...each });
    expect(res.status).toBe(201);
  }
}

const cut = (overrides: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  type: 'cut',
  startedOn: today(),
  targetRatePctPerWeek: 0.5,
  proteinGPerKg: 2.2,
  fatPctCalories: 25,
  calorieTargetKcal: 2350,
  calorieBasis: 'manual',
  ...overrides,
});

/** A cut on the formula's calories, whatever figure it carries: the API works them out. */
const provisionalCut = (overrides: Record<string, unknown> = {}) =>
  cut({ calorieBasis: 'provisional_formula', ...overrides });

const routine = (dayType: 'training' | 'rest') =>
  dayType === 'training'
    ? {
        wakeTime: '06:30',
        workStart: '09:30',
        workEnd: '18:00',
        trainingTime: '18:30',
        bedTime: '23:00',
        slots: [
          { time: '07:00', label: 'Breakfast' },
          { time: '11:45', label: 'Lunch' },
          { time: '16:30', label: 'Before training' },
          { time: '19:45', label: 'After training' },
          { time: '21:30', label: 'Evening' },
        ],
      }
    : {
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
      };

async function setUp(email: string, foods: 'all' | 'weak' = 'all') {
  const who = await member(email);
  await aboutYou(who.send);
  await addFoods(who.send, foods);
  expect((await who.send('POST', '/api/goal-phases', cut())).status).toBe(201);
  for (const dayType of ['training', 'rest'] as const) {
    expect((await who.send('PUT', `/api/day-routines/${dayType}`, routine(dayType))).status).toBe(
      200,
    );
  }
  return who;
}

async function generate(send: Send, from = today(), to = addDays(today(), 6)) {
  const res = await send('POST', '/api/plan-days/generate', { from, to });
  expect(res.status).toBe(200);
  const body: Days = await res.json();
  return body;
}

describe('goal phases', () => {
  it('opens a phase, and a repeat of the same create returns it', async () => {
    const { send } = await member('phase@example.test');
    const body = cut();
    const first = await send('POST', '/api/goal-phases', body);
    expect(first.status).toBe(201);
    const again = await send('POST', '/api/goal-phases', body);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(await first.json());
    expect(
      (await send('POST', '/api/goal-phases', { ...body, calorieTargetKcal: 2000 })).status,
    ).toBe(409);
  });

  it('refuses a second open phase, and ends the first the day before with endPrevious', async () => {
    const { send } = await member('second@example.test');
    const started = addDays(today(), -30);
    await send('POST', '/api/goal-phases', cut({ startedOn: started }));
    const refused = await send(
      'POST',
      '/api/goal-phases',
      cut({ type: 'bulk', targetRatePctPerWeek: 0.25 }),
    );
    expect(refused.status).toBe(409);
    expect((await refused.json()).code).toBe('phase_already_open');

    const bulk = await send(
      'POST',
      '/api/goal-phases',
      cut({ type: 'bulk', targetRatePctPerWeek: 0.25, endPrevious: true }),
    );
    expect(bulk.status).toBe(201);
    const { items }: { items: Phase[] } = await (await send('GET', '/api/goal-phases')).json();
    expect(items.map((phase) => [phase.type, phase.startedOn, phase.endedOn])).toEqual([
      ['bulk', today(), null],
      ['cut', started, addDays(today(), -1)],
    ]);
  });

  it('refuses an equal or earlier replacement start, then accepts the next day', async () => {
    const { send } = await member('phase-boundary@example.test');
    const started = addDays(today(), -2);
    expect((await send('POST', '/api/goal-phases', cut({ startedOn: started }))).status).toBe(201);
    for (const replacementStart of [started, addDays(started, -1)]) {
      const refused = await send(
        'POST',
        '/api/goal-phases',
        cut({ startedOn: replacementStart, endPrevious: true }),
      );
      expect(refused.status).toBe(422);
      expect(refused.headers.get('content-type')).toContain('application/problem+json');
      expect(await refused.json()).toMatchObject({
        code: 'validation_failed',
        errors: [{ path: 'startedOn', message: 'Start after the open phase began' }],
      });
    }
    const next = addDays(started, 1);
    expect(
      (await send('POST', '/api/goal-phases', cut({ startedOn: next, endPrevious: true }))).status,
    ).toBe(201);
    const { items }: { items: Phase[] } = await (await send('GET', '/api/goal-phases')).json();
    expect(items.map((phase) => [phase.startedOn, phase.endedOn])).toEqual([
      [next, null],
      [started, started],
    ]);
  });

  it('refuses a rate on maintenance and none on a cut', async () => {
    const { send } = await member('rate@example.test');
    const maintain = await send('POST', '/api/goal-phases', cut({ type: 'maintain' }));
    expect(maintain.status).toBe(422);
    const noRate = await send('POST', '/api/goal-phases', cut({ targetRatePctPerWeek: null }));
    expect(noRate.status).toBe(422);
  });

  it('sets calorieTargetSetAt only when the calories change', async () => {
    const { send } = await member('patch@example.test');
    const created = await (await send('POST', '/api/goal-phases', cut())).json();
    const fat = await (
      await send('PATCH', `/api/goal-phases/${created.id}`, { fatPctCalories: 30 })
    ).json();
    expect(fat.calorieTargetSetAt).toBe(created.calorieTargetSetAt);
    const kcal = await send('PATCH', `/api/goal-phases/${created.id}`, {
      calorieTargetKcal: 2200,
      calorieBasis: 'manual',
    });
    expect(kcal.status).toBe(200);
    const patched = await kcal.json();
    expect(patched).toMatchObject({
      calorieTargetKcal: 2200,
      calorieBasis: 'manual',
      fatPctCalories: 30,
    });
    expect(Date.parse(patched.calorieTargetSetAt)).toBeGreaterThanOrEqual(
      Date.parse(created.calorieTargetSetAt),
    );
  });

  it('keeps one user’s phases from another', async () => {
    const a = await member('phase-a@example.test');
    const b = await member('phase-b@example.test');
    const created = await (await a.send('POST', '/api/goal-phases', cut())).json();
    expect(
      (await b.send('PATCH', `/api/goal-phases/${created.id}`, { fatPctCalories: 30 })).status,
    ).toBe(404);
    expect((await (await b.send('GET', '/api/goal-phases')).json()).items).toEqual([]);
    // Another user's id is in use: refused as a conflict, and A's phase is unchanged.
    expect((await b.send('POST', '/api/goal-phases', cut({ id: created.id }))).status).toBe(409);
    const [stored] = await t.db.select().from(goalPhase).where(eq(goalPhase.id, created.id));
    expect(stored?.userId).toBe(a.user.id);
    expect(stored?.fatPctCalories).toBe(25);
  });
});

describe('GET /api/goal-phases/defaults', () => {
  it('needs the profile and a weigh-in first', async () => {
    const { send } = await member('nodefaults@example.test');
    const res = await send('GET', '/api/goal-phases/defaults?type=cut');
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'setup_incomplete', missing: ['profile'] });
  });

  it('gives each default with its source, and Mifflin–St Jeor calories less the deficit', async () => {
    const { send } = await member('defaults@example.test');
    await aboutYou(send);
    const body = await (await send('GET', '/api/goal-phases/defaults?type=cut')).json();
    expect(body.targetRatePctPerWeek).toEqual({
      value: 0.5,
      range: [0.5, 1],
      sourceKey: 'rate_cut',
    });
    expect(body.proteinGPerKg).toEqual({
      value: 2.2,
      range: [1.6, 2.2],
      sourceKey: 'protein_g_per_kg',
    });
    expect(body.fatPctCalories).toEqual({
      value: 25,
      range: [15, 30],
      sourceKey: 'fat_pct_calories',
    });
    // 10 × 82.4 + 6.25 × 176 − 5 × age + 5, × 1.65 for four training days, less 0.5% × 82.4 × 1,100.
    const age = body.calories.age;
    const resting = Math.round(824 + 1100 - 5 * age + 5);
    expect(body.calories).toMatchObject({
      basis: 'provisional_formula',
      formula: 'mifflin_st_jeor',
      restingKcal: resting,
      activityLevel: 1.65,
      trainingDaysPerWeek: 4,
      adjustmentKcal: -453,
      value: Math.round((resting * 1.65 - 453) / 10) * 10,
      sourceKey: 'provisional_calories',
    });
    const faster = await (
      await send('GET', '/api/goal-phases/defaults?type=cut&targetRatePctPerWeek=1')
    ).json();
    expect(faster.calories.adjustmentKcal).toBe(-906);
    const maintain = await (await send('GET', '/api/goal-phases/defaults?type=maintain')).json();
    expect(maintain.targetRatePctPerWeek).toBeNull();
    expect(maintain.calories.adjustmentKcal).toBe(0);
    expect(maintain.proteinGPerKg.value).toBe(1.6);
  });
});

/** A cut's provisional calories at the default rate, as the defaults give them now. */
async function formula(send: Send): Promise<number> {
  const defaults: { calories: { value: number } } = await (
    await send('GET', '/api/goal-phases/defaults?type=cut')
  ).json();
  return defaults.calories.value;
}

async function openPhase(send: Send) {
  const phases: {
    items: (Phase & { calorieTargetKcal: number; calorieTargetSetAt: string })[];
  } = await (await send('GET', '/api/goal-phases')).json();
  return phases.items.find((phase) => phase.endedOn === null);
}

const weekdays = (send: Send, trainingWeekdays: number[]) =>
  send('PATCH', '/api/me/profile', { trainingWeekdays });

describe('training weekdays and the open phase', () => {
  it('moves the formula’s calories to its new figure in the write that changes the weekdays', async () => {
    const { send } = await member('follow@example.test');
    await aboutYou(send);
    const four = await formula(send);
    const created = await (await send('POST', '/api/goal-phases', provisionalCut())).json();
    expect(created.calorieTargetKcal).toBe(four);
    expect((await weekdays(send, [1, 2, 3, 4, 5, 6])).status).toBe(200);
    const six = await formula(send);
    expect(six).not.toBe(four);
    const phase = await openPhase(send);
    expect(phase).toMatchObject({ calorieTargetKcal: six, calorieBasis: 'provisional_formula' });
    expect(Date.parse(phase?.calorieTargetSetAt ?? '')).toBeGreaterThanOrEqual(
      Date.parse(created.calorieTargetSetAt),
    );
  });

  it('leaves the phase when the weekdays are the same, in any order, or not sent', async () => {
    const { send } = await member('nofollow@example.test');
    await aboutYou(send);
    const created = await (await send('POST', '/api/goal-phases', provisionalCut())).json();
    expect((await weekdays(send, [5, 4, 2, 1])).status).toBe(200);
    // A new height moves the formula's figure; only a change of weekdays would move the phase.
    expect((await send('PATCH', '/api/me/profile', { heightCm: 180 })).status).toBe(200);
    expect(await formula(send)).not.toBe(created.calorieTargetKcal);
    const phase = await openPhase(send);
    expect(phase).toMatchObject({
      calorieTargetKcal: created.calorieTargetKcal,
      calorieBasis: 'provisional_formula',
    });
    expect(phase?.calorieTargetSetAt).toBe(created.calorieTargetSetAt);
  });

  it('keeps calories the user set', async () => {
    const { send } = await member('manual@example.test');
    await aboutYou(send);
    expect(
      (
        await send(
          'POST',
          '/api/goal-phases',
          cut({ calorieTargetKcal: 2200, calorieBasis: 'manual' }),
        )
      ).status,
    ).toBe(201);
    expect((await weekdays(send, [1, 3, 5])).status).toBe(200);
    expect(await openPhase(send)).toMatchObject({
      calorieTargetKcal: 2200,
      calorieBasis: 'manual',
    });
  });

  it('moves only the caller’s phase', async () => {
    const a = await member('follow-a@example.test');
    const b = await member('follow-b@example.test');
    await aboutYou(a.send);
    await aboutYou(b.send);
    const four = await formula(b.send);
    expect((await a.send('POST', '/api/goal-phases', provisionalCut())).status).toBe(201);
    expect((await b.send('POST', '/api/goal-phases', provisionalCut())).status).toBe(201);
    expect((await weekdays(a.send, [1, 2, 3, 4, 5, 6, 7])).status).toBe(200);
    expect((await openPhase(a.send))?.calorieTargetKcal).not.toBe(four);
    expect((await openPhase(b.send))?.calorieTargetKcal).toBe(four);
  });
});

describe('the formula’s calories on a phase write', () => {
  it('stores the formula’s figure on a create, whatever figure the device sent', async () => {
    const { send } = await member('create-formula@example.test');
    expect(await (await send('POST', '/api/goal-phases', provisionalCut())).json()).toMatchObject({
      code: 'setup_incomplete',
      missing: ['profile'],
    });
    await aboutYou(send);
    const body = provisionalCut({ calorieTargetKcal: 1500 });
    const created = await send('POST', '/api/goal-phases', body);
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      calorieTargetKcal: await formula(send),
      calorieBasis: 'provisional_formula',
    });
    const again = await send('POST', '/api/goal-phases', { ...body, calorieTargetKcal: 1600 });
    expect(again.status).toBe(200);
  });

  it('moves an open provisional phase’s calories to its new rate’s', async () => {
    const { send } = await member('rate-formula@example.test');
    await aboutYou(send);
    const created = await (await send('POST', '/api/goal-phases', provisionalCut())).json();
    const faster: { calories: { value: number } } = await (
      await send('GET', '/api/goal-phases/defaults?type=cut&targetRatePctPerWeek=1')
    ).json();
    expect(faster.calories.value).not.toBe(created.calorieTargetKcal);
    const res = await send('PATCH', `/api/goal-phases/${created.id}`, {
      targetRatePctPerWeek: 1,
      calorieTargetKcal: created.calorieTargetKcal,
      calorieBasis: 'provisional_formula',
    });
    expect(res.status).toBe(200);
    expect(await openPhase(send)).toMatchObject({
      targetRatePctPerWeek: 1,
      calorieTargetKcal: faster.calories.value,
      calorieBasis: 'provisional_formula',
    });
  });

  it('replaces a figure worked out before the weekdays changed', async () => {
    const { send } = await member('stale-formula@example.test');
    await aboutYou(send);
    const created = await (await send('POST', '/api/goal-phases', provisionalCut())).json();
    const stale: { calories: { value: number } } = await (
      await send('GET', '/api/goal-phases/defaults?type=cut&targetRatePctPerWeek=1')
    ).json();
    expect((await weekdays(send, [1, 2, 3, 4, 5, 6])).status).toBe(200);
    const res = await send('PATCH', `/api/goal-phases/${created.id}`, {
      targetRatePctPerWeek: 1,
      calorieTargetKcal: stale.calories.value,
      calorieBasis: 'provisional_formula',
    });
    expect(res.status).toBe(200);
    const current: { calories: { value: number } } = await (
      await send('GET', '/api/goal-phases/defaults?type=cut&targetRatePctPerWeek=1')
    ).json();
    expect(current.calories.value).not.toBe(stale.calories.value);
    expect((await openPhase(send))?.calorieTargetKcal).toBe(current.calories.value);
  });

  it('keeps a figure the user set', async () => {
    const { send } = await member('manual-formula@example.test');
    await aboutYou(send);
    const created = await (await send('POST', '/api/goal-phases', provisionalCut())).json();
    const res = await send('PATCH', `/api/goal-phases/${created.id}`, {
      targetRatePctPerWeek: 1,
      calorieTargetKcal: 2100,
      calorieBasis: 'manual',
    });
    expect(res.status).toBe(200);
    expect(await openPhase(send)).toMatchObject({
      targetRatePctPerWeek: 1,
      calorieTargetKcal: 2100,
      calorieBasis: 'manual',
    });
  });

  it('holds the formula’s figure to the calorie range when a small member drops to one training day', async () => {
    const { send } = await member('small-formula@example.test');
    expect(
      (
        await send('PATCH', '/api/me/profile', {
          timezone: 'Asia/Tokyo',
          heightCm: 150,
          sex: 'female',
          birthDate: '1950-01-01',
          trainingWeekdays: [1, 2, 4, 5],
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await send('POST', '/api/weigh-ins', {
          id: randomUUID(),
          measuredAt: new Date(Date.now() - 60_000).toISOString(),
          weightKg: 45,
        })
      ).status,
    ).toBe(201);
    const created = await (
      await send('POST', '/api/goal-phases', provisionalCut({ targetRatePctPerWeek: 0.75 }))
    ).json();
    expect(created.calorieTargetKcal).toBeGreaterThanOrEqual(1000);
    expect((await weekdays(send, [1])).status).toBe(200);
    const defaults: { calories: { value: number; restingKcal: number; adjustmentKcal: number } } =
      await (
        await send('GET', '/api/goal-phases/defaults?type=cut&targetRatePctPerWeek=0.75')
      ).json();
    // Unbounded, one training day would give under 1,000 kcal.
    expect(defaults.calories.restingKcal * 1.5 + defaults.calories.adjustmentKcal).toBeLessThan(
      995,
    );
    expect(defaults.calories.value).toBe(1000);
    expect(await openPhase(send)).toMatchObject({
      calorieTargetKcal: 1000,
      calorieBasis: 'provisional_formula',
    });
    const patched = await send('PATCH', `/api/goal-phases/${created.id}`, {
      targetRatePctPerWeek: 1,
      calorieTargetKcal: 1000,
      calorieBasis: 'provisional_formula',
    });
    expect(patched.status).toBe(200);
    expect((await patched.json()).calorieTargetKcal).toBe(1000);
  });
});

describe('day routines', () => {
  it('replaces a day type’s routine and its meals', async () => {
    const { send } = await member('routine@example.test');
    const put = await send('PUT', '/api/day-routines/training', routine('training'));
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({
      dayType: 'training',
      mealCount: 5,
      trainingTime: '18:30',
    });
    const shorter = { ...routine('training'), slots: routine('training').slots.slice(0, 4) };
    await send('PUT', '/api/day-routines/training', shorter);
    const { items } = await (await send('GET', '/api/day-routines')).json();
    expect(items).toHaveLength(1);
    expect(items[0].slots.map((slot: { time: string }) => slot.time)).toEqual([
      '07:00',
      '11:45',
      '16:30',
      '19:45',
    ]);
  });

  it('refuses a training day without a training time, and a rest day with one', async () => {
    const { send } = await member('routine422@example.test');
    expect(
      (
        await send('PUT', '/api/day-routines/training', {
          ...routine('training'),
          trainingTime: null,
        })
      ).status,
    ).toBe(422);
    expect(
      (await send('PUT', '/api/day-routines/rest', { ...routine('rest'), trainingTime: '18:00' }))
        .status,
    ).toBe(422);
  });

  it('keeps one user’s routines from another', async () => {
    const a = await member('routine-a@example.test');
    const b = await member('routine-b@example.test');
    await a.send('PUT', '/api/day-routines/rest', routine('rest'));
    expect((await (await b.send('GET', '/api/day-routines')).json()).items).toEqual([]);
    await b.send('PUT', '/api/day-routines/rest', {
      ...routine('rest'),
      slots: [{ time: '12:00', label: null }],
    });
    const { items } = await (await a.send('GET', '/api/day-routines')).json();
    expect(items[0].slots).toHaveLength(4);
  });

  it('recommends the count and times, with protein per meal, once a phase is set', async () => {
    const { send } = await member('recommend@example.test');
    const query = '?wakeTime=06:30&bedTime=23:00&trainingTime=18:30';
    expect((await send('GET', `/api/day-routines/training/recommendation${query}`)).status).toBe(
      422,
    );
    await aboutYou(send);
    await send('POST', '/api/goal-phases', cut());
    const res = await send('GET', `/api/day-routines/training/recommendation${query}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      recommendedCount: 5,
      mealCount: 5,
      perMeal: 'inside',
      perMealRange: [0.4, 0.55],
      sourceKey: 'protein_per_meal',
    });
    const four = await (
      await send('GET', `/api/day-routines/training/recommendation${query}&mealCount=4`)
    ).json();
    expect(four).toMatchObject({ recommendedCount: 5, mealCount: 4 });
  });
});

describe('GET /api/targets/current', () => {
  it('reads the open phase at the trend weight, labelled provisional', async () => {
    const { send } = await member('targets@example.test');
    expect((await send('GET', '/api/targets/current')).status).toBe(422);
    await aboutYou(send);
    await send('POST', '/api/goal-phases', provisionalCut());
    const body = await (await send('GET', '/api/targets/current')).json();
    expect(body).toMatchObject({
      date: today(),
      energyKcal: await formula(send),
      proteinG: 181.3,
      bodyweightKg: 82.4,
      source: { kind: 'provisional_formula' },
    });
  });
});

describe('plan days', () => {
  it('names the missing setup steps in order', async () => {
    const { send } = await member('missing@example.test');
    const res = await send('POST', '/api/plan-days/generate', { from: today(), to: today() });
    expect(res.status).toBe(422);
    expect((await res.json()).missing).toEqual(['profile', 'foods', 'goal_phase', 'day_routine']);
    await aboutYou(send);
    await addFoods(send);
    await send('POST', '/api/goal-phases', cut());
    await send('PUT', '/api/day-routines/training', routine('training'));
    // Rest days happen in this week too.
    const still = await send('POST', '/api/plan-days/generate', { from: today(), to: today() });
    expect((await still.json()).missing).toEqual(['day_routine']);
  });

  it('generates a week within tolerance, rounded, with carbohydrate around training tagged', async () => {
    const { send } = await setUp('week@example.test');
    const { missing, days } = await generate(send);
    expect(missing).toEqual([]);
    expect(days).toHaveLength(7);
    for (const day of days) {
      expect(Math.abs(day.planned.energyKcal - day.targets.energyKcal)).toBeLessThanOrEqual(
        day.targets.energyKcal * 0.05,
      );
      expect(Math.abs(day.planned.proteinG - day.targets.proteinG)).toBeLessThanOrEqual(5);
      expect(day.shortfalls).toEqual([]);
      expect(day.complete).toBe(false);
      const planned = day.meals.flatMap((meal) => meal.items);
      expect(
        planned.filter((item) =>
          item.pieceCount === null
            ? item.plannedGrams % 5 !== 0
            : !Number.isInteger(item.pieceCount),
        ),
      ).toEqual([]);
    }
    const training = days.find((day) => day.dayType === 'training');
    const tagged = training?.meals
      .filter((meal) => meal.evidence.length > 0)
      .map((meal) => meal.label);
    expect(tagged).toEqual(['Before training', 'After training']);
    // Chicken is batch-cooked, but entered by hand: the food table has no cooked counterpart for it,
    // so it is planned raw by its own values and says so, never raw values labelled cooked.
    const chicken = days
      .flatMap((day) => day.meals.flatMap((meal) => meal.items))
      .find((item) => item.name === 'Chicken breast');
    expect(chicken).toMatchObject({
      cooked: false,
      approximate: false,
      noCookedMatch: true,
      per100g: { energyKcal: 105, proteinG: 23.3 },
    });
  });

  it('plans a batch-cooked food by its MEXT cooked counterpart, else raw with the note', async () => {
    const { send, user } = await member('cooked-match@example.test');
    const thigh = randomUUID();
    const manual = randomUUID();
    for (const each of [
      {
        id: thigh,
        name: 'Chicken thigh',
        source: 'mext',
        sourceRef: '11221',
        state: 'raw',
        keepsDays: 3,
        ...per100(190, 16.6, 0, 14.2),
      },
      {
        id: manual,
        name: 'Home-made patty',
        source: 'manual',
        state: 'raw',
        keepsDays: 3,
        ...per100(220, 18, 2, 15),
      },
    ]) {
      expect((await send('POST', '/api/foods', each)).status).toBe(201);
    }
    const foods = await planFoods(t.db, user.id);
    // 皮つき 生 → 皮つき ゆで, the first of MEXT's cooked counterparts tried.
    expect(foods.find((each) => each.id === thigh)).toMatchObject({
      cooked: true,
      approximate: true,
      noCookedMatch: false,
      per100g: { energyKcal: 216, proteinG: 22, fatG: 15.2 },
    });
    expect(foods.find((each) => each.id === manual)).toMatchObject({
      cooked: false,
      approximate: false,
      noCookedMatch: true,
      per100g: { energyKcal: 220, proteinG: 18, fatG: 15 },
    });
  });

  it('lists dates with no plan as missing, and reads without writing', async () => {
    const { send } = await setUp('read@example.test');
    const res = await send('GET', `/api/plan-days?from=${today()}&to=${addDays(today(), 2)}`);
    const body: Days = await res.json();
    expect(body).toEqual({
      missing: [today(), addDays(today(), 1), addDays(today(), 2)],
      days: [],
    });
  });

  it('never makes a day with a confirmed meal again, nor a past day', async () => {
    const { send, user } = await setUp('confirmed@example.test');
    const yesterday = addDays(today(), -1);
    const first = await generate(send, yesterday, addDays(today(), 1));
    const [past, now, next] = first.days;
    const meal = now?.meals[0];
    if (meal === undefined || past === undefined || next === undefined) throw new Error('no plan');
    await t.db
      .update(planMeal)
      .set({ status: 'as_planned', confirmedAt: new Date() })
      .where(eq(planMeal.id, meal.id));

    // A changed phase changes what an unconfirmed day aims for.
    const { items }: { items: Phase[] } = await (await send('GET', '/api/goal-phases')).json();
    await send('PATCH', `/api/goal-phases/${items[0]?.id}`, {
      calorieTargetKcal: 2000,
      calorieBasis: 'manual',
    });
    const second = await generate(send, yesterday, addDays(today(), 1));
    const byDate = new Map(second.days.map((day) => [day.date, day]));
    expect(byDate.get(yesterday)?.id).toBe(past.id);
    expect(byDate.get(today())?.id).toBe(now?.id);
    expect(byDate.get(today())?.targets.energyKcal).toBe(2350);
    expect(byDate.get(addDays(today(), 1))?.id).not.toBe(next.id);
    expect(byDate.get(addDays(today(), 1))?.targets.energyKcal).toBe(2000);
    const rows = await t.db
      .select({ id: planDay.id })
      .from(planDay)
      .where(and(eq(planDay.userId, user.id), inArray(planDay.planDate, [yesterday, today()])));
    expect(rows).toHaveLength(2);
  });

  it('names a protein shortfall and keeps it with the day', async () => {
    const { send } = await setUp('short@example.test', 'weak');
    const { days } = await generate(send, today(), today());
    const [day] = days;
    expect(day?.shortfalls[0]).toMatchObject({
      target: 'protein',
      suggestion: 'add_protein_source',
    });
    expect(day?.shortfalls[0]?.missingG).toBe(
      Math.round((day?.targets.proteinG ?? 0) - (day?.planned.proteinG ?? 0)),
    );
    const read: Days = await (
      await send('GET', `/api/plan-days?from=${today()}&to=${today()}`)
    ).json();
    expect(read.days[0]?.shortfalls).toEqual(day?.shortfalls);
  });

  it('refuses a range out of order or longer than 31 days', async () => {
    const { send } = await setUp('range@example.test');
    expect(
      (await send('GET', `/api/plan-days?from=${addDays(today(), 1)}&to=${today()}`)).status,
    ).toBe(400);
    expect(
      (await send('GET', `/api/plan-days?from=${today()}&to=${addDays(today(), 31)}`)).status,
    ).toBe(400);
    expect((await send('GET', '/api/plan-days?from=nope&to=nope')).status).toBe(400);
    expect(
      (await send('POST', '/api/plan-days/generate', { from: today(), to: addDays(today(), 31) }))
        .status,
    ).toBe(422);
  });

  it('keeps one user’s plan from another', async () => {
    const a = await setUp('plan-a@example.test');
    const b = await setUp('plan-b@example.test', 'weak');
    const mine = await generate(a.send, today(), today());
    await generate(b.send, today(), today());
    const theirs: Days = await (
      await b.send('GET', `/api/plan-days?from=${today()}&to=${today()}`)
    ).json();
    expect(theirs.days.map((day) => day.id)).not.toContain(mine.days[0]?.id);
    const again: Days = await (
      await a.send('GET', `/api/plan-days?from=${today()}&to=${today()}`)
    ).json();
    expect(again.days[0]?.id).toBe(mine.days[0]?.id);
    expect(again.days[0]?.shortfalls).toEqual([]);
  });
});
