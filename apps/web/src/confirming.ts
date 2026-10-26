import type {
  PlanDay,
  PlanItem,
  PlanMeal,
  PlanMealConfirm,
  PlanMealConfirmed,
} from '@overload/api-contract';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { api } from './api';
import { dayLabel } from './dates';
import { deviceStore } from './device-store';
import {
  addLocalDays,
  confirmedAccountData,
  planDaysQuery,
  queryClient,
  useAccount,
} from './query';

// Confirming planned meals (S18, docs/09 F11): the plan is the log. A meal is confirmed online only;
// meals are not queued offline, only sets are (docs/06). What a meal counts is the API's; this file
// reads the amounts eaten off its items for the screens, which add them up only to preview a change.

/** Confirms one meal. A repeat replaces the earlier confirmation; `planned` takes it back. */
export async function confirmMeal(
  mealId: string,
  body: PlanMealConfirm,
): Promise<PlanMealConfirmed> {
  try {
    return await confirmedAccountData(() =>
      api.POST('/api/plan-meals/{id}/confirm', { params: { path: { id: mealId } }, body }),
    );
  } finally {
    await queryClient.invalidateQueries({ queryKey: ['plan', 'days'] });
  }
}

/** The end-of-day check's one tap: every meal of the day still planned is eaten as planned. */
export async function confirmDay(date: string): Promise<PlanDay> {
  try {
    return await confirmedAccountData(() =>
      api.POST('/api/plan-days/{date}/confirm-all', { params: { path: { date } } }),
    );
  } finally {
    await queryClient.invalidateQueries({ queryKey: ['plan', 'days'] });
  }
}

/** How many days after its date a plan day can still be confirmed (docs/09 F11). */
const CONFIRMABLE_DAYS = 7;

/** A plan day more than 7 days old is read-only: the API would answer 409 `day_locked`. */
export const dayLocked = (date: string, today: string) =>
  addLocalDays(date, CONFIRMABLE_DAYS) < today;

export const unconfirmedMeals = (day: PlanDay) =>
  day.meals.filter((meal) => meal.status === 'planned');

/** An item's weight per piece, for a food the plan counted in pieces. */
const pieceWeight = (item: PlanItem) =>
  item.pieceCount !== null && item.pieceCount > 0 && item.plannedGrams !== null
    ? item.plannedGrams / item.pieceCount
    : null;

export type Eaten = { item: PlanItem; grams: number; pieces: number | null };

/**
 * What a meal is shown with: the planned amounts until it is confirmed (and when skipped, as the
 * plan it was), and after, what was eaten. An item taken to 0 g, or eaten only instead, is said
 * only when eaten.
 */
export function eatenItems(meal: PlanMeal): Eaten[] {
  const shown = meal.items.map((item) => {
    const grams =
      meal.status === 'adjusted' || meal.status === 'replaced'
        ? (item.actualGrams ?? item.plannedGrams ?? 0)
        : (item.plannedGrams ?? 0);
    const each = pieceWeight(item);
    return { item, grams, pieces: each === null ? null : Math.round((grams / each) * 100) / 100 };
  });
  return shown.filter((each) => each.grams > 0 || each.item.plannedGrams === null);
}

/** Calories and protein of the amounts a meal is shown with. */
export function mealTotals(meal: PlanMeal) {
  return eatenItems(meal).reduce(
    (sum, { item, grams }) => ({
      energyKcal: sum.energyKcal + (grams * item.per100g.energyKcal) / 100,
      proteinG: sum.proteinG + (grams * item.per100g.proteinG) / 100,
    }),
    { energyKcal: 0, proteinG: 0 },
  );
}

/** A local date as `Fri 16 Oct`. */
export const dateLabel = (date: string) => dayLabel(`${date}T12:00:00Z`, 'UTC');

// Leaving a day incomplete (docs/09 F11): written nowhere but this device, and asked once.

const left = new Map<string, Set<string>>();
const listeners = new Set<() => void>();
const KEPT_DAYS = 14;

async function loadLeft(userId: string) {
  if (left.has(userId)) return;
  const dates = await deviceStore.leftIncomplete(userId).catch(() => []);
  left.set(userId, new Set(dates));
  for (const listener of listeners) listener();
}

/** Records that the user left the day incomplete: neither end-of-day card asks about it again. */
export async function leaveDayIncomplete(userId: string, date: string, today: string) {
  const dates = new Set(left.get(userId) ?? (await deviceStore.leftIncomplete(userId)));
  dates.add(date);
  // Kept only while a card could still ask: a day past its 7 days is never asked about.
  const kept = [...dates].filter((each) => addLocalDays(each, KEPT_DAYS) >= today);
  await deviceStore.setLeftIncomplete(userId, kept);
  left.set(userId, new Set(kept));
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The dates this device was told to leave incomplete; undefined until read. */
export function useLeftIncomplete(userId: string): Set<string> | undefined {
  useEffect(() => {
    void loadLeft(userId);
  }, [userId]);
  return useSyncExternalStore(subscribe, () => left.get(userId));
}

// What a confirm just did, said once on the screen it returns to (docs/10 §3).

let pendingFlash: string | undefined;

/** Says `text` on the next screen to open, as Back takes the user there. */
export const flashNext = (text: string) => {
  pendingFlash = text;
};

/** The line a confirm left to say, taken once as the screen opens, and anything said here after. */
export function useFlash() {
  const [flash, setFlash] = useState(() => {
    const text = pendingFlash;
    pendingFlash = undefined;
    return text;
  });
  return [flash, setFlash] as const;
}

const onConnection = (listener: () => void) => {
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
};

/** Whether the device says it has a connection: confirming needs one (docs/09 F11). */
export const useOnline = () => useSyncExternalStore(onConnection, () => navigator.onLine);

/** The meal a confirm screen opened on, read from its day's plan; undefined until it is read. */
export function useMealOnDay(date: string, mealId: string) {
  const account = useAccount();
  const read = useQuery({
    ...planDaysQuery(date, date),
    enabled: account.status === 'confirmed',
  });
  const day = read.data?.days.find((each) => each.date === date);
  return { read, day, meal: day?.meals.find((each) => each.id === mealId) };
}
