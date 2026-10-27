import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { localDateIn } from '../src/db/training';
import { sender } from './account-fixture';
import { useTestApp } from './harness';

// S18a's route (docs/07 §5, issue #82): each status from seeded plan days and weigh-ins, that the
// check never changes the phase, applying it by hand through the phase's PATCH, and the cross-user
// cases (docs/08 §10). Days older than the 7-day confirm lock are marked complete in the database.
const t = useTestApp();

type Send = ReturnType<typeof sender>;
type Day = { date: string; complete: boolean; confirmed: { energyKcal: number } };
type Check = {
  status: string;
  from: string | null;
  to: string | null;
  completeDaysTotal: number;
  remaining: number;
  completeDaysInWindow: number | null;
  recentCompleteDays: number | null;
  lowRecentLogging: boolean | null;
  weighInsInWindow: number | null;
  lastWeighedOn: string | null;
  meanIntakeKcal: number | null;
  trendChangeKgPerWeek: number | null;
  maintenanceKcal: number | null;
  apply: { goalPhaseId: string; adjustmentKcal: number; calorieTargetKcal: number } | null;
  method: string;
};
type Phase = { id: string; calorieTargetKcal: number; calorieBasis: string };

const today = () => localDateIn('Asia/Tokyo')(new Date());
const daysAgo = (days: number) =>
  new Date(Date.parse(`${today()}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

async function ok(res: Response, status = 200) {
  expect(res.status).toBe(status);
  return res;
}

const per100 = (energyKcal: number, proteinG: number, carbG: number, fatG: number) => ({
  basis: { kind: 'per_100g', grams: 100 },
  energyKcal,
  proteinG,
  carbG,
  fatG,
  fiberG: 0,
});

/** A typed weigh-in at 07:00 Tokyo, `ago` days back. */
const weighIn = async (send: Send, ago: number, weightKg: number) =>
  ok(
    await send('POST', '/api/weigh-ins', {
      id: randomUUID(),
      measuredAt: new Date(`${daysAgo(ago)}T07:00:00+09:00`).toISOString(),
      weightKg,
    }),
    201,
  );

/** A member on a cut with a plan for the last 21 days and today, every day a rest day. */
async function member(email: string) {
  const { user, cookie } = await t.createSignedInUser(email);
  const send = sender(t, cookie);
  await ok(
    await send('PATCH', '/api/me/profile', {
      timezone: 'Asia/Tokyo',
      heightCm: 176,
      sex: 'male',
      birthDate: '1995-03-08',
      trainingWeekdays: [],
    }),
  );
  await weighIn(send, 25, 83);
  for (const [name, values] of [
    ['Chicken breast', per100(140, 31.1, 0, 2)],
    ['Rice, cooked', per100(156, 2.5, 37.1, 0.3)],
    ['Olive oil', per100(894, 0, 0, 100)],
  ] as const) {
    await ok(
      await send('POST', '/api/foods', {
        id: randomUUID(),
        source: 'manual',
        name,
        state: 'cooked',
        ...values,
      }),
      201,
    );
  }
  const phaseId = randomUUID();
  await ok(
    await send('POST', '/api/goal-phases', {
      id: phaseId,
      type: 'cut',
      startedOn: daysAgo(30),
      targetRatePctPerWeek: 0.5,
      proteinGPerKg: 2.2,
      fatPctCalories: 25,
      calorieTargetKcal: 2350,
      calorieBasis: 'manual',
    }),
    201,
  );
  await ok(
    await send('PUT', '/api/day-routines/rest', {
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
    }),
  );
  await ok(await send('POST', '/api/plan-days/generate', { from: daysAgo(21), to: today() }));
  return { user, send, phaseId };
}

/** Every meal on the days `agos` days back confirmed as planned, past the 7-day lock or not. */
async function complete(userId: string, agos: number[]) {
  const dates = agos.map(daysAgo);
  await t.db.execute(sql`
    UPDATE plan_meal SET status = 'as_planned', confirmed_at = now()
    WHERE plan_day_id IN (
      SELECT id FROM plan_day WHERE user_id = ${userId} AND plan_date IN (${sql.join(
        dates.map((date) => sql`${date}::date`),
        sql`, `,
      )})
    )`);
}

const range = (from: number, to: number) =>
  Array.from({ length: from - to + 1 }, (_, index) => from - index);

const check = async (send: Send): Promise<Check> =>
  (await ok(await send('GET', '/api/maintenance-check'))).json();

const openPhase = async (send: Send): Promise<Phase> => {
  const { items }: { items: (Phase & { endedOn: string | null })[] } = await (
    await ok(await send('GET', '/api/goal-phases'))
  ).json();
  const open = items.find((each) => each.endedOn === null);
  if (open === undefined) throw new Error('no open phase');
  return open;
};

describe('GET /api/maintenance-check', () => {
  it('collects until 14 complete days, saying how many remain', async () => {
    const { user, send } = await member('mc-collect@example.test');
    await complete(user.id, range(12, 0));
    expect(await check(send)).toEqual({
      status: 'collecting',
      from: null,
      to: null,
      completeDaysTotal: 13,
      remaining: 1,
      completeDaysInWindow: null,
      recentCompleteDays: null,
      lowRecentLogging: null,
      weighInsInWindow: null,
      lastWeighedOn: null,
      meanIntakeKcal: null,
      trendChangeKgPerWeek: null,
      maintenanceKcal: null,
      apply: null,
      method: 'weight_trend_balance_v1',
    });
  });

  it('is ready with 14 complete days and 3 weigh-ins, from confirmed intake, and changes nothing', async () => {
    const { user, send, phaseId } = await member('mc-ready@example.test');
    await complete(user.id, range(13, 0));
    for (const [ago, kg] of [
      [16, 82.9],
      [12, 82.7],
      [8, 82.6],
      [4, 82.4],
      [1, 82.3],
    ] as const) {
      await weighIn(send, ago, kg);
    }
    const before = await openPhase(send);
    const result = await check(send);
    const { days }: { days: Day[] } = await (
      await ok(await send('GET', `/api/plan-days?from=${daysAgo(13)}&to=${today()}`))
    ).json();
    const eaten = days.filter((day) => day.complete).map((day) => day.confirmed.energyKcal);
    expect(eaten).toHaveLength(14);
    expect(result).toMatchObject({
      status: 'ready',
      from: daysAgo(13),
      to: today(),
      completeDaysTotal: 14,
      remaining: 0,
      completeDaysInWindow: 14,
      recentCompleteDays: 7,
      lowRecentLogging: false,
      weighInsInWindow: 4,
      lastWeighedOn: daysAgo(1),
      meanIntakeKcal: Math.round(eaten.reduce((sum, kcal) => sum + kcal, 0) / eaten.length),
      method: 'weight_trend_balance_v1',
    });
    expect(result.trendChangeKgPerWeek).toBeLessThan(0);
    expect(result.maintenanceKcal).toBeGreaterThan(result.meanIntakeKcal ?? 0);
    expect(result.apply?.goalPhaseId).toBe(phaseId);
    expect(result.apply?.calorieTargetKcal).toBe(
      (result.maintenanceKcal ?? 0) + (result.apply?.adjustmentKcal ?? 0),
    );
    expect(result.apply?.adjustmentKcal).toBeLessThan(0);
    // Reading it twice never touches the phase's targets.
    await check(send);
    expect(await openPhase(send)).toEqual(before);
  });

  it('labels too little recent logging below 5 of the newest 7 days', async () => {
    const { user, send } = await member('mc-low@example.test');
    await complete(user.id, [...range(20, 7), 5, 2, 0]);
    for (const ago of [12, 6, 3, 1]) await weighIn(send, ago, 82.5);
    expect(await check(send)).toMatchObject({
      status: 'ready',
      completeDaysTotal: 17,
      completeDaysInWindow: 10,
      recentCompleteDays: 3,
      lowRecentLogging: true,
    });
  });

  it('needs a weigh-in with fewer than 3 in the window, and gives no figures', async () => {
    const { user, send } = await member('mc-weigh@example.test');
    await complete(user.id, range(13, 0));
    await weighIn(send, 9, 82.6);
    await weighIn(send, 2, 82.4);
    expect(await check(send)).toMatchObject({
      status: 'needs_weigh_in',
      completeDaysInWindow: 14,
      weighInsInWindow: 2,
      lastWeighedOn: daysAgo(2),
      lowRecentLogging: false,
      meanIntakeKcal: null,
      maintenanceKcal: null,
      apply: null,
    });
  });

  it('needs logging when no day in the window is complete', async () => {
    const { user, send } = await member('mc-logging@example.test');
    await ok(await send('POST', '/api/plan-days/generate', { from: daysAgo(40), to: daysAgo(22) }));
    await complete(user.id, range(35, 14));
    expect(await check(send)).toMatchObject({
      status: 'needs_logging',
      completeDaysTotal: 22,
      completeDaysInWindow: 0,
      recentCompleteDays: 0,
      lowRecentLogging: true,
      meanIntakeKcal: null,
    });
  });

  it('counts none of another user’s days or weigh-ins', async () => {
    const a = await member('mc-cross-a@example.test');
    await complete(a.user.id, range(13, 0));
    for (const ago of [12, 6, 1]) await weighIn(a.send, ago, 82.5);
    const { cookie } = await t.createSignedInUser('mc-cross-b@example.test');
    const b = sender(t, cookie);
    expect(await check(b)).toMatchObject({
      status: 'collecting',
      completeDaysTotal: 0,
      remaining: 14,
    });
    expect((await check(a.send)).status).toBe('ready');
  });

  it('answers 401 without a session', async () => {
    expect((await t.app.request('/api/maintenance-check')).status).toBe(401);
  });
});

describe('applying the check by hand', () => {
  it('sets the phase’s calories as measured through its PATCH', async () => {
    const { user, send, phaseId } = await member('mc-apply@example.test');
    await complete(user.id, range(13, 0));
    for (const ago of [16, 10, 5, 1]) await weighIn(send, ago, 82.5);
    const { apply } = await check(send);
    if (apply === null) throw new Error('not ready');
    const patched: Phase = await (
      await ok(
        await send('PATCH', `/api/goal-phases/${phaseId}`, {
          calorieTargetKcal: apply.calorieTargetKcal,
          calorieBasis: 'measured',
        }),
      )
    ).json();
    expect(patched).toMatchObject({
      calorieTargetKcal: apply.calorieTargetKcal,
      calorieBasis: 'measured',
    });
    expect(await openPhase(send)).toMatchObject({ calorieBasis: 'measured' });
  });

  it('cannot apply to another user’s phase', async () => {
    const a = await member('mc-apply-a@example.test');
    const { cookie } = await t.createSignedInUser('mc-apply-b@example.test');
    const b = sender(t, cookie);
    await ok(
      await b('PATCH', `/api/goal-phases/${a.phaseId}`, {
        calorieTargetKcal: 2000,
        calorieBasis: 'measured',
      }),
      404,
    );
    expect(await openPhase(a.send)).toMatchObject({
      calorieTargetKcal: 2350,
      calorieBasis: 'manual',
    });
  });
});
