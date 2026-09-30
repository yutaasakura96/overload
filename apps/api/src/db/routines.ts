import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Database, Queryable } from './connection.js';
import { usableExerciseIds } from './exercises.js';
import { routine, routineExercise } from './schema.js';

/** One exercise slot. `null` reps fall back to the user's setting, then the exercise (docs/04). */
export type RoutineSlot = {
  id: string;
  exerciseId: string;
  targetSets: number;
  repLow: number | null;
  repHigh: number | null;
};

export type UserRoutine = { id: string; name: string; position: number; exercises: RoutineSlot[] };

/** A slot as the client sends it: its id is made on the device, like the routine's. */
export type SlotInput = {
  id: string;
  exerciseId: string;
  targetSets?: number;
  repLow?: number | null;
  repHigh?: number | null;
};

/** Every routine the user has, in list order, each with its slots in order (S4). */
export async function listRoutines(db: Database, userId: string): Promise<UserRoutine[]> {
  const routines = await db
    .select({ id: routine.id, name: routine.name, position: routine.position })
    .from(routine)
    .where(eq(routine.userId, userId))
    .orderBy(asc(routine.position), asc(routine.id));
  return withSlots(db, routines);
}

export async function getRoutine(
  db: Database,
  userId: string,
  id: string,
): Promise<UserRoutine | undefined> {
  const routines = await db
    .select({ id: routine.id, name: routine.name, position: routine.position })
    .from(routine)
    .where(and(eq(routine.id, id), eq(routine.userId, userId)));
  const [found] = await withSlots(db, routines);
  return found;
}

export type CreateRoutineResult =
  | { kind: 'created'; routine: UserRoutine }
  | { kind: 'existing'; routine: UserRoutine }
  | { kind: 'id_conflict' }
  | { kind: 'unusable_exercises'; indexes: number[] };

/**
 * A routine, appended to the end of the list, with its slots in array order. A repeat with the same
 * content returns the stored routine; anything else under that id is a conflict (docs/07 §1.2).
 */
export async function createRoutine(
  db: Database,
  userId: string,
  input: { id: string; name: string; exercises: SlotInput[] },
): Promise<CreateRoutineResult> {
  const slots = input.exercises.map(normalise);
  const unusable = await unusableSlotIndexes(db, userId, slots);
  if (unusable.length > 0) return { kind: 'unusable_exercises', indexes: unusable };

  const created = await db.transaction(async (tx) => {
    if (await slotIdsTaken(tx, slots, input.id)) return false;
    const inserted = await tx
      .insert(routine)
      .values({
        id: input.id,
        userId,
        name: input.name,
        position: sql`(SELECT coalesce(max(${routine.position}) + 1, 0) FROM ${routine} WHERE ${routine.userId} = ${userId})`,
      })
      .onConflictDoNothing()
      .returning({ id: routine.id });
    if (inserted.length === 0) return false;
    await insertSlots(tx, input.id, slots);
    return true;
  });
  if (created) return { kind: 'created', routine: await mustGetRoutine(db, userId, input.id) };

  const stored = await getRoutine(db, userId, input.id);
  const same =
    stored !== undefined &&
    stored.name === input.name &&
    stored.exercises.length === slots.length &&
    stored.exercises.every((slot, i) => sameSlot(slot, slots[i]));
  return same ? { kind: 'existing', routine: stored } : { kind: 'id_conflict' };
}

export type UpdateRoutineResult = { kind: 'updated'; routine: UserRoutine } | { kind: 'not_found' };

/**
 * Renames a routine, or moves it to `position` in the list (0 is first, past the end is last). The
 * other routines close up around it and every position is rewritten 0…n−1, so the same body always
 * leaves the same order.
 */
export async function updateRoutine(
  db: Database,
  userId: string,
  id: string,
  patch: { name?: string; position?: number },
): Promise<UpdateRoutineResult> {
  const found = await db.transaction(async (tx) => {
    const owned = await tx
      .update(routine)
      .set({ ...(patch.name === undefined ? {} : { name: patch.name }), updatedAt: sql`now()` })
      .where(and(eq(routine.id, id), eq(routine.userId, userId)))
      .returning({ id: routine.id });
    if (owned.length === 0) return false;
    if (patch.position === undefined) return true;

    const order = await tx
      .select({ id: routine.id, position: routine.position })
      .from(routine)
      .where(eq(routine.userId, userId))
      .orderBy(asc(routine.position), asc(routine.id))
      .for('update');
    const others = order.filter((row) => row.id !== id);
    const moved = [
      ...others.slice(0, patch.position),
      { id, position: -1 },
      ...others.slice(patch.position),
    ];
    for (const [position, row] of moved.entries()) {
      const before = order.find((stored) => stored.id === row.id)?.position;
      if (before === position) continue;
      await tx
        .update(routine)
        .set({ position })
        .where(and(eq(routine.id, row.id), eq(routine.userId, userId)));
    }
    return true;
  });
  if (!found) return { kind: 'not_found' };
  return { kind: 'updated', routine: await mustGetRoutine(db, userId, id) };
}

export type ReplaceSlotsResult =
  | { kind: 'updated'; routine: UserRoutine }
  | { kind: 'not_found' }
  | { kind: 'id_conflict' }
  | { kind: 'unusable_exercises'; indexes: number[] };

/** Replaces the routine's whole slot list. Order is array order, so a reorder is one call. */
export async function replaceRoutineExercises(
  db: Database,
  userId: string,
  id: string,
  exercises: SlotInput[],
): Promise<ReplaceSlotsResult> {
  const slots = exercises.map(normalise);
  const result = await db.transaction(async (tx) => {
    const owned = await tx
      .update(routine)
      .set({ updatedAt: sql`now()` })
      .where(and(eq(routine.id, id), eq(routine.userId, userId)))
      .returning({ id: routine.id });
    if (owned.length === 0) return { kind: 'not_found' } as const;
    const unusable = await unusableSlotIndexes(tx, userId, slots);
    if (unusable.length > 0) return { kind: 'unusable_exercises', indexes: unusable } as const;
    if (await slotIdsTaken(tx, slots, id)) return { kind: 'id_conflict' } as const;

    await tx.delete(routineExercise).where(eq(routineExercise.routineId, id));
    await insertSlots(tx, id, slots);
    return { kind: 'updated' } as const;
  });
  if (result.kind !== 'updated') return result;
  return { kind: 'updated', routine: await mustGetRoutine(db, userId, id) };
}

/** Deletes one of the user's routines and its slots. Past workouts keep their name (docs/04). */
export async function deleteRoutine(db: Database, userId: string, id: string): Promise<void> {
  await db.delete(routine).where(and(eq(routine.id, id), eq(routine.userId, userId)));
}

type Slot = Required<SlotInput>;

function normalise(slot: SlotInput): Slot {
  return {
    id: slot.id,
    exerciseId: slot.exerciseId,
    targetSets: slot.targetSets ?? 3,
    repLow: slot.repLow ?? null,
    repHigh: slot.repHigh ?? null,
  };
}

function sameSlot(stored: RoutineSlot, sent: Slot | undefined) {
  return (
    sent !== undefined &&
    stored.id === sent.id &&
    stored.exerciseId === sent.exerciseId &&
    stored.targetSets === sent.targetSets &&
    stored.repLow === sent.repLow &&
    stored.repHigh === sent.repHigh
  );
}

/** Which slots name an exercise this user cannot use: unknown, another user's, or hidden. */
async function unusableSlotIndexes(db: Queryable, userId: string, slots: Slot[]) {
  const usable = await usableExerciseIds(db, userId, [
    ...new Set(slots.map((slot) => slot.exerciseId)),
  ]);
  return slots.flatMap((slot, index) => (usable.has(slot.exerciseId) ? [] : [index]));
}

/** Whether any slot id already belongs to a different routine, which a PUT must not take over. */
async function slotIdsTaken(db: Queryable, slots: Slot[], routineId: string) {
  if (slots.length === 0) return false;
  const taken = await db
    .select({ id: routineExercise.id })
    .from(routineExercise)
    .where(
      and(
        inArray(
          routineExercise.id,
          slots.map((slot) => slot.id),
        ),
        ne(routineExercise.routineId, routineId),
      ),
    );
  return taken.length > 0;
}

async function insertSlots(db: Queryable, routineId: string, slots: Slot[]) {
  if (slots.length === 0) return;
  await db
    .insert(routineExercise)
    .values(slots.map((slot, position) => ({ ...slot, routineId, position })));
}

async function withSlots(
  db: Database,
  routines: { id: string; name: string; position: number }[],
): Promise<UserRoutine[]> {
  if (routines.length === 0) return [];
  const slots = await db
    .select({
      id: routineExercise.id,
      routineId: routineExercise.routineId,
      exerciseId: routineExercise.exerciseId,
      targetSets: routineExercise.targetSets,
      repLow: routineExercise.repLow,
      repHigh: routineExercise.repHigh,
    })
    .from(routineExercise)
    .where(
      inArray(
        routineExercise.routineId,
        routines.map((row) => row.id),
      ),
    )
    .orderBy(asc(routineExercise.position), asc(routineExercise.id));
  return routines.map((row) => ({
    ...row,
    exercises: slots
      .filter((slot) => slot.routineId === row.id)
      .map((slot) => ({
        id: slot.id,
        exerciseId: slot.exerciseId,
        targetSets: slot.targetSets,
        repLow: slot.repLow,
        repHigh: slot.repHigh,
      })),
  }));
}

async function mustGetRoutine(db: Database, userId: string, id: string) {
  const found = await getRoutine(db, userId, id);
  if (found === undefined) throw new Error('routine vanished between write and read');
  return found;
}
