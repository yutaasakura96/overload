import { bestE1rmKg, type LoggedSet } from './e1rm.js';
import { spanStart, type Span } from './progress.js';

// The strength overview (docs/07 §3, docs/06 2026-10-10 Q12): whether each lift is gaining,
// holding or losing over a span, and all of them together. One measure, e1RM, so more reps at the
// same weight counts as stronger. A lift's verdict reads a straight line through the span's
// workouts, not its last workout against its first, so one bad day does not flip it.

export const STRENGTH_STATUSES = ['gaining', 'holding', 'losing'] as const;
export type StrengthStatus = (typeof STRENGTH_STATUSES)[number];

/** A lift's status: its verdict, or `too_few` where the span cannot give one. */
export const LIFT_STATUSES = [...STRENGTH_STATUSES, 'too_few'] as const;
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
  /** That change as a share of the line's start, to the tenth: the figure the status reads. */
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
 * start. The percentage is rounded to the tenth before it is judged, so the figure a screen prints
 * and the verdict beside it never disagree. There is none with fewer than three workouts, with
 * every workout on one day, or where the line starts at or under zero and has no share to give.
 */
export function strengthTrend(points: TrendPoint[]): StrengthTrend | undefined {
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
  const changePct = round(((endKg - startKg) / startKg) * 100, 1);
  return { changeKg: round(endKg - startKg, 3), changePct, status: statusOf(changePct) };
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
  status: LiftStatus;
  /** Null with `too_few`. */
  trend: { changeKg: number; changePct: number } | null;
};

export type StrengthOverview = {
  span: Span;
  /** The span's first local date. For `all` the first workout's, and null without one. */
  from: string | null;
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
 * its working sets alone (S6), and only where they give an e1RM above zero: a lift logged at no
 * weight has nothing to trend, so one with no such workout in the span is not listed.
 */
export function strengthOverview(
  span: Span,
  today: string,
  logged: LoggedLift[],
): StrengthOverview {
  const start = spanStart(span, today);
  const lifts = logged.flatMap((lift): StrengthLift[] => {
    const plotted = lift.workouts
      .filter((workout) => (start === undefined || workout.date >= start) && workout.date <= today)
      .flatMap((workout) => {
        const e1rmKg = bestE1rmKg(workout.sets);
        return e1rmKg === undefined || e1rmKg <= 0 ? [] : [{ date: workout.date, e1rmKg }];
      });
    if (plotted.length === 0) return [];
    const trend = strengthTrend(plotted);
    return [
      {
        exerciseId: lift.exerciseId,
        name: lift.name,
        points: plotted.map((point) => ({ date: point.date, e1rmKg: round(point.e1rmKg, 1) })),
        status: trend?.status ?? 'too_few',
        trend:
          trend === undefined ? null : { changeKg: trend.changeKg, changePct: trend.changePct },
      },
    ];
  });
  const rated = lifts.filter((lift) => lift.trend !== null);
  const unrated = lifts.filter((lift) => lift.trend === null);
  const changes = rated.flatMap((lift) => (lift.trend === null ? [] : [lift.trend.changePct]));
  const changePct = changes.length === 0 ? null : round(sum(changes) / changes.length, 1);
  const dates = lifts.flatMap((lift) => lift.points.map((point) => point.date)).toSorted();
  return {
    span,
    from: start ?? dates[0] ?? null,
    to: today,
    overall: {
      lifts: rated.length,
      changePct,
      status: changePct === null ? null : statusOf(changePct),
    },
    lifts: [
      ...rated.toSorted(
        (a, b) => (b.trend?.changePct ?? 0) - (a.trend?.changePct ?? 0) || byName(a, b),
      ),
      ...unrated.toSorted(byName),
    ],
  };
}
