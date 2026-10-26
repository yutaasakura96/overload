import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { localDateIn } from '../src/db/training';
import { planFoods } from '../src/db/plans';
import { sender } from './account-fixture';
import { useTestApp } from './harness';

// S13 and S17's routes (docs/07 §4, issue #81): recording a batch and its repeat, the yield plans
// made later use while earlier ones keep their snapshot, the week's prep plan with its second cook
// day and grocery sum, and every route's cross-user case (docs/08 §10).
const t = useTestApp();

type Send = ReturnType<typeof sender>;
type Item = {
  foodId: string | null;
  plannedGrams: number;
  cooked: boolean;
  approximate: boolean;
  noCookedMatch: boolean;
  batchId: string | null;
  yieldRatio: number | null;
  per100g: { energyKcal: number; proteinG: number };
};
type Day = { date: string; meals: { items: Item[] }[] };
type Cook = {
  foodId: string;
  rawGrams: number | null;
  cookedGrams: number | null;
  approximate: boolean;
  dates: string[];
};
type Prep = {
  weekStart: string;
  missing: string[];
  generatedAt: string | null;
  cookDays: {
    date: string;
    which: string;
    covers: string[];
    because: { foodId: string; keepsDays: number } | null;
    cooks: Cook[];
  }[];
  foods: { foodId: string; keepsDays: number; batch: { id: string } | null; weighDue: boolean }[];
  uncovered: { foodId: string; dates: string[] }[];
  grocery: {
    foodId: string;
    section: string;
    unit: string;
    quantity: number | null;
    cooks: (number | null)[];
  }[];
};

const today = () => localDateIn('Asia/Tokyo')(new Date());
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
/** The Monday after today: the week the prep screen shows. */
const nextMonday = () => {
  const date = today();
  const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(date, 7 - weekday);
};

async function member(email: string) {
  const { cookie, user } = await t.createSignedInUser(email);
  return { user, send: sender(t, cookie) };
}

const per100 = (energyKcal: number, proteinG: number, carbG: number, fatG: number, fiberG = 0) => ({
  basis: { kind: 'per_100g', grams: 100 },
  energyKcal,
  proteinG,
  carbG,
  fatG,
  fiberG,
});

async function addFood(send: Send, food: Record<string, unknown>) {
  const id = randomUUID();
  const res = await send('POST', '/api/foods', { id, source: 'manual', ...food });
  expect(res.status).toBe(201);
  return id;
}

/** A member with a plan to make: about them, a short food list with chicken batch-cooked, a cut. */
async function setUp(email: string) {
  const who = await member(email);
  expect(
    (
      await who.send('PATCH', '/api/me/profile', {
        timezone: 'Asia/Tokyo',
        heightCm: 176,
        sex: 'male',
        birthDate: '1995-03-08',
        trainingWeekdays: [],
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await who.send('POST', '/api/weigh-ins', {
        id: randomUUID(),
        measuredAt: new Date(Date.now() - 60_000).toISOString(),
        weightKg: 82.4,
      })
    ).status,
  ).toBe(201);
  const chicken = await addFood(who.send, {
    name: 'Chicken breast',
    state: 'raw',
    keepsDays: 4,
    ...per100(105, 23.3, 0.1, 1.9),
  });
  const oats = await addFood(who.send, {
    name: 'Rolled oats',
    state: 'raw',
    ...per100(350, 13.7, 69.1, 5.7, 9.4),
  });
  await addFood(who.send, { name: 'Olive oil', state: 'raw', ...per100(894, 0, 0, 100) });
  expect(
    (
      await who.send('POST', '/api/goal-phases', {
        id: randomUUID(),
        type: 'cut',
        startedOn: today(),
        targetRatePctPerWeek: 0.5,
        proteinGPerKg: 2.2,
        fatPctCalories: 25,
        calorieTargetKcal: 2350,
        calorieBasis: 'manual',
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await who.send('PUT', '/api/day-routines/rest', {
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
      })
    ).status,
  ).toBe(200);
  return { ...who, chicken, oats };
}

async function generate(send: Send, from: string, to: string) {
  const res = await send('POST', '/api/plan-days/generate', { from, to });
  expect(res.status).toBe(200);
  const body: { missing: string[]; days: Day[] } = await res.json();
  return body.days;
}

async function readDays(send: Send, from: string, to: string) {
  const res = await send('GET', `/api/plan-days?from=${from}&to=${to}`);
  expect(res.status).toBe(200);
  const body: { days: Day[] } = await res.json();
  return body.days;
}

const itemsOf = (days: Day[], foodId: string) =>
  days.flatMap((day) => day.meals.flatMap((meal) => meal.items)).filter((i) => i.foodId === foodId);

const batch = (foodId: string, overrides: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  foodId,
  rawWeightG: 1400,
  cookedWeightG: 1050,
  cookedOn: today(),
  note: null,
  ...overrides,
});

/** Raw grams to cook are rounded to 5 g. */
const toStep = (grams: number) => Math.round(grams / 5) * 5;

async function prepFor(send: Send, weekStart = nextMonday()) {
  const res = await send('GET', `/api/prep-plan?weekStart=${weekStart}`);
  expect(res.status).toBe(200);
  const body: Prep = await res.json();
  return body;
}

describe('batches', () => {
  it('records a batch with its yield, and a repeat of the same batch returns it', async () => {
    const { send, chicken } = await setUp('batch@example.test');
    const body = batch(chicken);
    const first = await send('POST', '/api/batches', body);
    expect(first.status).toBe(201);
    expect(await first.json()).toEqual({ ...body, yield: 0.75 });
    const again = await send('POST', '/api/batches', body);
    expect(again.status).toBe(200);
    const changed = await send('POST', '/api/batches', { ...body, cookedWeightG: 1000 });
    expect(changed.status).toBe(409);
    expect((await changed.json()).code).toBe('id_conflict');
  });

  it('lists batches newest cook day first, all of them or one food’s', async () => {
    const { send, chicken, oats } = await setUp('batch-list@example.test');
    const older = batch(chicken, { cookedOn: addDays(today(), -10) });
    const newer = batch(chicken, { cookedWeightG: 1078 });
    const oatBatch = batch(oats, { rawWeightG: 100, cookedWeightG: 250 });
    for (const each of [older, newer, oatBatch]) {
      expect((await send('POST', '/api/batches', each)).status).toBe(201);
    }
    const all: { items: { id: string }[] } = await (await send('GET', '/api/batches')).json();
    expect(all.items.map((each) => each.id).slice(-1)).toEqual([older.id]);
    expect(all.items).toHaveLength(3);
    const one = await send('GET', `/api/foods/${chicken}/batches`);
    expect(one.status).toBe(200);
    const body: { items: { id: string; yield: number }[] } = await one.json();
    expect(body.items.map((each) => each.id)).toEqual([newer.id, older.id]);
    expect(body.items[0]?.yield).toBe(0.77);
  });

  it('refuses a weight of 0, a yield past a tenth or ten times, and a food not on the list', async () => {
    const { send, chicken } = await setUp('batch-refused@example.test');
    const zero = await send('POST', '/api/batches', batch(chicken, { cookedWeightG: 0 }));
    expect(zero.status).toBe(422);
    const tiny = await send('POST', '/api/batches', batch(chicken, { cookedWeightG: 100 }));
    expect(tiny.status).toBe(422);
    expect((await tiny.json()).errors).toEqual([
      { path: 'cookedWeightG', message: 'Between a tenth of the raw weight and ten times it' },
    ]);
    // Rice takes up water: cooked above raw is accepted.
    const gains = await send('POST', '/api/batches', batch(chicken, { cookedWeightG: 3500 }));
    expect(gains.status).toBe(201);
    const unknown = await send('POST', '/api/batches', batch(randomUUID()));
    expect(unknown.status).toBe(422);
    expect((await unknown.json()).errors).toEqual([
      { path: 'foodId', message: 'Not a food on your list' },
    ]);
  });

  it('refuses a cook date after the member’s local today', async () => {
    const { send, chicken } = await setUp('batch-future@example.test');
    const res = await send(
      'POST',
      '/api/batches',
      batch(chicken, { cookedOn: addDays(today(), 1) }),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).errors).toEqual([{ path: 'cookedOn', message: 'A day up to today' }]);
  });

  it('refuses a batch for a food whose values are cooked', async () => {
    const { send, user } = await setUp('batch-cooked-food@example.test');
    const cooked = await addFood(send, {
      name: 'Cooked rice',
      state: 'cooked',
      keepsDays: 3,
      ...per100(156, 2.5, 37.1, 0.3),
    });
    const res = await send('POST', '/api/batches', batch(cooked));
    expect(res.status).toBe(422);
    expect((await res.json()).errors).toEqual([
      { path: 'foodId', message: 'Batches need a food with raw values' },
    ]);
    expect((await planFoods(t.db, user.id)).find((food) => food.id === cooked)).toMatchObject({
      cooked: true,
      keepsDays: null,
      batchId: null,
      yieldRatio: null,
      per100g: { energyKcal: 156 },
    });
  });

  it('keeps the saved batch yield in prep after a newer batch is recorded', async () => {
    const { send, chicken } = await setUp('prep-saved-yield@example.test');
    const first = batch(chicken, { cookedOn: addDays(today(), -1) });
    expect((await send('POST', '/api/batches', first)).status).toBe(201);
    const weekStart = nextMonday();
    const days = await generate(send, weekStart, addDays(weekStart, 6));
    const cooked = itemsOf(days, chicken).reduce((sum, item) => sum + item.plannedGrams, 0);
    expect(cooked).toBeGreaterThan(0);
    expect(itemsOf(days, chicken).every((item) => item.batchId === first.id)).toBe(true);
    const newer = batch(chicken, { cookedWeightG: 700 });
    expect((await send('POST', '/api/batches', newer)).status).toBe(201);
    const prep = await prepFor(send, weekStart);
    const cooks = prep.cookDays
      .flatMap((day) => day.cooks)
      .filter((cook) => cook.foodId === chicken);
    expect(cooks.reduce((sum, cook) => sum + (cook.cookedGrams ?? 0), 0)).toBe(cooked);
    expect(prep.grocery.find((item) => item.foodId === chicken)?.quantity).toBe(
      cooks.reduce((sum, cook) => sum + (cook.rawGrams ?? 0), 0),
    );
    expect(cooks.every((cook) => cook.rawGrams === toStep((cook.cookedGrams ?? 0) / 0.75))).toBe(
      true,
    );
    expect((await send('DELETE', `/api/batches/${first.id}`)).status).toBe(204);
    const kept = itemsOf(await readDays(send, weekStart, addDays(weekStart, 6)), chicken);
    expect(kept.every((item) => item.batchId === null && item.yieldRatio === 0.75)).toBe(true);
    const afterDelete = await prepFor(send, weekStart);
    expect(afterDelete.cookDays.map((day) => day.cooks)).toEqual(
      prep.cookDays.map((day) => day.cooks),
    );
    expect(afterDelete.grocery).toEqual(prep.grocery);
  });

  it('gives plans made later the new yield, while days already made keep their snapshot', async () => {
    const { send, chicken } = await setUp('batch-yield@example.test');
    const from = today();
    const to = addDays(from, 2);
    // Without a batch, a manual food with no MEXT counterpart is planned raw, and says so.
    const before = itemsOf(await generate(send, from, to), chicken);
    expect(before.length).toBeGreaterThan(0);
    for (const item of before) {
      expect(item).toMatchObject({
        cooked: false,
        noCookedMatch: true,
        batchId: null,
        yieldRatio: null,
      });
      expect(item.per100g.energyKcal).toBe(105);
    }

    const recorded = batch(chicken);
    expect((await send('POST', '/api/batches', recorded)).status).toBe(201);
    // The days already made are not touched by recording a batch.
    expect(itemsOf(await readDays(send, from, to), chicken)).toEqual(before);

    const after = itemsOf(await generate(send, from, to), chicken);
    expect(after.length).toBeGreaterThan(0);
    for (const item of after) {
      expect(item).toMatchObject({
        cooked: true,
        approximate: false,
        noCookedMatch: false,
        batchId: recorded.id,
        yieldRatio: 0.75,
      });
      // 105 kcal raw at a yield of 0.75: 140 kcal per 100 g cooked.
      expect(item.per100g.energyKcal).toBe(140);
      expect(item.per100g.proteinG).toBe(31.07);
    }

    // Deleting the batch leaves the values the days were planned with.
    expect((await send('DELETE', `/api/batches/${recorded.id}`)).status).toBe(204);
    const kept = itemsOf(await readDays(send, from, to), chicken);
    expect(kept.map((item) => [item.batchId, item.yieldRatio, item.per100g.energyKcal])).toEqual(
      after.map(() => [null, 0.75, 140]),
    );
  });
});

describe('the prep plan', () => {
  it('refuses a week that does not start on a Monday', async () => {
    const { send } = await member('prep-monday@example.test');
    const res = await send('GET', `/api/prep-plan?weekStart=${addDays(nextMonday(), 1)}`);
    expect(res.status).toBe(422);
    expect((await res.json()).errors).toEqual([{ path: 'weekStart', message: 'Not a Monday' }]);
  });

  it('names the days not yet planned', async () => {
    const { send } = await setUp('prep-missing@example.test');
    const prep = await prepFor(send);
    expect(prep.missing).toHaveLength(7);
    expect(prep.generatedAt).toBeNull();
    expect(prep.grocery).toEqual([]);
  });

  it('splits chicken, which keeps 4 days, into two cooks, and the grocery list sums both', async () => {
    const { send, chicken, oats } = await setUp('prep@example.test');
    const weekStart = nextMonday();
    const recorded = batch(chicken, { cookedOn: addDays(today(), -10) });
    expect((await send('POST', '/api/batches', recorded)).status).toBe(201);
    const days = await generate(send, weekStart, addDays(weekStart, 6));
    const prep = await prepFor(send, weekStart);

    expect(prep.missing).toEqual([]);
    expect(prep.cookDays.map((day) => [day.date, day.which])).toEqual([
      [addDays(weekStart, -1), 'first'],
      [addDays(weekStart, 3), 'second'],
    ]);
    const [first, second] = prep.cookDays;
    expect(first?.covers).toEqual([0, 1, 2].map((n) => addDays(weekStart, n)));
    expect(second?.covers).toEqual([3, 4, 5, 6].map((n) => addDays(weekStart, n)));
    expect(second?.because).toEqual({ foodId: chicken, name: 'Chicken breast', keepsDays: 4 });

    // Each cook's raw grams are its days' cooked grams over the yield, to 5 g.
    const cookedOn = (dates: string[]) =>
      itemsOf(
        days.filter((day) => dates.includes(day.date)),
        chicken,
      ).reduce((sum, item) => sum + item.plannedGrams, 0);
    const firstDays = [0, 1, 2].map((n) => addDays(weekStart, n));
    const secondDays = [3, 4, 5, 6].map((n) => addDays(weekStart, n));
    const firstRaw = toStep(cookedOn(firstDays) / 0.75);
    const secondRaw = toStep(cookedOn(secondDays) / 0.75);
    expect(first?.cooks.find((cook) => cook.foodId === chicken)).toEqual(
      expect.objectContaining({
        foodId: chicken,
        rawGrams: firstRaw,
        cookedGrams: cookedOn(firstDays),
        approximate: false,
        dates: firstDays,
      }),
    );
    expect(second?.cooks).toEqual([
      expect.objectContaining({ foodId: chicken, rawGrams: secondRaw, dates: secondDays }),
    ]);
    expect(prep.grocery.find((item) => item.foodId === chicken)).toEqual(
      expect.objectContaining({
        section: 'cook_days',
        unit: 'g',
        quantity: firstRaw + secondRaw,
        cooks: [firstRaw, secondRaw],
      }),
    );
    // Oats have no keeps_days: bought once, for the week.
    expect(prep.grocery.find((item) => item.foodId === oats)).toEqual(
      expect.objectContaining({ section: 'week', cooks: [] }),
    );
    // A batch 10 days old asks to be weighed again.
    expect(prep.foods).toEqual([
      expect.objectContaining({
        foodId: chicken,
        keepsDays: 4,
        batch: expect.objectContaining({ id: recorded.id }),
        weighDue: true,
      }),
    ]);
  });

  it('cooks a food that keeps the whole week once', async () => {
    const { send, chicken } = await setUp('prep-once@example.test');
    expect((await send('PATCH', `/api/foods/${chicken}`, { keepsDays: 8 })).status).toBe(200);
    expect((await send('POST', '/api/batches', batch(chicken))).status).toBe(201);
    const weekStart = nextMonday();
    await generate(send, weekStart, addDays(weekStart, 6));
    const prep = await prepFor(send, weekStart);
    expect(prep.cookDays.map((day) => day.which)).toEqual(['first']);
    expect(prep.grocery.find((item) => item.foodId === chicken)?.cooks).toHaveLength(1);
    expect(prep.foods[0]?.weighDue).toBe(false);
  });
});

describe('cross-user (docs/08 §10)', () => {
  it('keeps one member’s batches and prep plan from another', async () => {
    const a = await setUp('batch-a@example.test');
    const b = await setUp('batch-b@example.test');
    const recorded = batch(a.chicken);
    expect((await a.send('POST', '/api/batches', recorded)).status).toBe(201);
    const weekStart = nextMonday();
    await generate(a.send, weekStart, addDays(weekStart, 6));

    // B cannot read A's food's batches, record a batch of it, or take A's batch id.
    expect((await b.send('GET', `/api/foods/${a.chicken}/batches`)).status).toBe(404);
    const refused = await b.send('POST', '/api/batches', batch(a.chicken));
    expect(refused.status).toBe(422);
    const taken = await b.send('POST', '/api/batches', { ...recorded, foodId: b.chicken });
    expect(taken.status).toBe(409);
    const listed: { items: unknown[] } = await (await b.send('GET', '/api/batches')).json();
    expect(listed.items).toEqual([]);

    // B's delete of A's batch changes nothing.
    expect((await b.send('DELETE', `/api/batches/${recorded.id}`)).status).toBe(204);
    const still: { items: { id: string }[] } = await (await a.send('GET', '/api/batches')).json();
    expect(still.items.map((each) => each.id)).toEqual([recorded.id]);

    // B's prep plan is B's own: no plan days yet, nothing of A's.
    const prep = await prepFor(b.send, weekStart);
    expect(prep.missing).toHaveLength(7);
    expect(prep.grocery).toEqual([]);
    expect(prep.foods.map((food) => food.foodId)).toEqual([b.chicken]);
  });
});
