// S18a's maintenance check (docs/03 §8.3, method `weight_trend_balance_v1`; docs/07 §5): mean
// confirmed intake on the complete days of the trailing 14 calendar days, next to how far the
// weight trend moved, and the maintenance that implies. Read-only: it never sets a target. Applying
// it is the user's own PATCH of the phase (docs/09 F13). Local dates are `YYYY-MM-DD` strings.

import { CALORIE_TARGET_KCAL, KCAL_PER_KG, type PhaseType } from './targets.js';
import { trendSeries, type DailyWeight } from './weight.js';

export const MAINTENANCE_METHOD = 'weight_trend_balance_v1';
/** The trailing window, today included, in calendar days (S18a, S21). */
export const WINDOW_DAYS = 14;
/** Complete days in total before the check shows a figure (S18a). */
export const COMPLETE_DAYS_NEEDED = 14;
/** The window's newest days, read for recent logging and a recent weigh-in. */
export const RECENT_DAYS = 7;
/** Fewer complete days than this in the newest 7 labels the figure (S18a). */
export const RECENT_COMPLETE_MIN = 5;
/** Fewer weighed days than this in the window gives no estimate (docs/03 §8.3). */
export const WINDOW_WEIGH_INS_MIN = 3;

/** A complete day and what was confirmed eaten on it. */
export type CompleteDay = { date: string; energyKcal: number };

const DAY_MS = 86_400_000;
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;
const addDays = (date: string, days: number) =>
  new Date((dayNumber(date) + days) * DAY_MS).toISOString().slice(0, 10);
const round = (value: number, places = 0) => Math.round(value * 10 ** places) / 10 ** places;
const tens = (value: number) => Math.round(value / 10) * 10;

/**
 * Expenditure over a window by energy balance (docs/03 §8.3): mean intake on its complete days, less
 * the trend's rate × 7,700. The trend starts on the day before the window, or, with no weigh-in by
 * then, at the window's first weigh-in; it ends at the window's last weigh-in. Null with fewer than
 * 3 weighed days in the window, none in its newest 7, or no complete day in it.
 */
export function windowExpenditure(input: {
  window: { from: string; to: string };
  completeDays: CompleteDay[];
  /** Every daily weight, oldest first: the trend runs from the first. */
  weights: DailyWeight[];
}): { meanIntakeKcal: number; rateKgPerDay: number; tdeeKcal: number } | null {
  const { from, to } = input.window;
  const series = trendSeries(input.weights.filter((day) => day.date <= to));
  const inWindow = series.filter((day) => day.date >= from);
  const recentFrom = addDays(to, 1 - RECENT_DAYS);
  if (inWindow.length < WINDOW_WEIGH_INS_MIN) return null;
  if (!inWindow.some((day) => day.date >= recentFrom)) return null;
  const eaten = input.completeDays.filter((day) => day.date >= from && day.date <= to);
  if (eaten.length === 0) return null;

  const before = series.filter((day) => day.date < from).at(-1);
  const first = inWindow[0];
  const end = inWindow.at(-1);
  if (first === undefined || end === undefined) return null;
  // The day before the window stands at the trend of its latest weigh-in on or before it.
  const start =
    before === undefined
      ? { date: first.date, trendKg: first.trendKg }
      : { date: addDays(from, -1), trendKg: before.trendKg };
  const spanDays = dayNumber(end.date) - dayNumber(start.date);
  const rateKgPerDay = (end.trendKg - start.trendKg) / spanDays;
  const meanIntakeKcal = eaten.reduce((sum, day) => sum + day.energyKcal, 0) / eaten.length;
  return { meanIntakeKcal, rateKgPerDay, tdeeKcal: meanIntakeKcal - rateKgPerDay * KCAL_PER_KG };
}

/** What `Apply to targets` would set the open phase's calories to (docs/09 F13, Q17). */
export type MaintenanceApply = {
  goalPhaseId: string;
  /** The deficit (negative) or surplus for the phase's rate, to the nearest 10 kcal. */
  adjustmentKcal: number;
  calorieTargetKcal: number;
};

/**
 * The calories applying the check sets: the maintenance estimate less the deficit for a cut's rate,
 * plus the surplus for a bulk's, and the estimate itself on maintenance — rate × bodyweight × 7,700
 * ÷ 7 a day, as the provisional formula adjusts (`06`, 2026-10-16 Q17; 2026-10-27). Held to the
 * range any calorie target is.
 */
export function appliedCalories(input: {
  maintenanceKcal: number;
  type: PhaseType;
  targetRatePctPerWeek: number | null;
  weightKg: number;
}): { adjustmentKcal: number; calorieTargetKcal: number } {
  const perDay = tens(
    ((input.targetRatePctPerWeek ?? 0) / 100) * input.weightKg * (KCAL_PER_KG / 7),
  );
  const adjustmentKcal = input.type === 'cut' ? -perDay : input.type === 'bulk' ? perDay : 0;
  return {
    // A cut at a rate of 0 would be −0.
    adjustmentKcal: adjustmentKcal === 0 ? 0 : adjustmentKcal,
    calorieTargetKcal: Math.min(
      CALORIE_TARGET_KCAL.max,
      Math.max(CALORIE_TARGET_KCAL.min, input.maintenanceKcal + adjustmentKcal),
    ),
  };
}

type Window = {
  from: string;
  to: string;
  completeDaysTotal: number;
  remaining: 0;
  completeDaysInWindow: number;
  /** Complete days among the window's newest 7. */
  recentCompleteDays: number;
  lowRecentLogging: boolean;
  /** Weighed days in the window. */
  weighInsInWindow: number;
  /** The newest weighed day on or before today, in the window or not. */
  lastWeighedOn: string | null;
  method: typeof MAINTENANCE_METHOD;
};

export type MaintenanceCheck =
  | {
      status: 'collecting';
      completeDaysTotal: number;
      remaining: number;
      method: typeof MAINTENANCE_METHOD;
    }
  | (Window & { status: 'needs_logging' | 'needs_weigh_in' })
  | (Window & {
      status: 'ready';
      meanIntakeKcal: number;
      trendChangeKgPerWeek: number;
      /** To the nearest 10 kcal: the card prints it with `≈`. */
      maintenanceKcal: number;
      /** Null without an open phase to apply it to. */
      apply: MaintenanceApply | null;
    });

/**
 * S18a on `today`. `collecting` until 14 complete days in total; `needs_logging` with no complete
 * day in the window; `needs_weigh_in` with fewer than 3 weighed days in it or none in its newest 7;
 * else `ready`, labelled when fewer than 5 of the newest 7 days are complete.
 */
export function maintenanceCheck(input: {
  today: string;
  completeDaysTotal: number;
  /** Complete days with their confirmed intake; only the window's are read. */
  completeDays: CompleteDay[];
  /** Every daily weight, oldest first. */
  weights: DailyWeight[];
  /** The open phase and the bodyweight its targets are set at, when there is one. */
  phase?:
    | { id: string; type: PhaseType; targetRatePctPerWeek: number | null; weightKg: number }
    | undefined;
}): MaintenanceCheck {
  const { today, completeDaysTotal } = input;
  if (completeDaysTotal < COMPLETE_DAYS_NEEDED) {
    return {
      status: 'collecting',
      completeDaysTotal,
      remaining: COMPLETE_DAYS_NEEDED - completeDaysTotal,
      method: MAINTENANCE_METHOD,
    };
  }
  const from = addDays(today, 1 - WINDOW_DAYS);
  const recentFrom = addDays(today, 1 - RECENT_DAYS);
  const complete = input.completeDays.filter((day) => day.date >= from && day.date <= today);
  const recentCompleteDays = complete.filter((day) => day.date >= recentFrom).length;
  const weighed = input.weights.filter((day) => day.date <= today);
  const window: Window = {
    from,
    to: today,
    completeDaysTotal,
    remaining: 0,
    completeDaysInWindow: complete.length,
    recentCompleteDays,
    lowRecentLogging: recentCompleteDays < RECENT_COMPLETE_MIN,
    weighInsInWindow: weighed.filter((day) => day.date >= from).length,
    lastWeighedOn: weighed.at(-1)?.date ?? null,
    method: MAINTENANCE_METHOD,
  };
  if (complete.length === 0) return { ...window, status: 'needs_logging' };
  const estimate = windowExpenditure({
    window: { from, to: today },
    completeDays: complete,
    weights: weighed,
  });
  if (estimate === null) return { ...window, status: 'needs_weigh_in' };
  const maintenanceKcal = tens(estimate.tdeeKcal);
  const phase = input.phase;
  return {
    ...window,
    status: 'ready',
    meanIntakeKcal: round(estimate.meanIntakeKcal),
    trendChangeKgPerWeek: round(estimate.rateKgPerDay * 7, 2),
    maintenanceKcal,
    apply:
      phase === undefined
        ? null
        : {
            goalPhaseId: phase.id,
            ...appliedCalories({
              maintenanceKcal,
              type: phase.type,
              targetRatePctPerWeek: phase.targetRatePctPerWeek,
              weightKg: phase.weightKg,
            }),
          },
  };
}
