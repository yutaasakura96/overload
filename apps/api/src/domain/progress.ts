import { epley, type LoggedSet } from './e1rm.js';

// S7's chart (docs/07 §3): one point per workout, and the stats of the span chosen. Local dates
// are `YYYY-MM-DD` strings, which compare in date order.

export const SPANS = ['4w', '12w', '6m', '1y', 'all'] as const;
export type Span = (typeof SPANS)[number];

/** One workout's sets of the exercise, warm-ups included, with the workout's local date. */
export type LoggedWorkout = { workoutId: string; date: string; sets: LoggedSet[] };

export type ProgressPoint = {
  workoutId: string;
  date: string;
  /** Epley on the best working set, to the tenth. */
  e1rmKg: number;
  /** The heaviest working set, and the most reps done at that weight. */
  topSetKg: number;
  topSetReps: number;
  /** Volume load: weight × reps, summed over the working sets. */
  volumeKg: number;
};

export type Progress = {
  span: Span;
  /** The span's first local date. For `all` the first workout's, and null without one. */
  from: string | null;
  to: string;
  points: ProgressPoint[];
  stats: {
    bestE1rmKg: number | null;
    topSetKg: number | null;
    topSetReps: number | null;
    volumeKg: number;
  };
};

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKS: Partial<Record<Span, number>> = { '4w': 4, '12w': 12 };
const MONTHS: Partial<Record<Span, number>> = { '6m': 6, '1y': 12 };

const toDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

/**
 * The first local date of a span that ends on `today`, both included: 12 weeks are 84 days. A
 * month span starts the day after the same day of the month, or after that month's last day when
 * it is shorter. `all` has no start.
 */
export function spanStart(span: Span, today: string): string | undefined {
  const [year = 0, month = 1, day = 1] = today.split('-').map(Number);
  const weeks = WEEKS[span];
  if (weeks !== undefined) return toDate(Date.UTC(year, month - 1, day - (weeks * 7 - 1)));
  const months = MONTHS[span];
  if (months === undefined) return undefined;
  const lastDay = new Date(Date.UTC(year, month - months, 0)).getUTCDate();
  return toDate(Date.UTC(year, month - 1 - months, Math.min(day, lastDay)) + DAY_MS);
}

/** A workout's point, from its working sets alone (S6). A workout of warm-ups has none. */
function pointOf(workout: LoggedWorkout): ProgressPoint[] {
  const working = workout.sets.filter((set) => !set.isWarmup);
  if (working.length === 0) return [];
  const topSetKg = Math.max(...working.map((set) => set.weightKg));
  return [
    {
      workoutId: workout.workoutId,
      date: workout.date,
      e1rmKg: round(Math.max(...working.map((set) => epley(set.weightKg, set.reps))), 1),
      topSetKg,
      topSetReps: Math.max(
        ...working.filter((set) => set.weightKg === topSetKg).map((set) => set.reps),
      ),
      volumeKg: round(
        working.reduce((sum, set) => sum + set.weightKg * set.reps, 0),
        2,
      ),
    },
  ];
}

/**
 * The chart of one exercise over a span ending on `today`, from the workouts that logged it, in
 * the order given (oldest first). A workout dated after today is outside every span.
 */
export function exerciseProgress(span: Span, today: string, workouts: LoggedWorkout[]): Progress {
  const start = spanStart(span, today);
  const points = workouts
    .filter((workout) => (start === undefined || workout.date >= start) && workout.date <= today)
    .flatMap(pointOf);
  const top = points.reduce<ProgressPoint | undefined>(
    (best, point) =>
      best === undefined ||
      point.topSetKg > best.topSetKg ||
      (point.topSetKg === best.topSetKg && point.topSetReps > best.topSetReps)
        ? point
        : best,
    undefined,
  );
  return {
    span,
    from: start ?? points[0]?.date ?? null,
    to: today,
    points,
    stats: {
      bestE1rmKg: points.length === 0 ? null : Math.max(...points.map((point) => point.e1rmKg)),
      topSetKg: top?.topSetKg ?? null,
      topSetReps: top?.topSetReps ?? null,
      volumeKg: round(
        points.reduce((sum, point) => sum + point.volumeKg, 0),
        2,
      ),
    },
  };
}
