// S16's plan for a run of days (docs/07 §4, Plan days): which day type each date is, what is still
// missing before a plan can be made (docs/09 F10), and the days themselves from the planner. Pure:
// the routes read the inputs and write what this returns.

import { trainingMeals, type DayType } from './meals.js';
import { generateDayPlan, type Per100g, type Shortfall } from './planner.js';
import type { Targets } from './targets.js';

/** The four prerequisites of a plan, in the order Today asks for them (docs/09 F10). */
export type SetupStep = 'profile' | 'foods' | 'goal_phase' | 'day_routine';

const DAY_MS = 86_400_000;

/** The ISO weekday of a local date, 1 = Monday. */
export const isoWeekday = (date: string) =>
  ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

/** A date is a training day when its weekday is one the routine trains on (S15). */
export const dayTypeOf = (date: string, trainingWeekdays: number[]): DayType =>
  trainingWeekdays.includes(isoWeekday(date)) ? 'training' : 'rest';

/** The day types a week needs a routine for: training if any day trains, rest if any does not. */
export const neededDayTypes = (trainingWeekdays: number[]): DayType[] => [
  ...(trainingWeekdays.length > 0 ? (['training'] as const) : []),
  ...(new Set(trainingWeekdays).size < 7 ? (['rest'] as const) : []),
];

/** What is missing before a plan can be made, in the order Today asks for it. */
export function missingSetup(input: {
  /** Height, sex and birth date set, and a weigh-in to set targets by. */
  profileComplete: boolean;
  foodCount: number;
  hasOpenPhase: boolean;
  trainingWeekdays: number[];
  routineDayTypes: DayType[];
}): SetupStep[] {
  const missing: SetupStep[] = [];
  if (!input.profileComplete) missing.push('profile');
  if (input.foodCount === 0) missing.push('foods');
  if (!input.hasOpenPhase) missing.push('goal_phase');
  const needed = neededDayTypes(input.trainingWeekdays);
  if (needed.some((type) => !input.routineDayTypes.includes(type))) missing.push('day_routine');
  return missing;
}

/** Every local date from `from` to `to`, both included. */
export function datesBetween(from: string, to: string): string[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  const dates: string[] = [];
  for (let at = start; at <= end; at += DAY_MS) dates.push(new Date(at).toISOString().slice(0, 10));
  return dates;
}

export type PlanningFood = {
  id: string;
  name: string;
  per100g: Per100g;
  pieceWeightG: number | null;
  rotationGroupId: string | null;
  cooked: boolean;
  approximate: boolean;
};

export type PlanningRoutine = {
  trainingTime: string | null;
  slots: { position: number; time: string; label: string | null }[];
};

export type PlannedDay = {
  date: string;
  dayType: DayType;
  goalPhaseId: string | null;
  targets: Targets;
  shortfalls: Shortfall[];
  meals: {
    position: number;
    plannedTime: string;
    label: string | null;
    isPreTraining: boolean;
    isPostTraining: boolean;
    items: {
      foodId: string;
      name: string;
      plannedGrams: number;
      pieceCount: number | null;
      cooked: boolean;
      approximate: boolean;
      per100g: Per100g;
    }[];
  }[];
};

/** S16: each date's plan, from the targets in force, the routine of its day type and the foods. */
export function planDates(input: {
  dates: string[];
  trainingWeekdays: number[];
  routines: Partial<Record<DayType, PlanningRoutine>>;
  targets: Targets;
  goalPhaseId: string | null;
  foods: PlanningFood[];
}): PlannedDay[] {
  return input.dates.flatMap((date) => {
    const dayType = dayTypeOf(date, input.trainingWeekdays);
    const routine = input.routines[dayType];
    if (routine === undefined) return [];
    const { pre, post } = trainingMeals(
      routine.slots.map((slot) => slot.time),
      dayType === 'training' ? routine.trainingTime : null,
      routine.wakeTime,
    );
    const meals = routine.slots.map((slot, index) => ({
      position: slot.position,
      time: slot.time,
      label: slot.label ?? `Meal ${slot.position}`,
      isPreTraining: index === pre,
      isPostTraining: index === post,
    }));
    const plan = generateDayPlan({ date, targets: input.targets, meals, foods: input.foods });
    const foodOf = new Map(input.foods.map((each) => [each.id, each]));
    return [
      {
        date,
        dayType,
        goalPhaseId: input.goalPhaseId,
        targets: input.targets,
        shortfalls: plan.shortfalls,
        meals: plan.meals.map((meal, index) => ({
          position: meal.position,
          plannedTime: meal.time,
          label: routine.slots[index]?.label ?? null,
          isPreTraining: meal.isPreTraining,
          isPostTraining: meal.isPostTraining,
          items: meal.items.flatMap((item) => {
            const each = foodOf.get(item.foodId);
            if (each === undefined) return [];
            return [
              {
                foodId: each.id,
                name: each.name,
                plannedGrams: item.grams,
                pieceCount: item.pieces,
                cooked: each.cooked,
                approximate: each.approximate,
                per100g: each.per100g,
              },
            ];
          }),
        })),
      },
    ];
  });
}

const zeroTotals = (): Per100g => ({ energyKcal: 0, proteinG: 0, carbG: 0, fatG: 0, fiberG: 0 });

function addTo(totals: Per100g, grams: number, per100g: Per100g) {
  totals.energyKcal += (grams * per100g.energyKcal) / 100;
  totals.proteinG += (grams * per100g.proteinG) / 100;
  totals.carbG += (grams * per100g.carbG) / 100;
  totals.fatG += (grams * per100g.fatG) / 100;
  totals.fiberG += (grams * per100g.fiberG) / 100;
}

const roundTotals = (totals: Per100g): Per100g => ({
  energyKcal: Math.round(totals.energyKcal),
  proteinG: Math.round(totals.proteinG * 10) / 10,
  carbG: Math.round(totals.carbG * 10) / 10,
  fatG: Math.round(totals.fatG * 10) / 10,
  fiberG: Math.round(totals.fiberG * 10) / 10,
});

/** A day's totals from its items: planned grams, or what was eaten once a meal is confirmed. */
export function dayTotals(
  meals: {
    status: string;
    items: { plannedGrams: number | null; actualGrams: number | null; per100g: Per100g }[];
  }[],
): { planned: Per100g; confirmed: Per100g } {
  const planned = zeroTotals();
  const confirmed = zeroTotals();
  for (const meal of meals) {
    for (const item of meal.items) {
      addTo(planned, item.plannedGrams ?? 0, item.per100g);
      if (meal.status === 'planned' || meal.status === 'skipped') continue;
      const eaten =
        meal.status === 'as_planned' ? item.plannedGrams : (item.actualGrams ?? item.plannedGrams);
      addTo(confirmed, eaten ?? 0, item.per100g);
    }
  }
  return { planned: roundTotals(planned), confirmed: roundTotals(confirmed) };
}
