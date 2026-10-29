import type { PrepPlan } from '@overload/api-contract';
import { useCallback, useEffect, useState } from 'react';
import { deviceStore, type TickList } from './device-store';
import { shortDate } from './plan';
import { addLocalDays } from './query';

// How the Food tab's prep, grocery and batch screens say their figures (S13, S17; docs/10 §5).
// Display only: every figure is the API's (docs/07 §4).

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** `Sunday`. */
export const weekdayOf = (date: string) =>
  WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? '';

/** `Sunday 18 Oct`. */
export const longDay = (date: string) => `${weekdayOf(date)} ${shortDate(date)}`;

/** `Mon 19`. */
export const shortDay = (date: string) =>
  `${weekdayOf(date).slice(0, 3)} ${Number(date.slice(8, 10))}`;

/** `1,400`: grams as the prep and grocery lists print them. */
export const grams = (value: number) => Math.round(value).toLocaleString('en-US');

/** `75%`. */
export const yieldPercent = (value: number) => `${Math.round(value * 100)}%`;

/** `Wednesday and Sunday`, `Monday, Tuesday and Sunday`. */
export function wordList(words: string[]) {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

/** Whole days from one local date to another. */
export const daysFrom = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * The week the prep screens open on: this week while one of its cook days is still to come, else
 * the next. From Sunday, the Sunday is the next week's first cook day.
 */
export function prepWeek(today: string, thisWeek: PrepPlan | undefined) {
  const current = addLocalDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
  const sunday = new Date(`${today}T00:00:00Z`).getUTCDay() === 0;
  const next = addLocalDays(current, 7);
  if (sunday) return { current: next, next };
  const ahead =
    thisWeek === undefined ? undefined : cookDaysOf(thisWeek).some((day) => day.date >= today);
  return { current: ahead === false ? next : current, next };
}

type Food = PrepPlan['foods'][number];
type Cook = PrepPlan['cookDays'][number]['cooks'][number];

/**
 * The week's cook days with something to cook. An API from before 2026-10-27 answers without
 * `pieces` and puts foods with no shelf life on the first cook day (`keepsDays: null`); the web
 * app can go live first (docs/12 §3), so those rows are dropped and a missing count is none.
 */
export function cookDaysOf(plan: PrepPlan) {
  return plan.cookDays
    .map((day) => ({
      ...day,
      cooks: day.cooks
        .filter((cook) => (cook.keepsDays as number | null) !== null)
        .map((cook): Cook => ({ ...cook, pieces: cook.pieces ?? null })),
    }))
    .filter((day) => day.cooks.length > 0);
}

/**
 * The yield note under a cook (docs/10 §5): the batch it converts by, `flag` when the batch is over
 * a week old or missing, and what a missing one means for this cook's figures.
 */
export function yieldNote(food: Food | undefined, cook: Cook, today: string) {
  const keeps = `Keeps ${cook.keepsDays} days.`;
  const batch = food?.batch ?? null;
  if (batch === null) {
    if (cook.rawGrams === null)
      return { text: `No batch weighed yet, so the raw weight is unknown. ${keeps}`, flag: true };
    if (cook.cookedGrams === null)
      return {
        text: `No batch weighed yet, so it is planned by raw weight. ${keeps}`,
        flag: true,
      };
    return {
      text: `No batch weighed yet, so raw grams are approximate (from the food table’s cooked values). ${keeps}`,
      flag: true,
    };
  }
  const yieldText = `Yield ${yieldPercent(batch.yield)} from your batch of ${shortDate(batch.cookedOn)}`;
  if (food?.weighDue === true) {
    const age = daysFrom(batch.cookedOn, today);
    return { text: `${yieldText}, ${age} days ago. Weigh this week’s batch. ${keeps}`, flag: true };
  }
  return { text: `${yieldText}. ${keeps}`, flag: false };
}

/**
 * The food ids ticked on one list of the week, kept on this phone only (Q11). A tick is shown at
 * once; a failed write keeps it until the app is closed.
 */
export function useTicks(key: TickList | undefined) {
  const id = key === undefined ? undefined : `${key.userId}:${key.weekStart}:${key.list}`;
  const [ticks, setTicks] = useState<{ id: string | undefined; ids: Set<string> }>({
    id: undefined,
    ids: new Set(),
  });
  useEffect(() => {
    if (key === undefined) return undefined;
    let current = true;
    void deviceStore.ticks
      .get(key)
      .then((ids) => {
        if (current) setTicks({ id, ids: new Set(ids) });
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
    // The key's parts are its identity.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const shown = ticks.id === id ? ticks.ids : new Set<string>();
  const write = useCallback(
    (next: Set<string>) => {
      setTicks({ id, ids: next });
      if (key !== undefined) void deviceStore.ticks.set(key, [...next]).catch(() => undefined);
    },
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [id],
  );
  const toggle = (tick: string) => {
    const next = new Set(shown);
    if (next.has(tick)) next.delete(tick);
    else next.add(tick);
    write(next);
  };
  const add = (tick: string) => write(new Set(shown).add(tick));
  const clear = () => write(new Set());
  return { ticks: shown, toggle, add, clear };
}
