import { describe, expect, it } from 'vitest';
import { mealTimes, recommendMeals, trainingMeals } from '../src/domain/meals';
import {
  foodsOfDay,
  generateDayPlan,
  GRAM_STEP,
  portionCap,
  roleOf,
  type PlannerFood,
} from '../src/domain/planner';
import { macroTargets } from '../src/domain/targets';

// S16's planner and S15's recommendation (docs/03 §8.2, docs/11 §2): the tolerances, 5 g rounding,
// whole pieces, the portion cap, carbohydrate around training, rotation, determinism, and a food
// list that cannot meet a target giving the closest plan with its shortfall named.

const food = (
  id: string,
  energyKcal: number,
  proteinG: number,
  carbG: number,
  fatG: number,
  fiberG = 0,
  extra: Partial<PlannerFood> = {},
): PlannerFood => ({
  id,
  per100g: { energyKcal, proteinG, carbG, fatG, fiberG },
  pieceWeightG: null,
  rotationGroupId: null,
  ...extra,
});

// Close to MEXT's values; cooked weights for the batch-cooked foods.
const chicken = food('f-chicken', 140, 31.1, 0.1, 2.5);
const salmon = food('f-salmon', 124, 22.3, 0.1, 4.1, 0, { rotationGroupId: 'g-protein' });
const rice = food('f-rice', 156, 2.5, 37.1, 0.3, 1.5, { rotationGroupId: 'g-starch' });
const potato = food('f-potato', 70, 1.8, 15.8, 0.1, 1.5, { rotationGroupId: 'g-starch' });
const oats = food('f-oats', 350, 13.7, 69.1, 5.7, 9.4);
const broccoli = food('f-broccoli', 30, 3.9, 5.2, 0.4, 4.3);
const egg = food('f-egg', 142, 12.2, 0.4, 10.2, 0, { pieceWeightG: 55 });
const yogurt = food('f-yogurt', 59, 10.3, 3.6, 0.4);
const banana = food('f-banana', 93, 1.1, 22.5, 0.2, 1.1, { pieceWeightG: 100 });
const oil = food('f-oil', 894, 0, 0, 100);

const list = [chicken, salmon, rice, potato, oats, broccoli, egg, yogurt, banana, oil];
const targets = macroTargets(
  { calorieTargetKcal: 2350, proteinGPerKg: 2.2, fatPctCalories: 25 },
  82.4,
);
const trainingDay = mealTimes(
  { dayType: 'training', wakeTime: '06:30', bedTime: '23:00', trainingTime: '18:30' },
  5,
);
const restDay = mealTimes(
  { dayType: 'rest', wakeTime: '07:30', bedTime: '23:00', trainingTime: null },
  4,
);

const items = (plan: ReturnType<typeof generateDayPlan>) => plan.meals.flatMap((m) => m.items);
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const used = (date: string) =>
  new Set(
    items(generateDayPlan({ date, targets, meals: restDay, foods: list })).map((i) => i.foodId),
  );
const foodOf = (id: string) => list.find((each) => each.id === id);

describe('generateDayPlan', () => {
  it.each([
    { date: '2026-10-16', meals: trainingDay },
    { date: '2026-10-17', meals: restDay },
    { date: '2026-10-18', meals: trainingDay },
    { date: '2026-10-19', meals: restDay },
  ])('is within ±5% of calories and ±5 g of protein on $date', ({ date, meals }) => {
    const plan = generateDayPlan({ date, targets, meals, foods: list });
    expect(Math.abs(plan.planned.energyKcal - targets.energyKcal)).toBeLessThanOrEqual(
      targets.energyKcal * 0.05,
    );
    expect(Math.abs(plan.planned.proteinG - targets.proteinG)).toBeLessThanOrEqual(5);
    expect(plan.shortfalls).toEqual([]);
  });

  it('rounds grams to 5 g and keeps pieces whole', () => {
    const plan = generateDayPlan({ date: '2026-10-16', targets, meals: trainingDay, foods: list });
    const planned = items(plan);
    const byGram = planned.filter((item) => foodOf(item.foodId)?.pieceWeightG == null);
    const byPiece = planned.filter((item) => foodOf(item.foodId)?.pieceWeightG != null);
    expect(byPiece.length).toBeGreaterThan(0);
    expect(byGram.filter((item) => item.grams % GRAM_STEP !== 0 || item.pieces !== null)).toEqual(
      [],
    );
    expect(
      byPiece.filter(
        (item) =>
          !Number.isInteger(item.pieces) ||
          item.grams !== (item.pieces ?? 0) * (foodOf(item.foodId)?.pieceWeightG ?? 0),
      ),
    ).toEqual([]);
    expect(planned.filter((item) => item.grams <= 0)).toEqual([]);
  });

  it('never plans a portion over the cap', () => {
    // Rice alone against a big target would need far more than one sensible portion.
    const big = macroTargets(
      { calorieTargetKcal: 4200, proteinGPerKg: 1.6, fatPctCalories: 15 },
      82,
    );
    const plan = generateDayPlan({
      date: '2026-10-16',
      targets: big,
      meals: restDay.slice(0, 3),
      foods: [chicken, food('f-rice2', 156, 2.5, 37.1, 0.3)],
    });
    for (const item of items(plan)) {
      const each = item.foodId === chicken.id ? chicken : food('f-rice2', 156, 2.5, 37.1, 0.3);
      expect(item.grams).toBeLessThanOrEqual(portionCap(each));
    }
    expect(plan.shortfalls).toContainEqual(
      expect.objectContaining({ target: 'energy', cause: 'portion_cap', suggestion: null }),
    );
  });

  it('names a protein shortfall in grams and pads nothing to hide it', () => {
    // Fatty, low protein sources: reaching 181 g would go far over calories.
    const weak = [food('f-tofu', 73, 7, 1.5, 4.9, 1.1), rice, oil];
    const plan = generateDayPlan({ date: '2026-10-16', targets, meals: trainingDay, foods: weak });
    const shortfall = plan.shortfalls.find((each) => each.target === 'protein');
    expect(shortfall).toMatchObject({ target: 'protein', suggestion: 'add_protein_source' });
    expect(shortfall?.target === 'protein' && shortfall.missingG).toBe(
      Math.round(targets.proteinG - plan.planned.proteinG),
    );
    expect(plan.planned.energyKcal).toBeLessThanOrEqual(targets.energyKcal * 1.05);
    // Rice is sized for carbohydrate and calories, not grown to carry the missing protein.
    const riceGrams = items(plan)
      .filter((item) => item.foodId === rice.id)
      .reduce((sum, item) => sum + item.grams, 0);
    expect((riceGrams * 37.1) / 100).toBeLessThanOrEqual(targets.carbG * 1.3);
  });

  it('returns the closest plan, never nothing, from a list with no carbohydrate', () => {
    const plan = generateDayPlan({
      date: '2026-10-16',
      targets,
      meals: restDay,
      foods: [chicken],
    });
    expect(items(plan).length).toBeGreaterThan(0);
    expect(plan.shortfalls).toContainEqual(
      expect.objectContaining({ target: 'energy', cause: 'foods', suggestion: 'add_food' }),
    );
  });

  it('puts more carbohydrate in the meals before and after training', () => {
    const plan = generateDayPlan({ date: '2026-10-16', targets, meals: trainingDay, foods: list });
    const carbs = plan.meals.map((meal) => ({
      training: meal.isPreTraining || meal.isPostTraining,
      carbG: meal.items.reduce((sum, item) => {
        const each = foodOf(item.foodId);
        return sum + (each === undefined ? 0 : (item.grams * each.per100g.carbG) / 100);
      }, 0),
    }));
    const around = carbs.filter((meal) => meal.training).map((meal) => meal.carbG);
    const rest = carbs.filter((meal) => !meal.training).map((meal) => meal.carbG);
    expect(around).toHaveLength(2);
    expect(Math.min(...around)).toBeGreaterThan(Math.max(...rest) * 0.9);
    expect(mean(around)).toBeGreaterThan(mean(rest));
  });

  it('spreads protein evenly across the meals', () => {
    const plan = generateDayPlan({ date: '2026-10-17', targets, meals: restDay, foods: list });
    const perMeal = plan.meals.map((meal) =>
      meal.items.reduce((sum, item) => {
        const each = foodOf(item.foodId);
        return sum + (each === undefined ? 0 : (item.grams * each.per100g.proteinG) / 100);
      }, 0),
    );
    for (const grams of perMeal) expect(grams / 82.4).toBeGreaterThan(0.3);
  });

  it('is deterministic', () => {
    const input = { date: '2026-10-16', targets, meals: trainingDay, foods: list };
    expect(generateDayPlan(input)).toEqual(generateDayPlan({ ...input, foods: list.toReversed() }));
  });

  it('rotates between the foods of a group from one day to the next', () => {
    const today = used('2026-10-16');
    const tomorrow = used('2026-10-17');
    expect(today.has(rice.id)).not.toBe(today.has(potato.id));
    expect(today.has(rice.id)).toBe(tomorrow.has(potato.id));
  });
});

describe('roles and rotation', () => {
  it('reads a food’s role from where its energy comes from', () => {
    expect([chicken, oats, oil, broccoli, egg, yogurt].map((each) => roleOf(each.per100g))).toEqual(
      ['protein', 'carb', 'fat', 'vegetable', 'protein', 'protein'],
    );
  });

  it('takes one food of each group a day and every loose food', () => {
    const day = foodsOfDay(list, '2026-10-16').map((each) => each.id);
    expect(day).toContain(chicken.id);
    expect(day.filter((id) => id === rice.id || id === potato.id)).toHaveLength(1);
  });

  it('caps a portion at 400 g or 800 kcal, in whole pieces', () => {
    expect(portionCap(rice)).toBe(400);
    expect(portionCap(oats)).toBe(225);
    expect(portionCap(egg)).toBe(385);
  });
});

describe('recommendMeals', () => {
  const training = {
    dayType: 'training' as const,
    wakeTime: '06:30',
    bedTime: '23:00',
    trainingTime: '18:30',
  };
  const rest = {
    dayType: 'rest' as const,
    wakeTime: '07:30',
    bedTime: '23:00',
    trainingTime: null,
  };

  it('recommends five meals on a training day and four on a rest day, as drawn', () => {
    const day = recommendMeals(training, 181, 82.4);
    expect(day.recommendedCount).toBe(5);
    expect(day.slots.map((slot) => [slot.time, slot.label])).toEqual([
      ['07:00', 'Breakfast'],
      ['11:45', 'Lunch'],
      ['16:30', 'Before training'],
      ['19:45', 'After training'],
      ['21:30', 'Evening'],
    ]);
    expect(day.perMeal).toBe('inside');
    expect(day.proteinPerMealGPerKg).toBe(0.44);
    expect(recommendMeals(rest, 181, 82.4).slots.map((slot) => [slot.time, slot.label])).toEqual([
      ['08:00', 'Breakfast'],
      ['12:30', 'Lunch'],
      ['17:00', 'Afternoon'],
      ['21:30', 'Dinner'],
    ]);
  });

  it('marks the meals before and after training', () => {
    const slots = recommendMeals(training, 181, 82.4).slots;
    expect(slots.filter((slot) => slot.isPreTraining).map((slot) => slot.time)).toEqual(['16:30']);
    expect(slots.filter((slot) => slot.isPostTraining).map((slot) => slot.time)).toEqual(['19:45']);
    expect(
      trainingMeals(
        slots.map((slot) => slot.time),
        '18:30',
      ),
    ).toEqual({ pre: 2, post: 3 });
  });

  it('keeps four meals when protein is 0.55 g/kg a meal but for rounding', () => {
    // 2.2 g/kg at 82.8 kg is 182.2 g, a hair over four meals of 0.55 g/kg.
    expect(recommendMeals(rest, 182.2, 82.8).recommendedCount).toBe(4);
  });

  it('takes more meals when protein would pass 0.55 g/kg a meal', () => {
    expect(recommendMeals(rest, 260, 82.4).recommendedCount).toBe(6);
  });

  it('says when the day leaves room for fewer than four meals', () => {
    const short = {
      dayType: 'rest' as const,
      wakeTime: '09:00',
      bedTime: '15:00',
      trainingTime: null,
    };
    const day = recommendMeals(short, 181, 82.4);
    expect(day.roomFor).toBe(3);
    expect(day.recommendedCount).toBe(3);
    expect(day.perMeal).toBe('above');
  });

  it('gives the times and protein of the count the user chose', () => {
    const day = recommendMeals(training, 181, 82.4, 4);
    expect(day.recommendedCount).toBe(5);
    expect(day.mealCount).toBe(4);
    expect(day.proteinPerMealG).toBe(45.3);
    expect(day.perMeal).toBe('inside');
  });

  it('reads a bedtime after midnight as the same night', () => {
    const late = {
      dayType: 'rest' as const,
      wakeTime: '09:00',
      bedTime: '01:00',
      trainingTime: null,
    };
    expect(mealTimes(late, 4).at(-1)?.time).toBe('23:30');
  });
});
