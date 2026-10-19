import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Database, Queryable } from './connection.js';
import { bodyMeasurement } from './schema.js';

/** One weigh-in as the API returns it (docs/07 §5). */
export type WeighIn = {
  id: string;
  measuredAt: Date;
  weightKg: number;
  bodyFatPct: number | null;
  source: 'apple_health' | 'manual';
};

/** A weigh-in typed by hand. Its id is made on the device (UUIDv7). */
export type WeighInInput = {
  id: string;
  measuredAt: string;
  weightKg: number;
  bodyFatPct?: number | null | undefined;
};

const columns = {
  id: bodyMeasurement.id,
  measuredAt: bodyMeasurement.measuredAt,
  weightKg: bodyMeasurement.weightKg,
  bodyFatPct: bodyMeasurement.bodyFatPct,
  source: bodyMeasurement.source,
};

/**
 * Every reading the user has, oldest first. The trend runs from the first one (docs/03 §8.3), and
 * one person's readings are a few a day at most, so they are read whole.
 */
export function listWeighIns(db: Queryable, userId: string): Promise<WeighIn[]> {
  return db
    .select(columns)
    .from(bodyMeasurement)
    .where(eq(bodyMeasurement.userId, userId))
    .orderBy(asc(bodyMeasurement.measuredAt), asc(bodyMeasurement.id));
}

export type CreateWeighInResult =
  | { kind: 'created'; weighIn: WeighIn }
  | { kind: 'existing'; weighIn: WeighIn }
  | { kind: 'id_conflict' }
  /** The user already has a typed weigh-in at that instant (`UNIQUE (user_id, source, measured_at)`). */
  | { kind: 'weigh_in_exists' };

/**
 * A weigh-in typed by hand. A repeat with the same content returns the stored row; anything else
 * under that id is a conflict (docs/07 §1.2).
 */
export async function createWeighIn(
  db: Database,
  userId: string,
  input: WeighInInput,
): Promise<CreateWeighInResult> {
  const measuredAt = new Date(input.measuredAt);
  const bodyFatPct = input.bodyFatPct ?? null;
  const [inserted] = await db
    .insert(bodyMeasurement)
    .values({
      id: input.id,
      userId,
      measuredAt,
      weightKg: input.weightKg,
      bodyFatPct,
      source: 'manual',
    })
    .onConflictDoNothing()
    .returning(columns);
  if (inserted !== undefined) return { kind: 'created', weighIn: inserted };

  const [stored] = await db
    .select(columns)
    .from(bodyMeasurement)
    .where(and(eq(bodyMeasurement.id, input.id), eq(bodyMeasurement.userId, userId)));
  if (stored !== undefined) {
    const same =
      stored.source === 'manual' &&
      stored.measuredAt.getTime() === measuredAt.getTime() &&
      stored.weightKg === input.weightKg &&
      stored.bodyFatPct === bodyFatPct;
    return same ? { kind: 'existing', weighIn: stored } : { kind: 'id_conflict' };
  }
  // Not the caller's id: either the instant is taken by another of their typed weigh-ins, or the id
  // is in use elsewhere, which is told apart from no row at all only as a conflict (docs/07 §1.3).
  const [atInstant] = await db
    .select({ id: bodyMeasurement.id })
    .from(bodyMeasurement)
    .where(
      and(
        eq(bodyMeasurement.userId, userId),
        eq(bodyMeasurement.source, 'manual'),
        eq(bodyMeasurement.measuredAt, measuredAt),
      ),
    );
  return atInstant === undefined ? { kind: 'id_conflict' } : { kind: 'weigh_in_exists' };
}

export type DeleteWeighInResult = { kind: 'deleted' } | { kind: 'managed_by_apple_health' };

/**
 * Deletes a typed weigh-in. One from Apple Health is refused: the next export would send it again
 * within 7 days, so it is deleted there (docs/07 §5). No row with that id is still a success.
 */
export async function deleteWeighIn(
  db: Database,
  userId: string,
  id: string,
): Promise<DeleteWeighInResult> {
  const [found] = await db
    .select({ source: bodyMeasurement.source })
    .from(bodyMeasurement)
    .where(and(eq(bodyMeasurement.id, id), eq(bodyMeasurement.userId, userId)));
  if (found?.source === 'apple_health') return { kind: 'managed_by_apple_health' };
  await db
    .delete(bodyMeasurement)
    .where(
      and(
        eq(bodyMeasurement.id, id),
        eq(bodyMeasurement.userId, userId),
        eq(bodyMeasurement.source, 'manual'),
      ),
    );
  return { kind: 'deleted' };
}

/** S10's `weighIns` section: newest first, then by id, a page at a time (docs/07 §2). */
export async function exportWeighIns(
  db: Database,
  userId: string,
  page: { limit: number; after?: { measuredAt: string; id: string } | undefined },
): Promise<{ items: WeighIn[]; next: { measuredAt: string; id: string } | null }> {
  const found = await db
    .select(columns)
    .from(bodyMeasurement)
    .where(
      and(
        eq(bodyMeasurement.userId, userId),
        page.after === undefined
          ? undefined
          : sql`(${bodyMeasurement.measuredAt}, ${bodyMeasurement.id}) < (${page.after.measuredAt}::timestamptz, ${page.after.id}::uuid)`,
      ),
    )
    .orderBy(desc(bodyMeasurement.measuredAt), desc(bodyMeasurement.id))
    .limit(page.limit + 1);
  const items = found.slice(0, page.limit);
  const last = items.at(-1);
  return {
    items,
    next:
      found.length > page.limit && last !== undefined
        ? { measuredAt: last.measuredAt.toISOString(), id: last.id }
        : null,
  };
}
