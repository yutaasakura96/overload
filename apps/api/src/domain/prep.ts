// Batches, shelf life, the prep plan and the grocery list (S13, S16, S17; docs/03 §8.2). Pure: the
// routes read the plan, the foods and the batches, and this works out what to cook on which day.
//
// A week runs Monday to Sunday. Its first cook day is the Sunday before it; a cooked batch covers
// `keeps_days` calendar days from Monday (docs/02 S16). When a batch-cooked food would not
// last the week, the second cook is Thursday. Each plan day is served by the first cook until
// Thursday when its batch still keeps, else by the second
// (docs/06, 2026-10-16, Q8: B). Counting down each batch's portions was rejected.

import type { Per100g } from './planner.js';

const DAY_MS = 86_400_000;
/** The days of one week, Monday first. */
export const WEEK_DAYS = 7;
/** A batch older than this many days is due to be weighed again (docs/09 F12). */
export const WEIGH_AFTER_DAYS = 7;
/** Raw grams to cook are rounded to this, as plan portions are (S16). */
const RAW_STEP_G = 5;

const dayNumber = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
const dateOf = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);
export const addDays = (date: string, days: number) => dateOf(dayNumber(date) + days);
export const daysBetween = (from: string, to: string) => dayNumber(to) - dayNumber(from);

/** The Monday of the week a local date is in. */
export function weekStartOf(date: string): string {
  const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(date, -weekday);
}

export const isWeekStart = (date: string) => weekStartOf(date) === date;

/** A week's cook days: the Sunday before it, and the second when a food would not last the week. */
export type CookDays = { first: string; second: string | null };

/** Whether a batch cooked on `cookDay` still keeps on `date` (docs/02 S16). */
export const keepsOn = (cookDay: string, keepsDays: number, date: string) => {
  const age = daysBetween(cookDay, date);
  return age >= 0 && age < keepsDays;
};

/**
 * The cook days of the week starting `weekStart`, from how long each batch-cooked food keeps. One
 * cook day when every batch keeps the whole week; otherwise Thursday is the second day.
 */
export function cookDaysOf(weekStart: string, keeps: number[]): CookDays {
  const first = addDays(weekStart, -1);
  return { first, second: keeps.some((days) => days < WEEK_DAYS) ? addDays(weekStart, 3) : null };
}

/** Which cook serves a food on a plan day. */
export function cookFor(
  cookDays: CookDays,
  keepsDays: number,
  date: string,
): 'first' | 'second' | null {
  if (
    (cookDays.second === null || date < cookDays.second) &&
    keepsOn(addDays(cookDays.first, 1), keepsDays, date)
  )
    return 'first';
  if (cookDays.second !== null && keepsOn(cookDays.second, keepsDays, date)) return 'second';
  return null;
}

/**
 * Whether a food may be planned on a date (S16): a food not batch-cooked always, a batch-cooked one
 * only on days a batch from its week's cook days covers.
 */
export function plannableOn(keepsDays: number | null, cookDays: CookDays, date: string): boolean {
  return keepsDays === null || cookFor(cookDays, keepsDays, date) !== null;
}

/** A batch as the plan reads it: what went in raw, what came out cooked, and when (S13). */
export type Batch = {
  id: string;
  foodId: string;
  cookedOn: string;
  rawWeightG: number;
  cookedWeightG: number;
};

/**
 * The yields a batch may have: a tenth to ten times. Rice and dried beans take up two to three
 * times their weight in water; past these bounds a figure is a typing slip, and a yield near zero
 * would turn a cooked portion into thousands of calories.
 */
export const MIN_YIELD = 0.1;
export const MAX_YIELD = 10;

/** A batch's yield: cooked weight over raw. Computed, never stored (docs/04 `batch`). */
export const batchYield = (batch: Pick<Batch, 'rawWeightG' | 'cookedWeightG'>) =>
  batch.cookedWeightG / batch.rawWeightG;

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * A cooked portion's values per 100 g, from the food's raw values and a batch's yield (S13): 100 g
 * cooked came from 100 ÷ yield grams raw.
 */
export function cookedPer100g(raw: Per100g, yieldRatio: number): Per100g {
  return {
    energyKcal: round2(raw.energyKcal / yieldRatio),
    proteinG: round2(raw.proteinG / yieldRatio),
    carbG: round2(raw.carbG / yieldRatio),
    fatG: round2(raw.fatG / yieldRatio),
    fiberG: round2(raw.fiberG / yieldRatio),
  };
}

/** "Weigh this week's batch" (docs/09 F12): no batch, or the newest older than 7 days. */
export const weighDue = (newestCookedOn: string | null, today: string) =>
  newestCookedOn === null || daysBetween(newestCookedOn, today) > WEIGH_AFTER_DAYS;

/** A food as the prep plan reads it: its list values, raw or cooked per 100 g. */
export type PrepFood = {
  id: string;
  name: string;
  state: 'raw' | 'cooked';
  keepsDays: number | null;
  pieceWeightG: number | null;
  energyKcalPer100g: number;
};

/** One planned food on one plan day. */
export type PrepItem = {
  date: string;
  foodId: string;
  yieldRatio: number | null;
  plannedGrams: number;
  pieceCount: number | null;
  /** The grams are a cooked weight. */
  cooked: boolean;
  /** The calories per 100 g the item was planned at. */
  energyKcalPer100g: number;
};

export type Cook = {
  foodId: string;
  name: string;
  keepsDays: number | null;
  /** Raw grams to cook, to 5 g. Null for a food stored cooked with no batch to convert by. */
  rawGrams: number | null;
  /** The cooked grams the plan asks for. Null for a food planned raw with no batch weighed. */
  cookedGrams: number | null;
  /** No batch weighed: the raw grams are worked out from the food table's cooked values. */
  approximate: boolean;
  dates: string[];
};

export type CookDay = {
  date: string;
  which: 'first' | 'second';
  /** The days its batch-cooked foods serve; only with none, the days its other foods are for. */
  covers: string[];
  /** On the second day, the food whose first batch runs out and so makes it needed. */
  because: { foodId: string; name: string; keepsDays: number } | null;
  cooks: Cook[];
};

export type GroceryItem = {
  foodId: string;
  name: string;
  /** `cook_days`: bought raw for the cook days; `week`: for the week, weighed at each meal. */
  section: 'cook_days' | 'week';
  unit: 'g' | 'pieces';
  /** Null when a cook's raw grams cannot be worked out. */
  quantity: number | null;
  /** The raw grams of each cook, in cook-day order, summed into `quantity`. */
  cooks: (number | null)[];
  approximate: boolean;
};

export type Uncovered = { foodId: string; name: string; keepsDays: number; dates: string[] };

export type PrepPlan = {
  weekStart: string;
  cookDays: CookDay[];
  /** Batch-cooked foods whose batches leave days of the week with none (S16): other foods those days. */
  uncovered: Uncovered[];
  grocery: GroceryItem[];
};

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

const sumOrNull = (values: (number | null)[]) =>
  values.some((value) => value === null)
    ? null
    : values.reduce<number>((total, value) => total + (value ?? 0), 0);

const toStep = (grams: number) => Math.round(grams / RAW_STEP_G) * RAW_STEP_G;

/**
 * One item's raw and cooked grams. With a batch, its yield converts; without one, a raw food
 * planned at the table's cooked values converts by their calories, which cooking keeps, and is
 * approximate. A food stored cooked has no raw values to convert by until a batch is weighed.
 */
function itemWeights(item: PrepItem, food: PrepFood, yieldRatio: number | null) {
  if (!item.cooked) {
    return {
      raw: item.plannedGrams,
      cooked: yieldRatio === null ? null : item.plannedGrams * yieldRatio,
      approximate: false,
    };
  }
  if (yieldRatio !== null) {
    return { raw: item.plannedGrams / yieldRatio, cooked: item.plannedGrams, approximate: false };
  }
  if (food.state === 'cooked' || food.energyKcalPer100g <= 0) {
    return { raw: null, cooked: item.plannedGrams, approximate: false };
  }
  return {
    raw: (item.plannedGrams * item.energyKcalPer100g) / food.energyKcalPer100g,
    cooked: item.plannedGrams,
    approximate: true,
  };
}

/**
 * S17: the week's prep plan and grocery list. Each batch-cooked food's planned cooked grams are
 * turned back into raw grams by its saved batch, assigned to the cook that serves each day, and
 * summed per cook; the grocery list sums both cooks per food, and every other food over the week.
 */
export function prepPlan(input: {
  weekStart: string;
  cookDays: CookDays;
  foods: PrepFood[];
  /** Every planned item on the week's days. */
  items: PrepItem[];
  /** The batch-cooked foods on the list, which the week's cook days are chosen for. */
  listed: { id: string; name: string; keepsDays: number }[];
}): PrepPlan {
  const { weekStart, cookDays } = input;
  const weekEnd = addDays(weekStart, WEEK_DAYS - 1);
  const week = input.items.filter((item) => item.date >= weekStart && item.date <= weekEnd);
  const foodOf = new Map(input.foods.map((food) => [food.id, food]));

  type Share = { raw: number | null; cooked: number | null; approximate: boolean; date: string };
  const shares = new Map<string, Share[]>();
  const loose = new Map<string, { grams: number; pieces: number | null }>();
  for (const item of week) {
    const food = foodOf.get(item.foodId);
    if (food === undefined) continue;
    if (food.keepsDays === null || food.state === 'cooked') {
      const sum = loose.get(food.id) ?? { grams: 0, pieces: 0 };
      sum.grams += item.plannedGrams;
      sum.pieces =
        food.pieceWeightG === null || item.pieceCount === null || sum.pieces === null
          ? null
          : sum.pieces + item.pieceCount;
      loose.set(food.id, sum);
      const key = `first:${food.id}`;
      shares.set(key, [
        ...(shares.get(key) ?? []),
        { ...itemWeights(item, food, item.yieldRatio), date: item.date },
      ]);
      continue;
    }
    // A day no batch keeps for (a plan made before the food's shelf life was set) is cooked for by
    // the cook nearest before it, so the shopping still covers what the plan asks for.
    const which =
      cookFor(cookDays, food.keepsDays, item.date) ??
      (cookDays.second !== null && item.date >= cookDays.second ? 'second' : 'first');
    const weights = itemWeights(item, food, item.yieldRatio);
    const key = `${which}:${food.id}`;
    shares.set(key, [...(shares.get(key) ?? []), { ...weights, date: item.date }]);
  }

  const cooksOn = (which: 'first' | 'second'): Cook[] =>
    [...shares.entries()]
      .filter(([key]) => key.startsWith(`${which}:`))
      .flatMap(([key, list]) => {
        const food = foodOf.get(key.slice(which.length + 1));
        if (food === undefined) return [];
        const raw = sumOrNull(list.map((share) => share.raw));
        const cooked = sumOrNull(list.map((share) => share.cooked));
        const dates = [...new Set(list.map((share) => share.date))].toSorted();
        return [
          {
            foodId: food.id,
            name: food.name,
            keepsDays: food.state === 'raw' ? food.keepsDays : null,
            rawGrams: raw === null ? null : toStep(raw),
            cookedGrams: cooked === null ? null : Math.round(cooked),
            approximate: list.some((share) => share.approximate),
            dates,
          },
        ];
      })
      .toSorted(byName);

  const coversOf = (cooks: Cook[]) => {
    const batchCooked = cooks.filter((cook) => cook.keepsDays !== null);
    const from = batchCooked.length > 0 ? batchCooked : cooks;
    return [...new Set(from.flatMap((cook) => cook.dates))].toSorted();
  };
  const first = cooksOn('first');
  const second = cooksOn('second');
  const days: CookDay[] = [];
  if (first.length > 0 || second.length === 0) {
    days.push({
      date: cookDays.first,
      which: 'first',
      covers: coversOf(first),
      because: null,
      cooks: first,
    });
  }
  if (cookDays.second !== null && second.length > 0) {
    const reason = second.toSorted((a, b) => (a.keepsDays ?? 0) - (b.keepsDays ?? 0))[0];
    days.push({
      date: cookDays.second,
      which: 'second',
      covers: coversOf(second),
      because:
        reason === undefined || reason.keepsDays === null
          ? null
          : { foodId: reason.foodId, name: reason.name, keepsDays: reason.keepsDays },
      cooks: second,
    });
  }

  const cooked = new Map<string, Cook[]>();
  for (const cook of days.flatMap((day) => day.cooks)) {
    if (cook.keepsDays === null) continue;
    cooked.set(cook.foodId, [...(cooked.get(cook.foodId) ?? []), cook]);
  }
  const forCookDays: GroceryItem[] = [...cooked.values()]
    .map((cooks): GroceryItem => {
      const [one] = cooks;
      const raws = cooks.map((cook) => cook.rawGrams);
      return {
        foodId: one?.foodId ?? '',
        name: one?.name ?? '',
        section: 'cook_days',
        unit: 'g',
        quantity: sumOrNull(raws),
        cooks: raws,
        approximate: cooks.some((cook) => cook.approximate),
      };
    })
    .toSorted(byName);
  const forWeek: GroceryItem[] = [...loose.entries()]
    .flatMap(([foodId, sum]): GroceryItem[] => {
      const food = foodOf.get(foodId);
      if (food === undefined) return [];
      const pieces = sum.pieces !== null && food.pieceWeightG !== null;
      return [
        {
          foodId,
          name: food.name,
          section: 'week',
          unit: pieces ? 'pieces' : 'g',
          quantity: pieces ? sum.pieces : Math.round(sum.grams),
          cooks: [],
          approximate: false,
        },
      ];
    })
    .toSorted(byName);

  const weekDates = Array.from({ length: WEEK_DAYS }, (_, index) => addDays(weekStart, index));
  const uncovered = input.listed
    .map((food) => ({
      foodId: food.id,
      name: food.name,
      keepsDays: food.keepsDays,
      dates: weekDates.filter((date) => cookFor(cookDays, food.keepsDays, date) === null),
    }))
    .filter((food) => food.dates.length > 0)
    .toSorted(byName);

  return { weekStart, cookDays: days, uncovered, grocery: [...forCookDays, ...forWeek] };
}
