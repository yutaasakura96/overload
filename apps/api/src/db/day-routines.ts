import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Database, Queryable } from './connection.js';
import { dayRoutine, dayTypeValues, mealSlot } from './schema.js';

export type DayType = (typeof dayTypeValues)[number];

/** One meal of a day type's shape, its time `HH:MM` (S15). */
export type MealSlotRow = { position: number; time: string; label: string | null };

/** One day type's routine as the API returns it (docs/07 §4). Times are local `HH:MM`. */
export type DayRoutine = {
  dayType: DayType;
  wakeTime: string;
  workStart: string | null;
  workEnd: string | null;
  trainingTime: string | null;
  bedTime: string;
  mealCount: number;
  slots: MealSlotRow[];
};

export type DayRoutineInput = Omit<DayRoutine, 'dayType' | 'mealCount' | 'slots'> & {
  slots: Omit<MealSlotRow, 'position'>[];
};

/** Postgres `time` reads as `HH:MM:SS`; the API speaks `HH:MM`. */
const hhmm = (time: string) => time.slice(0, 5);
const maybe = (time: string | null) => (time === null ? null : hhmm(time));

const columns = {
  dayType: dayRoutine.dayType,
  wakeTime: dayRoutine.wakeTime,
  workStart: dayRoutine.workStart,
  workEnd: dayRoutine.workEnd,
  trainingTime: dayRoutine.trainingTime,
  bedTime: dayRoutine.bedTime,
  mealCount: dayRoutine.mealCount,
};

/** Both day types the caller has set, training first, each with its meals in order. */
export async function listDayRoutines(
  db: Queryable,
  userId: string,
  dayTypes: readonly DayType[] = dayTypeValues,
): Promise<DayRoutine[]> {
  const routines = await db
    .select(columns)
    .from(dayRoutine)
    .where(and(eq(dayRoutine.userId, userId), inArray(dayRoutine.dayType, [...dayTypes])));
  if (routines.length === 0) return [];
  const slots = await db
    .select({
      dayType: mealSlot.dayType,
      position: mealSlot.position,
      time: mealSlot.targetTime,
      label: mealSlot.label,
    })
    .from(mealSlot)
    .where(eq(mealSlot.userId, userId))
    .orderBy(asc(mealSlot.position), asc(mealSlot.id));
  return routines
    .map((routine) => ({
      ...routine,
      wakeTime: hhmm(routine.wakeTime),
      workStart: maybe(routine.workStart),
      workEnd: maybe(routine.workEnd),
      trainingTime: maybe(routine.trainingTime),
      bedTime: hhmm(routine.bedTime),
      slots: slots
        .filter((slot) => slot.dayType === routine.dayType)
        .map(({ position, time, label }) => ({ position, time: hhmm(time), label })),
    }))
    .toSorted((a, b) => dayTypeValues.indexOf(a.dayType) - dayTypeValues.indexOf(b.dayType));
}

/**
 * Replaces one day type's routine and its meals (S15). The meal count is the meals given. Repeating
 * it leaves the same routine.
 */
export async function putDayRoutine(
  db: Database,
  userId: string,
  dayType: DayType,
  input: DayRoutineInput,
): Promise<DayRoutine> {
  await db.transaction(async (tx) => {
    const values = {
      wakeTime: input.wakeTime,
      workStart: input.workStart,
      workEnd: input.workEnd,
      trainingTime: dayType === 'training' ? input.trainingTime : null,
      bedTime: input.bedTime,
      mealCount: input.slots.length,
    };
    await tx
      .insert(dayRoutine)
      .values({ userId, dayType, ...values })
      .onConflictDoUpdate({
        target: [dayRoutine.userId, dayRoutine.dayType],
        set: { ...values, updatedAt: sql`now()` },
      });
    await tx
      .delete(mealSlot)
      .where(and(eq(mealSlot.userId, userId), eq(mealSlot.dayType, dayType)));
    await tx.insert(mealSlot).values(
      input.slots.map((slot, index) => ({
        userId,
        dayType,
        position: index + 1,
        targetTime: slot.time,
        label: slot.label,
      })),
    );
  });
  const [saved] = await listDayRoutines(db, userId, [dayType]);
  if (saved === undefined) throw new Error('day routine upsert returned no row');
  return saved;
}

/** The export's `dayRoutines` section: training then rest, with their meals (docs/07 §2). */
export async function exportDayRoutines(
  db: Database,
  userId: string,
  page: { limit: number; after?: { dayType: DayType } | undefined },
): Promise<{ items: DayRoutine[]; next: { dayType: DayType } | null }> {
  const all = await listDayRoutines(db, userId);
  const from =
    page.after === undefined
      ? 0
      : all.findIndex((each) => each.dayType === page.after?.dayType) + 1;
  const items = all.slice(from, from + page.limit);
  const last = items.at(-1);
  return {
    items,
    next: from + page.limit < all.length && last !== undefined ? { dayType: last.dayType } : null,
  };
}
