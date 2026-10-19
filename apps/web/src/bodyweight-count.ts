// The bodyweight rule of apps/api/src/domain/bodyweight.ts, for one case the API cannot answer: an
// open workout offline, whose cached weigh-ins are newer than the Last time answer it copied
// (issue #69). Online, the API's own count is used. It imports nothing, so the API's suite runs
// both on the same cases (apps/api/test/bodyweight.test.ts) and a change to one fails there.

/** A reading, as `GET /api/weigh-ins` lists it. */
type Reading = { id: string; measuredAt: string; weightKg: number };

/** A weighed day: the local date and the reading that stands for it. */
type WeighedDay = { date: string; weightKg: number };

/** A reading before this local time is a morning weigh-in. */
const MORNING_ENDS = '10:00';

/**
 * The weighed days in `timeZone`, in no order, as the API's `dailyWeights` finds them: the day's
 * first reading before 10:00, failing that its first reading. The API dates its own list in the
 * profile's zone, which may not be the open workout's (issue #69).
 */
export function weighedDaysIn(readings: Reading[], timeZone: string): WeighedDay[] {
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  type Held = WeighedDay & { at: number; id: string; morning: boolean };
  const first = (a: Held, b: Held) => a.at < b.at || (a.at === b.at && a.id < b.id);
  // One pass, not a sorted copy: a morning reading beats the rest of its day, else the earlier.
  const days = new Map<string, Held>();
  for (const each of readings) {
    const parts: Record<string, string> = {};
    for (const part of format.formatToParts(new Date(each.measuredAt))) {
      parts[part.type] = part.value;
    }
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    const morning = `${parts.hour}:${parts.minute}` < MORNING_ENDS;
    const day = {
      date,
      weightKg: each.weightKg,
      at: Date.parse(each.measuredAt),
      id: each.id,
      morning,
    };
    const held = days.get(date);
    if (held !== undefined && (held.morning !== morning ? held.morning : first(held, day)))
      continue;
    days.set(date, day);
  }
  return [...days.values()].map(({ date, weightKg }) => ({ date, weightKg }));
}

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
