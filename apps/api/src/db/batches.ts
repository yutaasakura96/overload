import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Database, Queryable } from './connection.js';
import { batch, food } from './schema.js';

/** One batch as the API returns it (docs/07 §4); its yield is derived on the way out. */
export type Batch = {
  id: string;
  foodId: string;
  rawWeightG: number;
  cookedWeightG: number;
  cookedOn: string;
  note: string | null;
};

/** A batch recorded on the device. Its id is made there (UUIDv7). */
export type BatchInput = Omit<Batch, 'note'> & { note?: string | null | undefined };

const columns = {
  id: batch.id,
  foodId: batch.foodId,
  rawWeightG: batch.rawWeightG,
  cookedWeightG: batch.cookedWeightG,
  cookedOn: batch.cookedOn,
  note: batch.note,
};

const newestFirst = [desc(batch.cookedOn), desc(batch.id)] as const;

/** Every batch the user has recorded, newest cook day first. */
export function listBatches(db: Queryable, userId: string): Promise<Batch[]> {
  return db
    .select(columns)
    .from(batch)
    .where(eq(batch.userId, userId))
    .orderBy(...newestFirst);
}

/** One food's batches, newest first; undefined when the food is not the caller's. */
export async function listFoodBatches(
  db: Queryable,
  userId: string,
  foodId: string,
): Promise<Batch[] | undefined> {
  const [owned] = await db
    .select({ id: food.id })
    .from(food)
    .where(and(eq(food.id, foodId), eq(food.userId, userId)));
  if (owned === undefined) return undefined;
  return db
    .select(columns)
    .from(batch)
    .where(and(eq(batch.userId, userId), eq(batch.foodId, foodId)))
    .orderBy(...newestFirst);
}

/** The batch in use for each food that has one: its newest (S13). */
export function newestBatches(db: Queryable, userId: string): Promise<Batch[]> {
  return db
    .selectDistinctOn([batch.foodId], columns)
    .from(batch)
    .where(eq(batch.userId, userId))
    .orderBy(asc(batch.foodId), ...newestFirst);
}

export type CreateBatchResult =
  | { kind: 'created'; batch: Batch }
  | { kind: 'existing'; batch: Batch }
  | { kind: 'id_conflict' }
  /** The food is not on the caller's list. */
  | { kind: 'unknown_food' };

/**
 * A batch of one of the caller's listed foods. A repeat with the same content returns the stored
 * row; anything else under that id is a conflict (docs/07 §1.2).
 */
export async function createBatch(
  db: Database,
  userId: string,
  input: BatchInput,
): Promise<CreateBatchResult> {
  const note = input.note ?? null;
  const [owned] = await db
    .select({ id: food.id })
    .from(food)
    .where(and(eq(food.id, input.foodId), eq(food.userId, userId), isNull(food.archivedAt)));
  const [stored] = await db
    .select({ ...columns, userId: batch.userId })
    .from(batch)
    .where(eq(batch.id, input.id));
  if (stored === undefined && owned === undefined) return { kind: 'unknown_food' };
  if (stored === undefined) {
    const [inserted] = await db
      .insert(batch)
      .values({
        id: input.id,
        userId,
        foodId: input.foodId,
        rawWeightG: input.rawWeightG,
        cookedWeightG: input.cookedWeightG,
        cookedOn: input.cookedOn,
        note,
      })
      .onConflictDoNothing()
      .returning(columns);
    if (inserted !== undefined) return { kind: 'created', batch: inserted };
  }
  const [again] = await db
    .select({ ...columns, userId: batch.userId })
    .from(batch)
    .where(eq(batch.id, input.id));
  if (again === undefined || again.userId !== userId) return { kind: 'id_conflict' };
  const { userId: _owner, ...found } = again;
  const same =
    found.foodId === input.foodId &&
    found.rawWeightG === input.rawWeightG &&
    found.cookedWeightG === input.cookedWeightG &&
    found.cookedOn === input.cookedOn &&
    found.note === note;
  return same ? { kind: 'existing', batch: found } : { kind: 'id_conflict' };
}

/** Deletes one batch. Plan items that used it keep their values; their link to it is cleared. */
export async function deleteBatch(db: Database, userId: string, id: string): Promise<void> {
  await db.delete(batch).where(and(eq(batch.id, id), eq(batch.userId, userId)));
}

/** S10's `batches` section: by id, a page at a time (docs/07 §2). */
export async function exportBatches(
  db: Database,
  userId: string,
  page: { limit: number; after?: { id: string } | undefined },
): Promise<{ items: Batch[]; next: { id: string } | null }> {
  const found = await db
    .select(columns)
    .from(batch)
    .where(
      and(
        eq(batch.userId, userId),
        page.after === undefined ? undefined : sql`${batch.id} > ${page.after.id}::uuid`,
      ),
    )
    .orderBy(asc(batch.id))
    .limit(page.limit + 1);
  const items = found.slice(0, page.limit);
  const last = items.at(-1);
  return {
    items,
    next: found.length > page.limit && last !== undefined ? { id: last.id } : null,
  };
}
