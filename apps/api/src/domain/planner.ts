// S16's daily meal plan (docs/03 §8.2): a pure, deterministic function. The same foods, targets,
// meals and date always give the same plan. Hand-written rather than a solver library (docs/06,
// 2026-10-18): each food takes one role by the macro most of its energy comes from, each meal is
// solved for its share of protein and carbohydrate, fat fills the rest of the day, and a last pass
// in whole 5 g steps or whole pieces brings the day within ±5% of calories and ±5 g of protein. What
// cannot be reached is named, never hidden by padding another food.

import type { MealSlot } from './meals.js';
import type { Targets } from './targets.js';

export type Per100g = {
  energyKcal: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  fiberG: number;
};

/** A food the plan may use, its values per 100 g of the weight the plan gives. */
export type PlannerFood = {
  id: string;
  per100g: Per100g;
  /** Set for a food counted in whole pieces. */
  pieceWeightG: number | null;
  rotationGroupId: string | null;
};

export type PlannedItem = { foodId: string; grams: number; pieces: number | null };
export type PlannedMeal = MealSlot & { items: PlannedItem[] };
export type Totals = Per100g;

export type Shortfall =
  | { target: 'protein'; missingG: number; suggestion: 'add_protein_source' }
  | {
      target: 'energy';
      missingKcal: number;
      /** `portion_cap`: a portion reached its cap; `foods`: the list has nothing more to give. */
      cause: 'portion_cap' | 'foods';
      suggestion: 'add_food' | null;
    };

export type DayPlan = { meals: PlannedMeal[]; planned: Totals; shortfalls: Shortfall[] };

/** Calories within this share of the target, protein within these grams (S16). */
export const KCAL_TOLERANCE = 0.05;
export const PROTEIN_TOLERANCE_G = 5;
/** Gram amounts are multiples of this (S16). */
export const GRAM_STEP = 5;
/**
 * The most one food may be in one meal: 400 g, or 800 kcal, whichever comes first (docs/02, a food
 * list that cannot fit the calories without extreme portions).
 */
export const PORTION_CAP_G = 400;
export const PORTION_CAP_KCAL = 800;
/** A portion past which a meal takes a second food of the same role. */
export const COMFORTABLE_G = 250;
/** A second food's portion smaller than this is not worth it: the first food keeps the share. */
const SMALLEST_SECOND_G = 30;
/** A vegetable's portion, and how many meals of the day carry one. */
export const VEGETABLE_G = 100;
const VEGETABLE_MEALS = 2;
/** The meals before and after training take this much more carbohydrate than the others. */
export const TRAINING_CARB_WEIGHT = 1.5;

type Role = 'protein' | 'carb' | 'fat' | 'vegetable' | 'other';

/**
 * A food's role, by where its energy comes from: a vegetable is light and fibrous (under 60 kcal and
 * at least 1.5 g of fibre per 100 g); otherwise protein when 30% or more of its energy is protein,
 * carbohydrate when half or more is, fat when 60% or more is.
 */
export function roleOf(food: Per100g): Role {
  if (food.energyKcal <= 0) return 'other';
  if (food.energyKcal < 60 && food.fiberG >= 1.5) return 'vegetable';
  if ((food.proteinG * 4) / food.energyKcal >= 0.3) return 'protein';
  if ((food.carbG * 4) / food.energyKcal >= 0.5) return 'carb';
  if ((food.fatG * 9) / food.energyKcal >= 0.6) return 'fat';
  return 'other';
}

const DAY_MS = 86_400_000;
const dayNumber = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The foods in play on `date`: every food in no rotation group, and one food of each group, taken in
 * turn day by day so the week is not the same every day (S16).
 */
export function foodsOfDay(foods: PlannerFood[], date: string): PlannerFood[] {
  const day = dayNumber(date);
  const groups = new Map<string, PlannerFood[]>();
  const loose: PlannerFood[] = [];
  for (const food of foods.toSorted(byId)) {
    if (food.rotationGroupId === null) loose.push(food);
    else groups.set(food.rotationGroupId, [...(groups.get(food.rotationGroupId) ?? []), food]);
  }
  const picked = [...groups.values()].map((members) => members[day % members.length]);
  return [...loose, ...picked.filter((food) => food !== undefined)].toSorted(byId);
}

/** The most grams of a food one portion may hold. */
export function portionCap(food: PlannerFood): number {
  const byEnergy =
    food.per100g.energyKcal > 0 ? (PORTION_CAP_KCAL / food.per100g.energyKcal) * 100 : Infinity;
  const grams = Math.min(PORTION_CAP_G, byEnergy);
  if (food.pieceWeightG === null) return Math.floor(grams / GRAM_STEP) * GRAM_STEP;
  return Math.floor(grams / food.pieceWeightG) * food.pieceWeightG;
}

type Item = { food: PlannerFood; role: Role; grams: number; meal: number };

const of = (item: Item, key: keyof Per100g) => (item.grams * item.food.per100g[key]) / 100;

function totalsOf(items: Item[]): Totals {
  const sum = (key: keyof Per100g) => items.reduce((total, item) => total + of(item, key), 0);
  return {
    energyKcal: sum('energyKcal'),
    proteinG: sum('proteinG'),
    carbG: sum('carbG'),
    fatG: sum('fatG'),
    fiberG: sum('fiberG'),
  };
}

const stepOf = (food: PlannerFood) => food.pieceWeightG ?? GRAM_STEP;
const roundToStep = (food: PlannerFood, grams: number) => {
  const step = stepOf(food);
  return Math.round(grams / step) * step;
};

/** S16: one day's plan. It never returns nothing: what it cannot reach is in `shortfalls`. */
export function generateDayPlan(input: {
  date: string;
  targets: Targets;
  meals: MealSlot[];
  foods: PlannerFood[];
}): DayPlan {
  const { targets, meals, date } = input;
  const day = dayNumber(date);
  const foods = foodsOfDay(input.foods, date);
  const byRole = (role: Role) => foods.filter((food) => roleOf(food.per100g) === role);
  const proteins = byRole('protein');
  const carbs = byRole('carb');
  const fats = byRole('fat');
  const vegetables = byRole('vegetable');
  const pick = <T>(list: T[], index: number) =>
    list.length === 0 ? undefined : list[(index + day) % list.length];

  const items: Item[] = [];
  const add = (food: PlannerFood | undefined, meal: number, grams = 0) => {
    if (food === undefined) return undefined;
    const item: Item = { food, role: roleOf(food.per100g), grams: clamp(food, grams), meal };
    items.push(item);
    return item;
  };

  // A vegetable goes with the main meals: not the first, not the one before training.
  const vegetableMeals = meals
    .map((meal, index) => ({ meal, index }))
    .filter(({ meal, index }) => !meal.isPreTraining && (index > 0 || meals.length <= 2))
    .slice(0, VEGETABLE_MEALS)
    .map(({ index }) => index);
  const totalCarbWeight = meals.reduce((sum, meal) => sum + carbWeight(meal), 0);

  // Each meal: its protein food sized for an equal share of protein, its carbohydrate food for its
  // share of carbohydrate, more of it around training, solved together since each carries some of
  // the other. A food that would pass a comfortable portion stops there, and the next food of its
  // role takes the rest.
  meals.forEach((meal, index) => {
    if (vegetableMeals.includes(index)) {
      add(pick(vegetables, vegetableMeals.indexOf(index)), index, VEGETABLE_G);
    }
    const roles = [
      { list: proteins, key: 'proteinG' as const, share: targets.proteinG / meals.length },
      {
        list: carbs,
        key: 'carbG' as const,
        share: (targets.carbG * carbWeight(meal)) / totalCarbWeight,
      },
    ].map((role) => ({ ...role, items: [add(pick(role.list, index), index)].filter(isItem) }));
    const solve = () => {
      for (let round = 0; round < 8; round += 1) {
        for (const role of roles) {
          const item = role.items.at(-1);
          if (item === undefined || item.food.per100g[role.key] <= 0) continue;
          const others = items
            .filter((each) => each.meal === index && each !== item)
            .reduce((sum, each) => sum + of(each, role.key), 0);
          item.grams = clamp(
            item.food,
            ((role.share - others) / item.food.per100g[role.key]) * 100,
          );
        }
      }
    };
    solve();
    for (const role of roles) {
      const [first] = role.items;
      if (first === undefined || role.list.length < 2 || first.grams <= comfortable(first.food)) {
        continue;
      }
      const grams = first.grams;
      first.grams = comfortable(first.food);
      const second = add(pick(role.list, index + 1), index);
      if (second === undefined) continue;
      role.items.push(second);
      solve();
      // A second portion too small to bother with goes back to the first food.
      if (second.grams < SMALLEST_SECOND_G) {
        items.splice(items.indexOf(second), 1);
        role.items.pop();
        first.grams = grams;
      }
    }
  });

  // Fat fills what the day still lacks, in the meals with a vegetable, or failing those every meal
  // but the one before training.
  const fatMeals = vegetableMeals.length > 0 ? vegetableMeals : meals.map((_, index) => index);
  const fatGap = targets.fatG - totalsOf(items).fatG;
  if (fats.length > 0 && fatGap > 0) {
    fatMeals.forEach((meal, index) => {
      const food = pick(fats, index);
      if (food === undefined || food.per100g.fatG <= 0) return;
      add(food, meal, clamp(food, (fatGap / fatMeals.length / food.per100g.fatG) * 100));
    });
  }

  balanceEnergy(items, targets.energyKcal, false);
  for (const item of items) item.grams = roundToStep(item.food, item.grams);
  for (let round = 0; round < 4; round += 1) {
    fixProtein(items, targets);
    balanceEnergy(items, targets.energyKcal, true);
  }

  const kept = items.filter((item) => item.grams > 0);
  const planned = totalsOf(kept);
  return {
    meals: meals.map((meal, index) => ({
      ...meal,
      items: kept
        .filter((item) => item.meal === index)
        .map((item) => ({
          foodId: item.food.id,
          grams: item.grams,
          pieces:
            item.food.pieceWeightG === null
              ? null
              : Math.round(item.grams / item.food.pieceWeightG),
        })),
    })),
    planned: roundTotals(planned),
    shortfalls: shortfallsOf(items, planned, targets),
  };
}

const isItem = (item: Item | undefined): item is Item => item !== undefined;

/**
 * A portion past which a meal is better split between two foods of a role: 250 g, or three pieces.
 */
export function comfortable(food: PlannerFood): number {
  const cap = portionCap(food);
  if (food.pieceWeightG === null) return Math.min(COMFORTABLE_G, cap);
  return Math.min(
    cap,
    Math.max(1, Math.min(3, Math.floor(COMFORTABLE_G / food.pieceWeightG))) * food.pieceWeightG,
  );
}

const carbWeight = (meal: MealSlot) =>
  meal.isPreTraining || meal.isPostTraining ? TRAINING_CARB_WEIGHT : 1;

function clamp(food: PlannerFood, grams: number) {
  return Math.max(0, Math.min(portionCap(food), Number.isFinite(grams) ? grams : 0));
}

/**
 * Brings the day's calories towards the target with carbohydrate first, then fat, and never with
 * protein, which is sized by protein alone. Over the target, fat goes first, then carbohydrate,
 * and protein last of all, which is how a protein shortfall arises. Continuous before rounding;
 * afterwards in whole steps, stopping inside 4% so a step cannot carry it past 5%.
 */
function balanceEnergy(items: Item[], target: number, stepped: boolean) {
  const band = stepped ? target * (KCAL_TOLERANCE - 0.01) : 0;
  const fill = items.filter((item) => item.role === 'carb' || item.role === 'other');
  const fat = items.filter((item) => item.role === 'fat');
  const protein = items.filter((item) => item.role === 'protein');
  const energy = () => totalsOf(items).energyKcal;

  if (!stepped) {
    for (const group of [fill, fat]) {
      const gap = target - energy();
      if (gap <= 0) break;
      grow(group, gap);
    }
    for (const group of [fat, fill, protein]) {
      const excess = energy() - target;
      if (excess <= 0) break;
      shrink(group, excess);
    }
    return;
  }

  for (let guard = 0; guard < 400; guard += 1) {
    const gap = target - energy();
    if (Math.abs(gap) <= band) return;
    if (gap > 0) {
      // The food furthest under its cap takes the step: portions grow evenly.
      const candidates = [...fill, ...fat].filter(
        (item) => item.grams + stepOf(item.food) <= portionCap(item.food),
      );
      const next = candidates.toSorted(
        (a, b) => a.grams / portionCap(a.food) - b.grams / portionCap(b.food) || byItem(a, b),
      )[0];
      if (next === undefined) return;
      next.grams += stepOf(next.food);
    } else {
      const order = [fat, fill, protein].find((group) => group.some((item) => item.grams > 0));
      const next = order
        ?.filter((item) => item.grams > 0)
        .toSorted((a, b) => of(b, 'energyKcal') - of(a, 'energyKcal') || byItem(a, b))[0];
      if (next === undefined) return;
      // A step that overshoots below the band by more than it was over is not taken.
      const after = gap + of({ ...next, grams: stepOf(next.food) }, 'energyKcal');
      if (after > band && Math.abs(after) >= Math.abs(gap)) return;
      next.grams -= stepOf(next.food);
    }
  }
}

function grow(group: Item[], kcal: number) {
  const energy = group.reduce((sum, item) => sum + of(item, 'energyKcal'), 0);
  if (energy <= 0) {
    // Nothing of the group is planned yet: share the gap evenly.
    const room = group.filter((item) => item.food.per100g.energyKcal > 0);
    for (const item of room) {
      item.grams = clamp(item.food, (kcal / room.length / item.food.per100g.energyKcal) * 100);
    }
    return;
  }
  const factor = (energy + kcal) / energy;
  for (const item of group) item.grams = clamp(item.food, item.grams * factor);
}

function shrink(group: Item[], kcal: number) {
  const energy = group.reduce((sum, item) => sum + of(item, 'energyKcal'), 0);
  if (energy <= 0) return;
  const factor = Math.max(0, (energy - kcal) / energy);
  for (const item of group) item.grams = clamp(item.food, item.grams * factor);
}

const byItem = (a: Item, b: Item) => a.meal - b.meal || byId(a.food, b.food);

/**
 * Brings protein within 4 g of the target in whole steps of the protein foods only, so a gap is
 * never filled with protein from rice. A step that would carry calories past 5% over is not taken.
 */
function fixProtein(items: Item[], targets: Targets) {
  const protein = items.filter((item) => item.role === 'protein');
  const ceiling = targets.energyKcal * (1 + KCAL_TOLERANCE);
  for (let guard = 0; guard < 400; guard += 1) {
    const totals = totalsOf(items);
    const gap = targets.proteinG - totals.proteinG;
    if (Math.abs(gap) <= PROTEIN_TOLERANCE_G - 1) return;
    if (gap > 0) {
      const next = protein
        .filter((item) => item.grams + stepOf(item.food) <= portionCap(item.food))
        .filter(
          (item) =>
            totals.energyKcal + of({ ...item, grams: stepOf(item.food) }, 'energyKcal') <= ceiling,
        )
        // The leanest source first: the most protein for the calories, then the smallest portion.
        .toSorted(
          (a, b) =>
            b.food.per100g.proteinG / b.food.per100g.energyKcal -
              a.food.per100g.proteinG / a.food.per100g.energyKcal ||
            a.grams - b.grams ||
            byItem(a, b),
        )[0];
      if (next === undefined) return;
      next.grams += stepOf(next.food);
    } else {
      const next = protein
        .filter((item) => item.grams > 0)
        .toSorted((a, b) => b.grams - a.grams || byItem(a, b))[0];
      if (next === undefined) return;
      const after = -gap - of({ ...next, grams: stepOf(next.food) }, 'proteinG');
      if (after < -(PROTEIN_TOLERANCE_G - 1) && Math.abs(after) >= Math.abs(gap)) return;
      next.grams -= stepOf(next.food);
    }
  }
}

function shortfallsOf(items: Item[], planned: Totals, targets: Targets): Shortfall[] {
  const shortfalls: Shortfall[] = [];
  const missingProtein = targets.proteinG - planned.proteinG;
  if (missingProtein > PROTEIN_TOLERANCE_G) {
    shortfalls.push({
      target: 'protein',
      missingG: Math.round(missingProtein),
      suggestion: 'add_protein_source',
    });
  }
  const missingKcal = targets.energyKcal - planned.energyKcal;
  if (missingKcal > targets.energyKcal * KCAL_TOLERANCE) {
    const capped = items.some(
      (item) => item.role !== 'protein' && item.grams + stepOf(item.food) > portionCap(item.food),
    );
    shortfalls.push({
      target: 'energy',
      missingKcal: Math.round(missingKcal),
      cause: capped ? 'portion_cap' : 'foods',
      suggestion: capped ? null : 'add_food',
    });
  }
  return shortfalls;
}

const roundTotals = (totals: Totals): Totals => ({
  energyKcal: Math.round(totals.energyKcal),
  proteinG: Math.round(totals.proteinG * 10) / 10,
  carbG: Math.round(totals.carbG * 10) / 10,
  fatG: Math.round(totals.fatG * 10) / 10,
  fiberG: Math.round(totals.fiberG * 10) / 10,
});
