// S11's weight (docs/03 §8.3, method `weight_trend_balance_v1`): the day's weight and the smoothed
// trend, derived at read time and never stored (docs/04 `body_measurement`). Local dates are
// `YYYY-MM-DD` strings and local times `HH:MM`, which compare in order.

/** One stored reading, typed or from the scale. */
export type WeighInReading = { id: string; measuredAt: Date; weightKg: number };

/** The reading that stands for one local day. */
export type DailyWeight = {
  date: string;
  /** The reading chosen, so the other readings of the day show as stored but not in the trend. */
  weighInId: string;
  weightKg: number;
  /** False when the day had no reading before 10:00 and its first reading stands in. */
  morning: boolean;
};

export type TrendDay = DailyWeight & {
  /** To the hundredth, and null on every day while fewer than 3 days are weighed. */
  trendKg: number | null;
};

/** A reading before this local time is a morning weigh-in (S11). */
export const MORNING_ENDS = '10:00';
/** The trend moves this share of the way to each day's weight, per day (docs/03 §8.3). */
export const TREND_DAILY_RATE = 0.1;
/** Fewer weighed days than this draw raw points only (docs/02, Empty states). */
export const TREND_MIN_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;

const addDays = (date: string, days: number) =>
  new Date((dayNumber(date) + days) * DAY_MS).toISOString().slice(0, 10);

/** The local date and wall-clock time of an instant in `timezone`. */
export function localClockIn(timezone: string) {
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return (instant: Date) => {
    const parts = Object.fromEntries(format.formatToParts(instant).map((p) => [p.type, p.value]));
    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      time: `${parts.hour}:${parts.minute}`,
    };
  };
}

const byTime = (a: WeighInReading, b: WeighInReading) =>
  a.measuredAt.getTime() - b.measuredAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * One weight per local day in `timezone`, oldest first: the first reading before 10:00, failing
 * that the day's first reading, flagged as not a morning weigh-in. The day's other readings are
 * stored but stand for nothing (docs/02, several weigh-ins in one day).
 */
export function dailyWeights(readings: WeighInReading[], timezone: string): DailyWeight[] {
  const clock = localClockIn(timezone);
  const days = new Map<string, DailyWeight>();
  for (const each of readings.toSorted(byTime)) {
    const { date, time } = clock(each.measuredAt);
    const morning = time < MORNING_ENDS;
    const held = days.get(date);
    // Readings arrive in time order, so the first of the day is held until a morning one beats it.
    if (held !== undefined && (held.morning || !morning)) continue;
    days.set(date, { date, weighInId: each.id, weightKg: each.weightKg, morning });
  }
  return [...days.values()].toSorted((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * The time-aware EWMA over the daily weights, oldest first, unrounded: `a = 1 − 0.9^Δd` with `Δd`
 * the days since the previous weighed day, so a gap moves the trend as far as that many days of
 * readings would. The first day's trend is its weight.
 */
export function trendSeries(days: DailyWeight[]): (DailyWeight & { trendKg: number })[] {
  let trend: number | undefined;
  let previous: string | undefined;
  return days.map((each) => {
    if (trend === undefined || previous === undefined) {
      trend = each.weightKg;
    } else {
      const share = 1 - (1 - TREND_DAILY_RATE) ** (dayNumber(each.date) - dayNumber(previous));
      trend += share * (each.weightKg - trend);
    }
    previous = each.date;
    return { ...each, trendKg: trend };
  });
}

/** The trend to the hundredth, or null on every day while fewer than 3 days are weighed. */
export function weightTrend(days: DailyWeight[]): { days: TrendDay[]; trendAvailable: boolean } {
  const trendAvailable = days.length >= TREND_MIN_DAYS;
  const trended = trendSeries(days).map((each) => ({
    ...each,
    trendKg: trendAvailable ? round(each.trendKg, 2) : null,
  }));
  return { days: trended, trendAvailable };
}

/**
 * How far the trend moved in the last week: the latest day's trend less the trend at the latest
 * weighed day on or before a week before `today`. Null without a trend, without that earlier day,
 * or when the latest weighed day is itself on or before that boundary.
 */
export function weekChangeKg(days: TrendDay[], today: string): number | null {
  const last = days.at(-1);
  const latest = last?.trendKg;
  const weekAgo = addDays(today, -7);
  // A latest weigh-in at or before the boundary is not this week's movement.
  if (last === undefined || last.date <= weekAgo) return null;
  const before = days.filter((each) => each.date <= weekAgo).at(-1)?.trendKg;
  if (latest === undefined || latest === null || before === undefined || before === null) {
    return null;
  }
  return round(latest - before, 2);
}

export type WeightSection<Reading extends WeighInReading> = {
  /** The range's readings, newest first. */
  weighIns: Reading[];
  /** The range's weighed days, newest first, trended from every day up to `to`. */
  days: TrendDay[];
  trendAvailable: boolean;
  weekChangeKg: number | null;
};

/**
 * S11's section over local dates `from` to `to`, both included. The trend runs from the first
 * reading ever, so a short range still starts from where the weight was; nothing after `to` counts.
 */
export function weightSection<Reading extends WeighInReading>(
  readings: Reading[],
  timezone: string,
  range: { from?: string | undefined; to: string; today: string },
): WeightSection<Reading> {
  const clock = localClockIn(timezone);
  const inRange = (date: string) =>
    (range.from === undefined || date >= range.from) && date <= range.to;
  const upToEnd = readings.filter((each) => clock(each.measuredAt).date <= range.to);
  const { days, trendAvailable } = weightTrend(dailyWeights(upToEnd, timezone));
  return {
    weighIns: upToEnd
      .filter((each) => inRange(clock(each.measuredAt).date))
      .toSorted(byTime)
      .toReversed(),
    days: days.filter((each) => inRange(each.date)).toReversed(),
    trendAvailable,
    weekChangeKg: weekChangeKg(days, range.today),
  };
}
