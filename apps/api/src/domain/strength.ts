import { bestE1rmKg, type LoggedSet } from './e1rm.js';
import { spanStart } from './progress.js';

// The strength overview (docs/07 §3, docs/06 2026-10-10 Q12): whether each lift is gaining,
// holding or losing over a span, and all of them together. One measure, e1RM, so more reps at the
// same weight counts as stronger. A lift's verdict reads a straight line through the span's
// workouts, not its last workout against its first, so one bad day does not flip it.

export const STRENGTH_STATUSES = ['gaining', 'holding', 'losing'] as const;
export type StrengthStatus = (typeof STRENGTH_STATUSES)[number];
export const STRENGTH_SPANS = ['4w', '12w', '1y'] as const;
export type StrengthSpan = (typeof STRENGTH_SPANS)[number];

/** A lift's status: its verdict, or `too_few` where the span cannot give one. */
export const LIFT_STATUSES = [...STRENGTH_STATUSES, 'too_few', 'no_weight'] as const;
export type LiftStatus = (typeof LIFT_STATUSES)[number];

/** Up this many percent or more across the span is gaining; down as many is losing. */
export const TREND_THRESHOLD_PCT = 2;
/** A span holding fewer workouts of a lift gives it no verdict. */
export const TREND_MIN_WORKOUTS = 3;

/** One workout of a lift: its local date and its e1RM. */
export type TrendPoint = { date: string; e1rmKg: number };

export type StrengthTrend = {
  /** The line's end less its start, to the thousandth. */
  changeKg: number;
  /** That change as a share of the line's start, to the tenth. */
  changePct: number;
  status: StrengthStatus;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const dayOf = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
/** Halves round away from zero, so a fall rounds as its rise does. */
const round = (value: number, places: number) =>
  (Math.sign(value) * Math.round(Math.abs(value) * 10 ** places)) / 10 ** places;

/** The verdict a change reads as. The threshold itself is gaining, or losing. */
export function statusOf(changePct: number): StrengthStatus {
  if (changePct >= TREND_THRESHOLD_PCT) return 'gaining';
  if (changePct <= -TREND_THRESHOLD_PCT) return 'losing';
  return 'holding';
}

/**
 * A lift's trend: the least-squares line through its e1RM by local date, its end against its
 * start. There is none with fewer than three workouts, with
 * every workout on one day, or where the line starts at or under zero and has no share to give.
 */
function rawTrend(points: TrendPoint[]) {
  if (points.length < TREND_MIN_WORKOUTS) return undefined;
  const days = points.map((point) => dayOf(point.date));
  const meanDay = sum(days) / days.length;
  const meanKg = sum(points.map((point) => point.e1rmKg)) / points.length;
  const spread = sum(days.map((day) => (day - meanDay) ** 2));
  if (spread === 0) return undefined;
  const slope =
    sum(points.map((point, index) => ((days[index] ?? 0) - meanDay) * (point.e1rmKg - meanKg))) /
    spread;
  const startKg = meanKg + slope * (Math.min(...days) - meanDay);
  const endKg = meanKg + slope * (Math.max(...days) - meanDay);
  if (startKg <= 0) return undefined;
  return { changeKg: endKg - startKg, changePct: ((endKg - startKg) / startKg) * 100 };
}

export function strengthTrend(points: TrendPoint[]): StrengthTrend | undefined {
  const trend = rawTrend(points);
  if (trend === undefined) return undefined;
  return {
    changeKg: round(trend.changeKg, 3),
    changePct: round(trend.changePct, 1),
    status: statusOf(trend.changePct),
  };
}

/** One exercise's workouts, oldest first, each with every set of it and its local date. */
export type LoggedLift = {
  exerciseId: string;
  name: string;
  workouts: { date: string; sets: LoggedSet[] }[];
};

export type StrengthLift = {
  exerciseId: string;
  name: string;
  /** One per workout in the span, oldest first, e1RM to the tenth. */
  points: TrendPoint[];
  workoutCount: number;
  status: LiftStatus;
  /** Null with `too_few` or `no_weight`. */
  trend: { changeKg: number; changePct: number } | null;
};

export type StrengthOverview = {
  span: StrengthSpan;
  /** The span's first local date. */
  from: string;
  to: string;
  /** Every lift with a verdict, averaged. No figure and no status without one. */
  overall: { lifts: number; changePct: number | null; status: StrengthStatus | null };
  /** The lifts with a verdict, the largest gain first; then those without, by name. */
  lifts: StrengthLift[];
};

const byName = (a: StrengthLift, b: StrengthLift) =>
  a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) ||
  a.exerciseId.localeCompare(b.exerciseId);

/**
 * Every lift's trend over a span ending on `today`, and their plain average. A workout counts by
 * its working sets alone (S6). A lift logged only at zero weight has no e1RM trend.
 */
export function strengthOverview(
  span: StrengthSpan,
  today: string,
  logged: LoggedLift[],
): StrengthOverview {
  const start = spanStart(span, today)!;
  const measured = logged.flatMap((lift): (StrengthLift & { rawChangePct: number | null })[] => {
    const workouts = lift.workouts.filter(
      (workout) => workout.date >= start && workout.date <= today,
    );
    const working = workouts.filter((workout) => workout.sets.some((set) => !set.isWarmup));
    if (working.length === 0) return [];
    const plotted = working.flatMap((workout) => {
      const e1rmKg = bestE1rmKg(workout.sets);
      return e1rmKg === undefined || e1rmKg <= 0 ? [] : [{ date: workout.date, e1rmKg }];
    });
    const raw = rawTrend(plotted);
    return [
      {
        exerciseId: lift.exerciseId,
        name: lift.name,
        points: plotted.map((point) => ({ date: point.date, e1rmKg: round(point.e1rmKg, 1) })),
        workoutCount: working.length,
        status:
          raw === undefined
            ? plotted.length === 0
              ? 'no_weight'
              : 'too_few'
            : statusOf(raw.changePct),
        trend:
          raw === undefined
            ? null
            : { changeKg: round(raw.changeKg, 3), changePct: round(raw.changePct, 1) },
        rawChangePct: raw?.changePct ?? null,
      },
    ];
  });
  const rated = measured.filter((lift) => lift.rawChangePct !== null);
  const unrated = measured.filter((lift) => lift.rawChangePct === null);
  const average =
    rated.length === 0 ? null : sum(rated.map((lift) => lift.rawChangePct ?? 0)) / rated.length;
  return {
    span,
    from: start,
    to: today,
    overall: {
      lifts: rated.length,
      changePct: average === null ? null : round(average, 1),
      status: average === null ? null : statusOf(average),
    },
    lifts: [
      ...rated.toSorted((a, b) => (b.rawChangePct ?? 0) - (a.rawChangePct ?? 0) || byName(a, b)),
      ...unrated.toSorted(byName),
    ].map(({ rawChangePct: _, ...lift }) => lift),
  };
}
