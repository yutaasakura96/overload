// The bodyweight rule of apps/api/src/domain/bodyweight.ts, for one case the API cannot answer: an
// open workout offline, whose cached weigh-ins are newer than the Last time answer it copied
// (issue #69). Online, the API's own count is used. It imports nothing, so the API's suite runs
// both on the same cases (apps/api/test/bodyweight.test.ts) and a change to one fails there.

/** A weighed day, as `GET /api/weigh-ins` lists it. */
type WeighedDay = { date: string; weightKg: number };

/** As the API's `BodyweightCount`. */
export type CountedBodyweight =
  | { basis: 'same_day' | 'earlier_day' | 'later_day'; weightKg: number; weighedOn: string }
  | { basis: 'none' };

/**
 * The weight that counts for a workout on `date`: that day's weight; failing that the latest
 * earlier day's; failing that the first later one. `days` are the weighed days in any order.
 */
export function bodyweightOn(days: WeighedDay[], date: string): CountedBodyweight {
  // One pass, not a sorted copy: `toSorted` and `findLast` are missing from iOS Safari 15.
  let earlier: WeighedDay | undefined;
  let later: WeighedDay | undefined;
  for (const each of days) {
    if (each.date < date && (earlier === undefined || each.date > earlier.date)) earlier = each;
    if (each.date > date && (later === undefined || each.date < later.date)) later = each;
  }
  const found = days.find((each) => each.date === date) ?? earlier ?? later;
  if (found === undefined) return { basis: 'none' };
  const basis = found.date === date ? 'same_day' : found.date < date ? 'earlier_day' : 'later_day';
  return { basis, weightKg: found.weightKg, weighedOn: found.date };
}

/** A set's load: all of the bodyweight plus the kg logged, or as logged with no weigh-in. */
export function countedLoad(weightKg: number, count: CountedBodyweight): number {
  return count.basis === 'none' ? weightKg : Math.round((count.weightKg + weightKg) * 100) / 100;
}
