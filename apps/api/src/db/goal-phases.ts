import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Database, Queryable, Transaction } from './connection.js';
import { goalPhase } from './schema.js';

/** One phase as the API returns it (docs/07 §4). */
export type GoalPhase = {
  id: string;
  type: 'cut' | 'bulk' | 'maintain';
  startedOn: string;
  endedOn: string | null;
  targetRatePctPerWeek: number | null;
  proteinGPerKg: number;
  fatPctCalories: number;
  calorieTargetKcal: number;
  calorieBasis: 'provisional_formula' | 'measured' | 'manual';
  calorieTargetSetAt: Date;
};

/** A phase to open. Its id is made on the device (UUIDv7). */
export type GoalPhaseInput = Omit<GoalPhase, 'endedOn' | 'calorieTargetSetAt' | 'calorieBasis'> & {
  calorieBasis: 'provisional_formula' | 'manual';
};

export type GoalPhasePatch = Partial<
  Pick<
    GoalPhase,
    | 'targetRatePctPerWeek'
    | 'proteinGPerKg'
    | 'fatPctCalories'
    | 'calorieTargetKcal'
    | 'calorieBasis'
  >
>;

const columns = {
  id: goalPhase.id,
  type: goalPhase.type,
  startedOn: goalPhase.startedOn,
  endedOn: goalPhase.endedOn,
  targetRatePctPerWeek: goalPhase.targetRatePctPerWeek,
  proteinGPerKg: goalPhase.proteinGPerKg,
  fatPctCalories: goalPhase.fatPctCalories,
  calorieTargetKcal: goalPhase.calorieTargetKcal,
  calorieBasis: goalPhase.calorieBasis,
  calorieTargetSetAt: goalPhase.calorieTargetSetAt,
};

const newestFirst = [desc(goalPhase.startedOn), desc(goalPhase.id)];

/** Every phase, newest first: the open one has no end (S14). */
export function listGoalPhases(db: Queryable, userId: string): Promise<GoalPhase[]> {
  return db
    .select(columns)
    .from(goalPhase)
    .where(eq(goalPhase.userId, userId))
    .orderBy(...newestFirst);
}

/** The phase in force, or undefined before the first. */
export async function openGoalPhase(db: Queryable, userId: string): Promise<GoalPhase | undefined> {
  const [found] = await db
    .select(columns)
    .from(goalPhase)
    .where(and(eq(goalPhase.userId, userId), isNull(goalPhase.endedOn)));
  return found;
}

export type CreateGoalPhaseResult =
  | { kind: 'created'; phase: GoalPhase }
  | { kind: 'existing'; phase: GoalPhase }
  | { kind: 'id_conflict' }
  | { kind: 'phase_already_open'; open: GoalPhase }
  | { kind: 'phase_start_not_after_open' };

/**
 * Holds the user's phase lock until the transaction ends: a phase create, and a training-weekday
 * change with its follow-up, wait for each other.
 */
export async function lockGoalPhases(tx: Transaction, userId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('goal_phase'), hashtext(${userId}))`);
}

const dayBefore = (date: string) =>
  new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/**
 * Opens a phase, in the caller's transaction. With one already open it is refused unless
 * `endPrevious`, which ends that one on the day before in the same transaction. A repeat of the same
 * create returns the stored phase (docs/07 §1.2); the formula's calories are the server's, so a
 * repeat of a provisional create is the same whatever figure it carries.
 */
export async function createGoalPhase(
  tx: Transaction,
  userId: string,
  input: GoalPhaseInput,
  endPrevious: boolean,
): Promise<CreateGoalPhaseResult> {
  // One open phase at a time: a second create waits here for the first to commit.
  await lockGoalPhases(tx, userId);
  const existing = await existingGoalPhase(tx, userId, input);
  if (existing !== undefined) return existing;
  const open = await openGoalPhase(tx, userId);
  if (open !== undefined) {
    if (!endPrevious) return { kind: 'phase_already_open', open };
    if (input.startedOn <= open.startedOn) return { kind: 'phase_start_not_after_open' };
    const end = dayBefore(input.startedOn);
    await tx
      .update(goalPhase)
      .set({ endedOn: end, updatedAt: sql`now()` })
      .where(and(eq(goalPhase.id, open.id), eq(goalPhase.userId, userId)));
  }
  const [created] = await tx
    .insert(goalPhase)
    .values({ ...input, userId })
    .returning(columns);
  if (created === undefined) throw new Error('goal phase insert returned no row');
  return { kind: 'created', phase: created };
}

export async function existingGoalPhase(
  tx: Transaction,
  userId: string,
  input: GoalPhaseInput,
): Promise<Extract<CreateGoalPhaseResult, { kind: 'existing' | 'id_conflict' }> | undefined> {
  const [stored] = await tx.select(columns).from(goalPhase).where(eq(goalPhase.id, input.id));
  if (stored !== undefined) {
    const [mine] = await tx
      .select({ id: goalPhase.id })
      .from(goalPhase)
      .where(and(eq(goalPhase.id, input.id), eq(goalPhase.userId, userId)));
    const same =
      mine !== undefined &&
      stored.type === input.type &&
      stored.startedOn === input.startedOn &&
      stored.targetRatePctPerWeek === input.targetRatePctPerWeek &&
      stored.proteinGPerKg === input.proteinGPerKg &&
      stored.fatPctCalories === input.fatPctCalories &&
      (input.calorieBasis === 'provisional_formula' ||
        stored.calorieTargetKcal === input.calorieTargetKcal) &&
      stored.calorieBasis === input.calorieBasis;
    return same ? { kind: 'existing', phase: stored } : { kind: 'id_conflict' };
  }
}

/**
 * Edits a phase's targets. Calories changed by the user set `calorieTargetSetAt`, which the targets
 * in force are read against (docs/09 F13). Undefined: no such phase of the caller's.
 */
export async function updateGoalPhase(
  db: Queryable,
  userId: string,
  id: string,
  patch: GoalPhasePatch,
): Promise<GoalPhase | undefined> {
  const [updated] = await db
    .update(goalPhase)
    .set({
      ...patch,
      ...(patch.calorieTargetKcal === undefined
        ? {}
        : {
            calorieTargetSetAt: sql`CASE WHEN ${goalPhase.calorieTargetKcal} = ${patch.calorieTargetKcal} THEN ${goalPhase.calorieTargetSetAt} ELSE now() END`,
          }),
      updatedAt: sql`now()`,
    })
    .where(and(eq(goalPhase.id, id), eq(goalPhase.userId, userId)))
    .returning(columns);
  return updated;
}

/**
 * Moves a phase's calories to the formula's new figure, only while they are still the formula's
 * `from`: calories the user set meanwhile are theirs and stay. False when nothing moved.
 */
export async function followFormulaCalories(
  db: Queryable,
  userId: string,
  id: string,
  from: number,
  to: number,
): Promise<boolean> {
  const moved = await db
    .update(goalPhase)
    .set({ calorieTargetKcal: to, calorieTargetSetAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(goalPhase.id, id),
        eq(goalPhase.userId, userId),
        isNull(goalPhase.endedOn),
        eq(goalPhase.calorieBasis, 'provisional_formula'),
        eq(goalPhase.calorieTargetKcal, from),
      ),
    )
    .returning({ id: goalPhase.id });
  return moved.length > 0;
}

/** The export's `phases` section: by id, a page at a time (docs/07 §2). */
export async function exportGoalPhases(
  db: Database,
  userId: string,
  page: { limit: number; after?: { id: string } | undefined },
): Promise<{ items: GoalPhase[]; next: { id: string } | null }> {
  const found = await db
    .select(columns)
    .from(goalPhase)
    .where(
      and(
        eq(goalPhase.userId, userId),
        page.after === undefined ? undefined : sql`${goalPhase.id} > ${page.after.id}::uuid`,
      ),
    )
    .orderBy(goalPhase.id)
    .limit(page.limit + 1);
  const items = found.slice(0, page.limit);
  const last = items.at(-1);
  return {
    items,
    next: found.length > page.limit && last !== undefined ? { id: last.id } : null,
  };
}
