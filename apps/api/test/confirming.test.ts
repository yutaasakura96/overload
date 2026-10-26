import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { localDateIn } from '../src/db/training';
import { sender } from './account-fixture';
import { useTestApp } from './harness';

// S18's routes (docs/07 §4, Confirming a meal; issue #80): each confirm kind, a repeat replacing the
// earlier confirmation, the 7-day lock, the day's completeness, the end-of-day check, and the
// cross-user cases (docs/08 §10).
const t = useTestApp();

type Send = ReturnType<typeof sender>;
type Totals = { energyKcal: number; proteinG: number; carbG: number; fatG: number };
type Item = {
  id: string;
  foodId: string | null;
  name: string;
  plannedGrams: number | null;
  actualGrams: number | null;
  pieceCount: number | null;
  per100g: Totals & { fiberG: number };
};
type Meal = { id: string; status: string; confirmedAt: string | null; items: Item[] };
type Day = { id: string; date: string; complete: boolean; confirmed: Totals; meals: Meal[] };
type Confirmed = Meal & { day: { date: string; complete: boolean; confirmed: Totals } };

const today = () => localDateIn('Asia/Tokyo')(new Date());
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const per100 = (energyKcal: number, proteinG: number, carbG: number, fatG: number, fiberG = 0) => ({
  basis: { kind: 'per_100g', grams: 100 },
  energyKcal,
  proteinG,
  carbG,
  fatG,
  fiberG,
});

const FOODS = [
  { name: 'Chicken breast', state: 'cooked', ...per100(140, 31.1, 0, 2) },
  { name: 'Rice, cooked', state: 'cooked', ...per100(156, 2.5, 37.1, 0.3, 1.5) },
  { name: 'Rolled oats', state: 'raw', ...per100(350, 13.7, 69.1, 5.7, 9.4) },
  { name: 'Broccoli', state: 'raw', ...per100(37, 5.4, 6.6, 0.6, 5.1) },
  { name: 'Egg', state: 'raw', pieceWeightG: 55, ...per100(142, 12.2, 0.4, 10.2) },
  { name: 'Greek yogurt', state: 'raw', ...per100(59, 10.3, 3.6, 0.4) },
  { name: 'Olive oil', state: 'raw', ...per100(894, 0, 0, 100) },
];

const slots = [
  { time: '07:00', label: 'Breakfast' },
  { time: '12:00', label: 'Lunch' },
  { time: '16:30', label: 'Afternoon' },
  { time: '20:00', label: 'Dinner' },
];

/** A member with a plan: every day a rest day, four meals, generated from `from` through `to`. */
async function ok(res: Response, status = 200) {
  expect(res.status).toBe(status);
  return res;
}

/** What an item counts once its meal is confirmed adjusted: what was eaten, else the plan. */
const eatenGrams = (item: Item) => item.actualGrams ?? item.plannedGrams ?? 0;

async function planned(email: string, from = today(), to = today()) {
  const { cookie } = await t.createSignedInUser(email);
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
  await ok(
    await send('POST', '/api/weigh-ins', {
      id: randomUUID(),
      measuredAt: new Date(Date.now() - 60_000).toISOString(),
      weightKg: 82.4,
    }),
    201,
  );
  const foods = new Map<string, string>();
  for (const each of FOODS) {
    const id = randomUUID();
    await ok(await send('POST', '/api/foods', { id, source: 'manual', ...each }), 201);
    foods.set(each.name, id);
  }
  await ok(
    await send('POST', '/api/goal-phases', {
      id: randomUUID(),
      type: 'cut',
      startedOn: addDays(from, -1),
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
      slots,
    }),
  );
  const generated = await ok(await send('POST', '/api/plan-days/generate', { from, to }));
  const { days }: { days: Day[] } = await generated.json();
  return { send, foods, days };
}

const confirm = (send: Send, mealId: string, body: unknown) =>
  send('POST', `/api/plan-meals/${mealId}/confirm`, body);

async function readDay(send: Send, date = today()): Promise<Day> {
  const res = await send('GET', `/api/plan-days?from=${date}&to=${date}`);
  const { days }: { days: Day[] } = await res.json();
  const [day] = days;
  if (day === undefined) throw new Error(`no plan on ${date}`);
  return day;
}

/** What a meal's items add up to, eaten at `grams` each. */
const sum = (items: Item[], grams: (item: Item) => number) =>
  items.reduce((total, item) => total + (grams(item) * item.per100g.energyKcal) / 100, 0);

/** Totals are rounded to the whole kcal, so a sum from the items is within 1 of them. */
const near = (actual: number | undefined, expected: number) =>
  expect(Math.abs((actual ?? Number.NaN) - expected)).toBeLessThanOrEqual(1);

const firstMeal = (day: Day | undefined) => {
  const meal = day?.meals[0];
  if (meal === undefined) throw new Error('no meal');
  return meal;
};

describe('POST /api/plan-meals/{id}/confirm', () => {
  it('confirms a meal as planned in one call, counting its planned items', async () => {
    const { send, days } = await planned('as-planned@example.test');
    const meal = firstMeal(days[0]);
    const res = await confirm(send, meal.id, { status: 'as_planned' });
    expect(res.status).toBe(200);
    const body: Confirmed = await res.json();
    expect(body.status).toBe('as_planned');
    expect(body.confirmedAt).not.toBeNull();
    expect(body.day.complete).toBe(false);
    near(
      body.day.confirmed.energyKcal,
      sum(meal.items, (item) => item.plannedGrams ?? 0),
    );
  });

  it('never counts a repeat twice, and a later kind replaces the earlier one', async () => {
    const { send, days, foods } = await planned('repeat@example.test');
    const meal = firstMeal(days[0]);
    const [first] = meal.items;
    if (first === undefined) throw new Error('no item');
    await confirm(send, meal.id, { status: 'as_planned' });
    const again: Confirmed = await (await confirm(send, meal.id, { status: 'as_planned' })).json();
    const once = sum(meal.items, (item) => item.plannedGrams ?? 0);
    near(again.day.confirmed.energyKcal, once);

    const swapped = randomUUID();
    const adjusted = await confirm(send, meal.id, {
      status: 'adjusted',
      items: [
        { id: first.id, actualGrams: 0 },
        { id: swapped, foodId: foods.get('Greek yogurt'), actualGrams: 200 },
      ],
    });
    expect(adjusted.status).toBe(200);
    // A retry of the same adjust, its new item's id included, is the same confirmation.
    const retried = await confirm(send, meal.id, {
      status: 'adjusted',
      items: [
        { id: first.id, actualGrams: 0 },
        { id: swapped, foodId: foods.get('Greek yogurt'), actualGrams: 200 },
      ],
    });
    expect(retried.status).toBe(200);
    const afterAdjust = firstMeal(await readDay(send));
    expect(afterAdjust.items.filter((item) => item.id === swapped)).toHaveLength(1);

    const back: Confirmed = await (await confirm(send, meal.id, { status: 'as_planned' })).json();
    expect(back.items.map((item) => item.id).toSorted()).toEqual(
      meal.items.map((item) => item.id).toSorted(),
    );
    expect(back.items.every((item) => item.actualGrams === null)).toBe(true);
    near(back.day.confirmed.energyKcal, once);
  });

  it('keeps an eaten food snapshot after an edit, including Adjust and new grams', async () => {
    const { send, foods } = await planned('snapshot-edit@example.test');
    const meal = firstMeal(await readDay(send));
    const id = randomUUID();
    const foodId = foods.get('Greek yogurt');
    const body = { status: 'replaced', items: [{ id, foodId, actualGrams: 200 }] };
    const first: Confirmed = await (await confirm(send, meal.id, body)).json();
    const snapshot = first.items.find((item) => item.id === id);
    expect(snapshot?.name).toBe('Greek yogurt');
    expect(
      (await send('PATCH', `/api/foods/${foodId}`, { name: 'New yogurt', energyKcal: 80 })).status,
    ).toBe(200);
    const repeat: Confirmed = await (await confirm(send, meal.id, body)).json();
    expect(repeat.items.find((item) => item.id === id)).toEqual(snapshot);
    expect(repeat.day.confirmed).toEqual(first.day.confirmed);
    const plannedItem = meal.items[0];
    if (plannedItem === undefined) throw new Error('no planned item');
    const adjusted: Confirmed = await (
      await confirm(send, meal.id, {
        status: 'adjusted',
        items: [
          { id: plannedItem.id, actualGrams: 0 },
          { id, foodId, actualGrams: 200 },
        ],
      })
    ).json();
    expect(adjusted.items.find((item) => item.id === id)).toEqual(snapshot);
    const changed: Confirmed = await (
      await confirm(send, meal.id, {
        status: 'adjusted',
        items: [
          { id: plannedItem.id, actualGrams: 0 },
          { id, foodId, actualGrams: 210 },
        ],
      })
    ).json();
    expect(changed.items.find((item) => item.id === id)).toEqual({
      ...snapshot,
      actualGrams: 210,
    });
  });

  it('keeps an eaten food snapshot after archive, for new grams too, and refuses a new choice', async () => {
    const { send, foods } = await planned('snapshot-archive@example.test');
    const meal = firstMeal(await readDay(send));
    const id = randomUUID();
    const foodId = foods.get('Greek yogurt');
    const body = { status: 'replaced', items: [{ id, foodId, actualGrams: 200 }] };
    const first: Confirmed = await (await confirm(send, meal.id, body)).json();
    expect((await send('DELETE', `/api/foods/${foodId}`)).status).toBe(204);
    const repeat = await confirm(send, meal.id, body);
    expect(repeat.status).toBe(200);
    expect(((await repeat.json()) as Confirmed).items.find((item) => item.id === id)).toEqual(
      first.items.find((item) => item.id === id),
    );
    const regrammed = await confirm(send, meal.id, {
      status: 'replaced',
      items: [{ id, foodId, actualGrams: 250 }],
    });
    expect(regrammed.status).toBe(200);
    expect(((await regrammed.json()) as Confirmed).items.find((item) => item.id === id)).toEqual({
      ...first.items.find((item) => item.id === id),
      actualGrams: 250,
    });
    expect(
      (
        await confirm(send, meal.id, {
          status: 'replaced',
          items: [{ id: randomUUID(), foodId, actualGrams: 200 }],
        })
      ).status,
    ).toBe(422);
  });

  it('adjusts grams, and swaps a food in from the list', async () => {
    const { send, foods } = await planned('adjust@example.test');
    const meal = firstMeal(await readDay(send));
    const [first, ...rest] = meal.items;
    if (first === undefined) throw new Error('no item');
    const added = randomUUID();
    const res = await confirm(send, meal.id, {
      status: 'adjusted',
      items: [
        { id: first.id, actualGrams: 35 },
        { id: added, foodId: foods.get('Broccoli'), actualGrams: 100 },
      ],
    });
    expect(res.status).toBe(200);
    const body: Confirmed = await res.json();
    expect(body.status).toBe('adjusted');
    expect(body.items.find((item) => item.id === first.id)?.actualGrams).toBe(35);
    expect(body.items.find((item) => item.id === added)).toMatchObject({
      foodId: foods.get('Broccoli'),
      name: 'Broccoli',
      plannedGrams: null,
      actualGrams: 100,
    });
    // An item left out keeps its planned amount.
    for (const item of rest) {
      expect(body.items.find((one) => one.id === item.id)?.actualGrams).toBeNull();
    }
    near(body.day.confirmed.energyKcal, sum(body.items, eatenGrams));
  });

  it('replaces a meal from the list or by hand, keeping the planned items at 0 g', async () => {
    const { send, foods } = await planned('replace@example.test');
    const day = await readDay(send);
    const [listed, typed] = day.meals;
    if (listed === undefined || typed === undefined) throw new Error('no meals');
    const fromList: Confirmed = await (
      await confirm(send, listed.id, {
        status: 'replaced',
        items: [{ id: randomUUID(), foodId: foods.get('Rolled oats'), actualGrams: 100 }],
      })
    ).json();
    expect(fromList.status).toBe('replaced');
    const planIds = new Set(listed.items.map((item) => item.id));
    expect(
      fromList.items.filter((item) => planIds.has(item.id)).every((item) => item.actualGrams === 0),
    ).toBe(true);
    near(fromList.day.confirmed.energyKcal, 350);

    const byHand: Confirmed = await (
      await confirm(send, typed.id, {
        status: 'replaced',
        items: [
          {
            id: randomUUID(),
            name: 'Ramen at the station',
            actualGrams: 100,
            per100g: { energyKcal: 650, proteinG: 24, carbG: 80, fatG: 22, fiberG: 0 },
          },
        ],
      })
    ).json();
    expect(byHand.items.find((item) => item.foodId === null)?.name).toBe('Ramen at the station');
    near(byHand.day.confirmed.energyKcal, 350 + 650);
  });

  it('counts nothing for a skipped meal, and takes a confirmation back with planned', async () => {
    const { send, days } = await planned('skip@example.test');
    const meal = firstMeal(days[0]);
    const skipped: Confirmed = await (await confirm(send, meal.id, { status: 'skipped' })).json();
    expect(skipped.status).toBe('skipped');
    expect(skipped.day.confirmed.energyKcal).toBe(0);
    const undone: Confirmed = await (await confirm(send, meal.id, { status: 'planned' })).json();
    expect(undone.status).toBe('planned');
    expect(undone.confirmedAt).toBeNull();
  });

  it('makes a day complete only once every meal is confirmed, a skipped one included', async () => {
    const { send, days } = await planned('complete@example.test');
    const meals = days[0]?.meals ?? [];
    expect(meals.length).toBeGreaterThan(1);
    let last: Confirmed | undefined;
    for (const [index, meal] of meals.entries()) {
      expect(last?.day.complete ?? false).toBe(false);
      const status = index === 0 ? 'skipped' : 'as_planned';
      last = await (await confirm(send, meal.id, { status })).json();
    }
    expect(last?.day.complete).toBe(true);
    expect((await readDay(send)).complete).toBe(true);
  });

  it('refuses an item that is not the meal’s, a food not on the list, and a mixed entry', async () => {
    const { send, days, foods } = await planned('invalid@example.test');
    const [meal, other] = days[0]?.meals ?? [];
    if (meal === undefined || other === undefined) throw new Error('no meals');
    const otherItem = other.items[0]?.id;
    const refused = [
      { status: 'adjusted', items: [{ id: otherItem, actualGrams: 50 }] },
      { status: 'adjusted', items: [{ id: randomUUID(), foodId: randomUUID(), actualGrams: 50 }] },
      { status: 'adjusted', items: [{ id: randomUUID(), name: 'Toast', actualGrams: 50 }] },
      {
        status: 'replaced',
        items: [{ id: meal.items[0]?.id, foodId: foods.get('Egg'), actualGrams: 50 }],
      },
      { status: 'replaced', items: [{ id: randomUUID(), foodId: foods.get('Egg') }] },
      { status: 'replaced', items: [] },
    ];
    const statuses = [];
    for (const body of refused) statuses.push((await confirm(send, meal.id, body)).status);
    expect(statuses).toEqual(refused.map(() => 422));
    // The meal stays at its previous status.
    expect(firstMeal(await readDay(send)).status).toBe('planned');
  });

  it('locks a day more than 7 days after its date', async () => {
    const { send } = await planned(
      'locked@example.test',
      addDays(today(), -8),
      addDays(today(), -7),
    );
    const old = await readDay(send, addDays(today(), -8));
    const edge = await readDay(send, addDays(today(), -7));
    const locked = await confirm(send, firstMeal(old).id, { status: 'as_planned' });
    expect(locked.status).toBe(409);
    expect(await locked.json()).toMatchObject({ code: 'day_locked' });
    expect((await confirm(send, firstMeal(edge).id, { status: 'as_planned' })).status).toBe(200);
    const all = await send('POST', `/api/plan-days/${addDays(today(), -8)}/confirm-all`);
    expect(all.status).toBe(409);
    expect(firstMeal(await readDay(send, addDays(today(), -8))).status).toBe('planned');
  });

  it('keeps one user’s meals, foods and item ids from another', async () => {
    const owner = await planned('owner@example.test');
    const intruder = await planned('intruder@example.test');
    const theirs = firstMeal(owner.days[0]);
    const mine = firstMeal(intruder.days[0]);
    expect((await confirm(intruder.send, theirs.id, { status: 'as_planned' })).status).toBe(404);
    expect(firstMeal(await readDay(owner.send)).status).toBe('planned');

    const foreignFood = await confirm(intruder.send, mine.id, {
      status: 'replaced',
      items: [{ id: randomUUID(), foodId: owner.foods.get('Egg'), actualGrams: 50 }],
    });
    expect(foreignFood.status).toBe(422);

    const conflict = await confirm(intruder.send, mine.id, {
      status: 'replaced',
      items: [{ id: theirs.items[0]?.id, foodId: intruder.foods.get('Egg'), actualGrams: 50 }],
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: 'id_conflict' });
  });

  it('answers 404 for a meal that does not exist, and 400 for a malformed id', async () => {
    const { send } = await planned('missing@example.test');
    expect((await confirm(send, randomUUID(), { status: 'as_planned' })).status).toBe(404);
    expect((await confirm(send, 'nope', { status: 'as_planned' })).status).toBe(400);
  });
});

describe('POST /api/plan-days/{date}/confirm-all', () => {
  it('confirms every planned meal as planned and leaves confirmed ones as they are', async () => {
    const { send, days, foods } = await planned('all@example.test');
    const [adjusted, skipped] = days[0]?.meals ?? [];
    if (adjusted === undefined || skipped === undefined) throw new Error('no meals');
    await confirm(send, adjusted.id, {
      status: 'replaced',
      items: [{ id: randomUUID(), foodId: foods.get('Greek yogurt'), actualGrams: 150 }],
    });
    await confirm(send, skipped.id, { status: 'skipped' });
    const res = await send('POST', `/api/plan-days/${today()}/confirm-all`);
    expect(res.status).toBe(200);
    const day: Day = await res.json();
    expect(day.complete).toBe(true);
    const statuses = new Map(day.meals.map((meal) => [meal.id, meal.status]));
    expect(statuses.get(adjusted.id)).toBe('replaced');
    expect(statuses.get(skipped.id)).toBe('skipped');
    expect(
      day.meals
        .filter((meal) => meal.id !== adjusted.id && meal.id !== skipped.id)
        .every((meal) => meal.status === 'as_planned'),
    ).toBe(true);
    // A repeat changes nothing.
    const again: Day = await (await send('POST', `/api/plan-days/${today()}/confirm-all`)).json();
    expect(again.confirmed).toEqual(day.confirmed);
  });

  it('answers 404 for a date with no plan of the caller’s, and keeps another user’s day', async () => {
    const owner = await planned('day-owner@example.test');
    const { cookie } = await t.createSignedInUser('day-intruder@example.test');
    const intruder = sender(t, cookie);
    expect((await intruder('POST', `/api/plan-days/${today()}/confirm-all`)).status).toBe(404);
    expect((await readDay(owner.send)).meals.every((meal) => meal.status === 'planned')).toBe(true);
    expect((await owner.send('POST', '/api/plan-days/nope/confirm-all')).status).toBe(400);
  });

  it('leaves a day with a confirmed meal as it is when the week is generated again', async () => {
    const { send, days } = await planned('kept@example.test');
    const meal = firstMeal(days[0]);
    await confirm(send, meal.id, { status: 'skipped' });
    await send('POST', '/api/plan-days/generate', { from: today(), to: today() });
    const day = await readDay(send);
    expect(day.id).toBe(days[0]?.id);
    expect(day.meals.find((each) => each.id === meal.id)?.status).toBe('skipped');
  });
});
