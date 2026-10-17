import type { LoggedSet } from './e1rm.js';
import type { DailyWeight } from './weight.js';

// Bodyweight on bodyweight lifts (issue #69, docs/06 2026-10-16): a pull-up counts the lifter's
// weight plus any added kg, so its e1RM, top set and volume are not zero. The weight is the
// day's weight (`dailyWeights`), found for the workout's local date.

/**
 * The weight a bodyweight lift was counted at. `none` is a lifter with no weigh-in at all, whose
 * sets keep the weight they were logged with.
 */
export type BodyweightCount =
  | { basis: 'same_day' | 'earlier_day' | 'later_day'; weightKg: number; weighedOn: string }
  | { basis: 'none' };

const NO_WEIGH_IN: BodyweightCount = { basis: 'none' };

const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

/**
 * The weight that counts for a workout on `date`: that day's weight; failing that the latest
 * earlier day's; failing that, a workout older than the first weigh-in, the first later one
 * (Q9, Q11). `days` are the weighed days, oldest first.
 */
export function bodyweightOn(days: DailyWeight[], date: string): BodyweightCount {
  const found = days.find((each) => each.date === date);
  if (found !== undefined) return counted('same_day', found);
  const earlier = days.findLast((each) => each.date < date);
  if (earlier !== undefined) return counted('earlier_day', earlier);
  const later = days.find((each) => each.date > date);
  return later === undefined ? NO_WEIGH_IN : counted('later_day', later);
}

const counted = (basis: 'same_day' | 'earlier_day' | 'later_day', day: DailyWeight) =>
  ({ basis, weightKg: day.weightKg, weighedOn: day.date }) as const;

/**
 * A bodyweight lift's sets at the load they moved: all of the bodyweight plus the kg logged on
 * the set, so a logged 0 kg is bodyweight alone (Q10). With no weigh-in the sets are as logged.
 */
export function withBodyweight(sets: LoggedSet[], count: BodyweightCount): LoggedSet[] {
  if (count.basis === 'none') return sets;
  return sets.map((set) => ({ ...set, weightKg: countedLoad(set.weightKg, count) }));
}

export function countedLoad(weightKg: number, count: BodyweightCount): number {
  return count.basis === 'none' ? weightKg : round(count.weightKg + weightKg, 2);
}
