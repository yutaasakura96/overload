import type { BodyweightCount, WeightUnit } from '@overload/api-contract';
import { formatWeight } from './units';

// Which weigh-in a bodyweight lift was counted at (issue #69, docs/06 2026-10-16). The API names
// the weigh-in; this only words it. A pull-up counts all of the weight plus any kg logged on it.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `12 Nov`, from a local date. */
const shortDate = (date: string) => {
  const [, month = '1', day = '1'] = date.split('-');
  return `${Number(day)} ${MONTHS[Number(month) - 1] ?? ''}`;
};

/** The weigh-in a workout was counted at, as a sentence; the workout's own day is not named. */
export function countedAt(count: BodyweightCount, unit: WeightUnit): string {
  if (count.basis === 'none') return 'No weigh-in · counted as logged';
  const weight = `${formatWeight(count.weightKg, unit)} ${unit}`;
  if (count.basis === 'same_day') return `Counted at ${weight} · that day’s weigh-in`;
  if (count.basis === 'earlier_day') {
    return `Counted at ${weight} · your weigh-in of ${shortDate(count.weighedOn)}`;
  }
  return `Counted at ${weight} · your first weigh-in, ${shortDate(count.weighedOn)}`;
}
