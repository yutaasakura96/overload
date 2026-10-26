import { describe, expect, it } from 'vitest';
import { planDates, type PlanningFood } from '../src/domain/planning';
import {
  addDays,
  batchYield,
  cookDaysOf,
  cookedPer100g,
  cookFor,
  prepPlan,
  weekStartOf,
  weighDue,
  type PrepFood,
  type PrepItem,
} from '../src/domain/prep';
import { macroTargets } from '../src/domain/targets';

// S13, S16 and S17 (docs/03 §8.2, docs/11 §2): the yield and its approximate fallback, the cook days
// a food's shelf life asks for, the split into two cooks at the `keeps_days` boundary, and the
// grocery sum. The week of Monday 19 October 2026 throughout; its first cook day is Sunday the 18th.

const WEEK = '2026-10-19';
const week = Array.from({ length: 7 }, (_, index) => addDays(WEEK, index));

const food = (id: string, extra: Partial<PrepFood> = {}): PrepFood => ({
  id,
  name: id,
  state: 'raw',
  keepsDays: null,
  pieceWeightG: null,
  energyKcalPer100g: 100,
  ...extra,
});

const daily = (foodId: string, grams: number, extra: Partial<PrepItem> = {}): PrepItem[] =>
  week.map((date) => ({
    date,
    foodId,
    yieldRatio: null,
    plannedGrams: grams,
    pieceCount: null,
    cooked: true,
    energyKcalPer100g: 140,
    ...extra,
  }));

describe('the week and its cook days', () => {
  it('starts weeks on Monday', () => {
    expect(weekStartOf('2026-10-19')).toBe(WEEK);
    expect(weekStartOf('2026-10-25')).toBe(WEEK);
    expect(weekStartOf('2026-10-26')).toBe('2026-10-26');
  });

  it('cooks once, the Sunday before, when every batch keeps the week', () => {
    expect(cookDaysOf(WEEK, [7, 10])).toEqual({ first: '2026-10-18', second: null });
    expect(cookDaysOf(WEEK, [])).toEqual({ first: '2026-10-18', second: null });
  });

  it('adds a second cook day when a batch would not last the week', () => {
    expect(cookDaysOf(WEEK, [6]).second).toBe('2026-10-22');
    // Chicken 4, rice 3, potato 5, broccoli 4, as the approved prototype draws it: Thursday.
    expect(cookDaysOf(WEEK, [4, 3, 5, 4])).toEqual({ first: '2026-10-18', second: '2026-10-22' });
  });

  it('serves a day from the first cook while its batch keeps, then from the second', () => {
    const days = cookDaysOf(WEEK, [4]);
    expect(days.second).toBe('2026-10-22');
    // Sunday's batch keeping 4 days is good to Wednesday the 21st, and no further.
    expect(cookFor(days, 4, '2026-10-21')).toBe('first');
    expect(cookFor(days, 4, '2026-10-22')).toBe('second');
    expect(cookFor(days, 4, '2026-10-25')).toBe('second');
    // Rice keeps 3: Monday to Wednesday from Sunday, Thursday to Saturday from Thursday.
    expect(week.map((date) => cookFor(days, 3, date))).toEqual([
      'first',
      'first',
      'first',
      'second',
      'second',
      'second',
      null,
    ]);
  });

  it.each([1, 2, 3])('keeps %i days: cooks Sunday and Thursday and names the gap', (keepsDays) => {
    const cookDays = cookDaysOf(WEEK, [keepsDays]);
    expect(cookDays).toEqual({ first: '2026-10-18', second: '2026-10-22' });
    expect(cookFor(cookDays, keepsDays, WEEK)).toBe('first');
    expect(cookFor(cookDays, keepsDays, '2026-10-22')).toBe('second');
    const plan = prepPlan({
      weekStart: WEEK,
      cookDays,
      foods: [food('rice', { keepsDays })],
      items: daily('rice', 100).filter((item) => cookFor(cookDays, keepsDays, item.date) !== null),
      listed: [{ id: 'rice', name: 'rice', keepsDays }],
    });
    expect(plan.cookDays.map((day) => [day.date, day.cooks[0]?.rawGrams])).toEqual([
      ['2026-10-18', keepsDays * 140],
      ['2026-10-22', keepsDays * 140],
    ]);
    expect(plan.grocery[0]?.quantity).toBe(keepsDays * 280);
    expect(plan.uncovered[0]?.dates.length).toBe(7 - keepsDays * 2);
    expect(plan.cookDays.map((day) => day.covers)).toEqual([
      week.slice(0, keepsDays),
      week.slice(3, 3 + keepsDays),
    ]);
  });
});

describe('the yield (S13)', () => {
  it('is cooked weight over raw, and turns raw values into cooked ones', () => {
    expect(batchYield({ rawWeightG: 1400, cookedWeightG: 1050 })).toBe(0.75);
    const per100g = cookedPer100g(
      { energyKcal: 105, proteinG: 23.3, carbG: 0.1, fatG: 1.9, fiberG: 0 },
      0.75,
    );
    expect(per100g).toEqual({
      energyKcal: 140,
      proteinG: 31.07,
      carbG: 0.13,
      fatG: 2.53,
      fiberG: 0,
    });
  });

  it('asks for a weigh when there is no batch from the last 7 days', () => {
    expect(weighDue(null, '2026-10-19')).toBe(true);
    expect(weighDue('2026-10-12', '2026-10-19')).toBe(false);
    expect(weighDue('2026-10-11', '2026-10-19')).toBe(true);
  });
});

describe('the prep plan and grocery list (S17)', () => {
  const chicken = food('chicken', { name: 'Chicken breast', keepsDays: 4, energyKcalPer100g: 105 });
  const listed = [{ id: 'chicken', name: 'Chicken breast', keepsDays: 4 }];
  it('splits a food into two cooks at its keeps_days boundary, and the grocery list sums both', () => {
    const plan = prepPlan({
      weekStart: WEEK,
      cookDays: cookDaysOf(WEEK, [4]),
      foods: [chicken],
      items: daily('chicken', 300, { yieldRatio: 0.75 }),
      listed,
    });
    expect(plan.cookDays.map((day) => [day.date, day.which])).toEqual([
      ['2026-10-18', 'first'],
      ['2026-10-22', 'second'],
    ]);
    const [first, second] = plan.cookDays;
    // Three days of 300 g cooked at a yield of 0.75 is 1,200 g raw; four days is 1,600 g.
    expect(first?.cooks).toEqual([
      expect.objectContaining({
        foodId: 'chicken',
        rawGrams: 1200,
        cookedGrams: 900,
        approximate: false,
        dates: week.slice(0, 3),
      }),
    ]);
    expect(first?.covers).toEqual(week.slice(0, 3));
    expect(second?.cooks).toEqual([
      expect.objectContaining({ rawGrams: 1600, cookedGrams: 1200, dates: week.slice(3) }),
    ]);
    expect(second?.because).toEqual({ foodId: 'chicken', name: 'Chicken breast', keepsDays: 4 });
    expect(plan.grocery).toEqual([
      {
        foodId: 'chicken',
        name: 'Chicken breast',
        section: 'cook_days',
        unit: 'g',
        quantity: 2800,
        cooks: [1200, 1600],
        approximate: false,
      },
    ]);
  });

  it('uses each saved item’s batch yield before summing its cooks and groceries', () => {
    const plan = prepPlan({
      weekStart: WEEK,
      cookDays: cookDaysOf(WEEK, [4]),
      foods: [chicken],
      items: daily('chicken', 100).map((item, index) => ({
        ...item,
        yieldRatio: index < 3 ? 0.75 : 0.5,
      })),
      listed,
    });
    expect(plan.cookDays.map((day) => day.cooks[0]?.rawGrams)).toEqual([400, 800]);
    expect(plan.grocery[0]).toEqual(expect.objectContaining({ quantity: 1200, cooks: [400, 800] }));
  });

  it('cooks a food that keeps the week once', () => {
    const plan = prepPlan({
      weekStart: WEEK,
      cookDays: cookDaysOf(WEEK, [8]),
      foods: [{ ...chicken, keepsDays: 8 }],
      items: daily('chicken', 300, { yieldRatio: 0.75 }),
      listed: [{ id: 'chicken', name: 'Chicken breast', keepsDays: 8 }],
    });
    expect(plan.cookDays).toHaveLength(1);
    expect(plan.cookDays[0]?.cooks[0]?.rawGrams).toBe(2800);
    expect(plan.grocery[0]?.cooks).toEqual([2800]);
  });

  it('cooks foods without keeps_days once on Sunday and lists them for the week', () => {
    const oats = food('oats', { name: 'Rolled oats' });
    const egg = food('egg', { name: 'Egg', pieceWeightG: 55 });
    const plan = prepPlan({
      weekStart: WEEK,
      cookDays: cookDaysOf(WEEK, [4]),
      foods: [chicken, oats, egg],
      items: [
        ...daily('chicken', 300, { yieldRatio: 0.75 }),
        ...daily('oats', 80, { cooked: false }),
        ...daily('egg', 110, { cooked: false, pieceCount: 2 }),
      ],
      listed,
    });
    expect(plan.cookDays.flatMap((day) => day.cooks.map((cook) => cook.foodId))).toEqual([
      'chicken',
      'egg',
      'oats',
      'chicken',
    ]);
    expect(plan.cookDays[0]?.date).toBe('2026-10-18');
    expect(plan.cookDays[0]?.cooks.find((cook) => cook.foodId === 'oats')).toEqual(
      expect.objectContaining({ keepsDays: null, rawGrams: 560, dates: week }),
    );
    expect(plan.cookDays.map((day) => day.covers)).toEqual([week.slice(0, 3), week.slice(3)]);
    expect(plan.grocery.filter((item) => item.section === 'week')).toEqual([
      expect.objectContaining({ foodId: 'egg', unit: 'pieces', quantity: 14, cooks: [] }),
      expect.objectContaining({ foodId: 'oats', unit: 'g', quantity: 560, cooks: [] }),
    ]);
  });

  it('keeps a one-day food’s cook days to the days it serves, beside a food for the whole week', () => {
    const rice = food('rice', { name: 'White rice', keepsDays: 1 });
    const oats = food('oats', { name: 'Rolled oats' });
    const cookDays = cookDaysOf(WEEK, [1]);
    const plan = prepPlan({
      weekStart: WEEK,
      cookDays,
      foods: [rice, oats],
      items: [
        ...daily('rice', 100).filter((item) => cookFor(cookDays, 1, item.date) !== null),
        ...daily('oats', 80, { cooked: false }),
      ],
      listed: [{ id: 'rice', name: 'White rice', keepsDays: 1 }],
    });
    expect(plan.cookDays.map((day) => [day.date, day.covers])).toEqual([
      ['2026-10-18', [week[0]]],
      ['2026-10-22', [week[3]]],
    ]);
    expect(plan.uncovered[0]?.dates).toEqual([week[1], week[2], week[4], week[5], week[6]]);
  });

  it('claims only the days a batch keeps for when the plan predates a one-day shelf life', () => {
    const cookDays = cookDaysOf(WEEK, [1]);
    const plan = prepPlan({
      weekStart: WEEK,
      cookDays,
      foods: [food('rice', { name: 'White rice', keepsDays: 1 })],
      items: daily('rice', 100),
      listed: [{ id: 'rice', name: 'White rice', keepsDays: 1 }],
    });
    expect(plan.cookDays.map((day) => [day.covers, day.cooks[0]?.dates])).toEqual([
      [[week[0]], week.slice(0, 3)],
      [[week[3]], week.slice(3)],
    ]);
    expect(plan.grocery[0]?.cooks).toEqual([420, 560]);
    expect(plan.uncovered[0]?.dates).toEqual([week[1], week[2], week[4], week[5], week[6]]);
  });

  it('without a batch, works raw grams out from the food table’s cooked values, approximately', () => {
    const plan = prepPlan({
      weekStart: WEEK,
      cookDays: cookDaysOf(WEEK, [4]),
      foods: [chicken],
      // Planned at MEXT's boiled values, 140 kcal per 100 g, against 105 raw.
      items: daily('chicken', 300),
      listed,
    });
    expect(plan.cookDays[0]?.cooks[0]).toEqual(
      expect.objectContaining({ rawGrams: 1200, cookedGrams: 900, approximate: true }),
    );
    expect(plan.grocery[0]?.approximate).toBe(true);
  });

  it('names the days a short-keeping food leaves without a batch', () => {
    const plan = prepPlan({
      weekStart: WEEK,
      cookDays: cookDaysOf(WEEK, [4, 3]),
      foods: [chicken],
      items: daily('chicken', 300, { yieldRatio: 0.75 }),
      listed: [...listed, { id: 'rice', name: 'White rice', keepsDays: 3 }],
    });
    expect(plan.uncovered).toEqual([
      { foodId: 'rice', name: 'White rice', keepsDays: 3, dates: ['2026-10-25'] },
    ]);
  });
});

const planningFood = (
  id: string,
  per100: [number, number, number, number, number],
  extra: Partial<PlanningFood> = {},
): PlanningFood => ({
  id,
  name: id,
  per100g: {
    energyKcal: per100[0],
    proteinG: per100[1],
    carbG: per100[2],
    fatG: per100[3],
    fiberG: per100[4],
  },
  pieceWeightG: null,
  rotationGroupId: null,
  keepsDays: null,
  cooked: false,
  approximate: false,
  noCookedMatch: false,
  batchId: null,
  yieldRatio: null,
  ...extra,
});

describe('the planner keeps to the cook days (S16)', () => {
  it('plans a batch-cooked food only on days a batch keeps for, and others the rest', () => {
    const rice = planningFood('rice', [156, 2.5, 37.1, 0.3, 1.5], {
      keepsDays: 3,
      cooked: true,
      rotationGroupId: 'starch',
    });
    const potato = planningFood('potato', [70, 1.8, 15.8, 0.1, 1.5], {
      keepsDays: 5,
      cooked: true,
      rotationGroupId: 'starch',
    });
    const chicken = planningFood('chicken', [140, 31.1, 0.1, 2.5, 0], {
      keepsDays: 4,
      cooked: true,
    });
    const oil = planningFood('oil', [894, 0, 0, 100, 0]);
    const days = planDates({
      dates: week,
      trainingWeekdays: [],
      routines: {
        rest: {
          wakeTime: '07:00',
          trainingTime: null,
          slots: [
            { position: 1, time: '08:00', label: null },
            { position: 2, time: '12:30', label: null },
            { position: 3, time: '19:00', label: null },
          ],
        },
      },
      targets: macroTargets({ calorieTargetKcal: 2200, proteinGPerKg: 2, fatPctCalories: 25 }, 80),
      goalPhaseId: null,
      foods: [rice, potato, chicken, oil],
    });
    const uses = (id: string) =>
      days
        .filter((day) => day.meals.some((meal) => meal.items.some((item) => item.foodId === id)))
        .map((day) => day.date);
    // Rice keeps 3 days: the cook days of Sunday and Thursday leave Sunday without.
    expect(uses('rice')).not.toContain('2026-10-25');
    // Its group's potato stands in on those days.
    expect(uses('potato')).toContain('2026-10-25');
    expect(uses('chicken')).toEqual(week);
  });
});
