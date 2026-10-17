// S15's meal count and times (docs/02 S15): how many meals spread the day's protein at 0.4–0.55 g/kg
// each across at least four where the day allows (Schoenfeld & Aragon 2018), and when they fall. The
// count changes nothing for fat loss at equal calories (Schoenfeld 2015); it is for protein only.
// Wall-clock times are `HH:MM` strings.

export type DayType = 'training' | 'rest';

/** One meal in the day's shape. */
export type MealSlot = {
  position: number;
  time: string;
  label: string;
  isPreTraining: boolean;
  isPostTraining: boolean;
};

export type DayShape = {
  dayType: DayType;
  wakeTime: string;
  bedTime: string;
  trainingTime: string | null;
};

/** Protein per meal, g per kg of bodyweight (Schoenfeld & Aragon 2018). */
export const PROTEIN_PER_MEAL_G_PER_KG: [number, number] = [0.4, 0.55];
/** At least this many meals where the day leaves room (S15). */
export const MIN_RECOMMENDED_MEALS = 4;
/** Most the screen offers. */
export const MAX_MEALS = 8;
/** The first meal comes this long after waking, the last this long before bed. */
const AFTER_WAKE = 30;
const BEFORE_BED = 90;
/** Meals sit at least this far apart. */
const MIN_GAP = 90;
/** The meal before training sits about 2 hours ahead of it, the one after soon after it ends. */
const PRE_TRAINING = 120;
const POST_TRAINING = 75;

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const clock = (total: number) => {
  const rounded = (((Math.round(total / 5) * 5) % 1440) + 1440) % 1440;
  return `${String(Math.floor(rounded / 60)).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}`;
};

/** The waking window meals fall in, in minutes from the wake day's midnight. */
function window(shape: DayShape) {
  const wake = minutes(shape.wakeTime);
  let bed = minutes(shape.bedTime);
  if (bed <= wake) bed += 1440;
  const start = wake + AFTER_WAKE;
  return { start, end: Math.max(start, bed - BEFORE_BED), wake, bed };
}

/** How many meals the waking day has room for, at least 90 minutes apart. */
export function roomFor(shape: DayShape): number {
  const { start, end } = window(shape);
  return Math.min(MAX_MEALS, Math.floor((end - start) / MIN_GAP) + 1);
}

/**
 * The recommended count: enough meals to keep each at or under 0.55 g/kg, and at least four; on a
 * training day five when 0.4 g/kg a meal allows it, so one meal sits before training and one after
 * with three others. Never more than the day has room for.
 */
export function recommendedMealCount(shape: DayShape, proteinG: number, weightKg: number): number {
  const [low, high] = PROTEIN_PER_MEAL_G_PER_KG;
  const fewest = Math.ceil(proteinG / (high * weightKg));
  const most = Math.floor(proteinG / (low * weightKg));
  let count = Math.max(MIN_RECOMMENDED_MEALS, fewest);
  if (shape.dayType === 'training' && shape.trainingTime !== null && count < 5 && most >= 5) {
    count = 5;
  }
  return Math.max(1, Math.min(count, 6, roomFor(shape)));
}

/** A meal placed in minutes from the wake day's midnight, before it is given its clock time. */
type Timed = { total: number; label: string; isPreTraining: boolean; isPostTraining: boolean };
const slot = (total: number, label: string, pre = false, post = false): Timed => ({
  total,
  label,
  isPreTraining: pre,
  isPostTraining: post,
});

const REST_LABELS = ['Breakfast', 'Lunch', 'Afternoon', 'Dinner', 'Evening', 'Late'];

/** A meal's name by its place in the day (docs/06, 2026-10-16, Q19). */
function labelAt(total: number) {
  const time = ((total % 1440) + 1440) % 1440;
  if (time < 10 * 60 + 30) return 'Breakfast';
  if (time < 14 * 60 + 30) return 'Lunch';
  if (time < 17 * 60 + 30) return 'Afternoon';
  if (time < 20 * 60 + 30) return 'Dinner';
  return 'Evening';
}

/**
 * The times and names of `count` meals. A rest day spreads them evenly from 30 minutes after waking
 * to 90 minutes before bed. A training day puts one about 2 hours before training and one 75 minutes
 * after it starts, then the rest where there is most room, one in the evening when there is room
 * for it.
 */
export function mealTimes(shape: DayShape, count: number): MealSlot[] {
  const { start, end, wake } = window(shape);
  const n = Math.max(1, Math.min(count, MAX_MEALS));
  let slots: Timed[];

  if (shape.dayType === 'rest' || shape.trainingTime === null) {
    const step = n === 1 ? 0 : (end - start) / (n - 1);
    const labels = n === 3 ? ['Breakfast', 'Lunch', 'Dinner'] : REST_LABELS;
    slots = Array.from({ length: n }, (_, i) => slot(start + step * i, labels[i] ?? 'Meal'));
  } else {
    let training = minutes(shape.trainingTime);
    if (training < wake) training += 1440;
    const fixed: Timed[] = [];
    const post = training + POST_TRAINING;
    if (post <= end + BEFORE_BED - 30) fixed.push(slot(post, 'After training', false, true));
    if (training - 60 >= start && n >= 2) {
      fixed.unshift(slot(Math.max(start, training - PRE_TRAINING), 'Before training', true));
    }
    const others = Math.max(0, n - fixed.length);
    const first = fixed[0]?.total ?? start;
    const last = fixed.at(-1)?.total ?? start;
    // The free time before the first anchor and after the last, and how many meals each takes. A
    // segment holds a meal for every 90 minutes, so the nearest stays that far from the anchor.
    const before = { length: first - start, count: 0 };
    const after = { length: end - last, count: 0 };
    const capacity = (segment: typeof before) => Math.max(0, Math.floor(segment.length / MIN_GAP));
    if (fixed.length > 0 && others >= 2 && capacity(after) >= 1) after.count = 1;
    for (let placed = after.count; placed < others; placed += 1) {
      const roomBefore = fixed.length > 0 && capacity(before) > before.count;
      const roomAfter = capacity(after) > after.count;
      if (!roomBefore && !roomAfter) break;
      const spacingBefore = roomBefore ? before.length / (before.count + 1) : -1;
      const spacingAfter = roomAfter ? after.length / (after.count + 1) : -1;
      if (spacingBefore >= spacingAfter) before.count += 1;
      else after.count += 1;
    }
    const early = Array.from(
      { length: before.count },
      (_, i) => start + (before.length / before.count) * i,
    );
    const late = Array.from(
      { length: after.count },
      (_, i) => end - (after.length / after.count) * i,
    );
    slots = [...fixed, ...[...early, ...late].map((total) => slot(total, labelAt(total)))].toSorted(
      (a, b) => a.total - b.total,
    );
  }

  // Two meals of one name are told apart by their place.
  const seen = new Map<string, number>();
  return slots.map((each, index) => {
    const times = (seen.get(each.label) ?? 0) + 1;
    seen.set(each.label, times);
    return {
      position: index + 1,
      time: clock(each.total),
      label: times === 1 ? each.label : `${each.label} ${times}`,
      isPreTraining: each.isPreTraining,
      isPostTraining: each.isPostTraining,
    };
  });
}

/**
 * Which stored meals are the ones before and after training, read from their times: the last meal
 * from 4 hours to 30 minutes before it, and the first within 3 hours after it starts. A rest day has
 * neither.
 */
export function trainingMeals(
  times: string[],
  trainingTime: string | null,
): { pre: number | null; post: number | null } {
  if (trainingTime === null) return { pre: null, post: null };
  const training = minutes(trainingTime);
  let pre: number | null = null;
  let post: number | null = null;
  times.forEach((time, index) => {
    const delta = minutes(time) - training;
    if (delta >= -240 && delta <= -30) pre = index;
    if (post === null && delta > 0 && delta <= 180) post = index;
  });
  return { pre, post };
}

export type Recommendation = {
  recommendedCount: number;
  mealCount: number;
  /** The most meals the waking day has room for. */
  roomFor: number;
  slots: MealSlot[];
  proteinPerMealG: number;
  proteinPerMealGPerKg: number;
  /** Where the per-meal protein falls against 0.4–0.55 g/kg. */
  perMeal: 'inside' | 'above' | 'below';
};

/** S15: the recommendation, and the times and protein of the count shown (the user's or ours). */
export function recommendMeals(
  shape: DayShape,
  proteinG: number,
  weightKg: number,
  mealCount?: number,
): Recommendation {
  const recommendedCount = recommendedMealCount(shape, proteinG, weightKg);
  const count = Math.max(1, Math.min(mealCount ?? recommendedCount, MAX_MEALS));
  const slots = mealTimes(shape, count);
  const proteinPerMealG = Math.round((proteinG / slots.length) * 10) / 10;
  const perKg = Math.round((proteinG / slots.length / weightKg) * 100) / 100;
  const [low, high] = PROTEIN_PER_MEAL_G_PER_KG;
  return {
    recommendedCount,
    mealCount: slots.length,
    roomFor: roomFor(shape),
    slots,
    proteinPerMealG,
    proteinPerMealGPerKg: perKg,
    perMeal: perKg > high ? 'above' : perKg < low ? 'below' : 'inside',
  };
}
