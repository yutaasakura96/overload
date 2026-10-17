import { and, asc, eq, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import type { Database, Queryable } from './connection.js';
import { food, rotationGroup } from './schema.js';

/** One food on the list as the API returns it (docs/07 §4): its values per 100 g. */
export type Food = {
  id: string;
  name: string;
  brand: string | null;
  state: 'raw' | 'cooked';
  energyKcal: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  fiberG: number;
  pieceWeightG: number | null;
  keepsDays: number | null;
  source: 'mext' | 'open_food_facts' | 'label_photo' | 'manual';
  sourceRef: string | null;
  rotationGroupId: string | null;
  archivedAt: Date | null;
};

/** A food to save, already per 100 g. Its id is made on the device (UUIDv7). */
export type FoodInput = Omit<Food, 'archivedAt'>;

export type FoodPatch = Partial<Omit<Food, 'id' | 'source' | 'sourceRef' | 'archivedAt'>>;

const columns = {
  id: food.id,
  name: food.name,
  brand: food.brand,
  state: food.state,
  energyKcal: food.energyKcal,
  proteinG: food.proteinG,
  carbG: food.carbG,
  fatG: food.fatG,
  fiberG: food.fiberG,
  pieceWeightG: food.pieceWeightG,
  keepsDays: food.keepsDays,
  source: food.source,
  sourceRef: food.sourceRef,
  rotationGroupId: food.rotationGroupId,
  archivedAt: food.archivedAt,
};

const byName = [asc(sql`lower(${food.name})`), asc(food.id)];

/** The list by name. Archived foods only when asked for: they are off the list. */
export function listFoods(
  db: Database,
  userId: string,
  options: { includeArchived?: boolean } = {},
): Promise<Food[]> {
  return db
    .select(columns)
    .from(food)
    .where(
      and(
        eq(food.userId, userId),
        options.includeArchived === true ? undefined : isNull(food.archivedAt),
      ),
    )
    .orderBy(...byName);
}

export async function getFood(
  db: Queryable,
  userId: string,
  id: string,
): Promise<Food | undefined> {
  const [found] = await db
    .select(columns)
    .from(food)
    .where(and(eq(food.id, id), eq(food.userId, userId)));
  return found;
}

/**
 * Whether a barcode or a MEXT code is on the list already, and as which food: archived foods are
 * off the list and do not count (docs/07 §4). Barcodes are one namespace whatever the source; MEXT
 * codes are another.
 */
const sameRef = (mext: boolean, sourceRef: string) =>
  and(sql`(${food.source} = 'mext') = ${mext}`, eq(food.sourceRef, sourceRef));

export async function listedBySourceRef(
  db: Database,
  userId: string,
  ref: { mext: boolean; sourceRefs: string[] },
): Promise<Map<string, string>> {
  if (ref.sourceRefs.length === 0) return new Map();
  const found = await db
    .select({ id: food.id, sourceRef: food.sourceRef })
    .from(food)
    .where(
      and(
        eq(food.userId, userId),
        isNull(food.archivedAt),
        sql`(${food.source} = 'mext') = ${ref.mext}`,
        inArray(food.sourceRef, ref.sourceRefs),
      ),
    );
  return new Map(found.map((row) => [row.sourceRef ?? '', row.id]));
}

/**
 * The listed food the input would duplicate: the same barcode or MEXT code, or the same name,
 * brand and state, whatever the case (the two keys of the custom migration 0017).
 */
async function duplicateOf(
  db: Queryable,
  userId: string,
  input: Pick<Food, 'name' | 'brand' | 'state' | 'source' | 'sourceRef'>,
  except?: string,
): Promise<string | undefined> {
  const keys: SQL[] = [
    sql`lower(${food.name}) = lower(${input.name}) AND lower(coalesce(${food.brand}, '')) = lower(${input.brand ?? ''}) AND ${food.state} = ${input.state}`,
  ];
  const ref =
    input.sourceRef === null ? undefined : sameRef(input.source === 'mext', input.sourceRef);
  if (ref !== undefined) keys.push(ref);
  const [found] = await db
    .select({ id: food.id })
    .from(food)
    .where(
      and(
        eq(food.userId, userId),
        isNull(food.archivedAt),
        except === undefined ? undefined : ne(food.id, except),
        or(...keys),
      ),
    )
    .limit(1);
  return found?.id;
}

/** Whether a rotation group is the caller's: another user's is refused as if it did not exist. */
async function ownsGroup(db: Queryable, userId: string, groupId: string | null | undefined) {
  if (groupId === null || groupId === undefined) return true;
  const [found] = await db
    .select({ id: rotationGroup.id })
    .from(rotationGroup)
    .where(and(eq(rotationGroup.id, groupId), eq(rotationGroup.userId, userId)));
  return found !== undefined;
}

export type CreateFoodResult =
  | { kind: 'created'; food: Food }
  | { kind: 'existing'; food: Food }
  | { kind: 'id_conflict' }
  | { kind: 'food_exists'; existingFoodId: string }
  | { kind: 'unknown_rotation_group' };

const FOOD_FIELDS = [
  'name',
  'brand',
  'state',
  'energyKcal',
  'proteinG',
  'carbG',
  'fatG',
  'fiberG',
  'pieceWeightG',
  'keepsDays',
  'source',
  'sourceRef',
  'rotationGroupId',
] as const satisfies readonly (keyof FoodInput)[];

const sameFood = (stored: Food, input: FoodInput) =>
  stored.archivedAt === null && FOOD_FIELDS.every((key) => stored[key] === input[key]);

/**
 * Adds a confirmed food. A repeat with the same content returns the stored food; a food already
 * on the list by its barcode, MEXT code, or name, brand and state is `food_exists`, naming it.
 */
export async function createFood(
  db: Database,
  userId: string,
  input: FoodInput,
): Promise<CreateFoodResult> {
  if (!(await ownsGroup(db, userId, input.rotationGroupId))) {
    return { kind: 'unknown_rotation_group' };
  }
  // DO NOTHING without a target also covers the two duplicate keys, so a race lands on one row.
  const [inserted] = await db
    .insert(food)
    .values({ ...input, userId })
    .onConflictDoNothing()
    .returning(columns);
  if (inserted !== undefined) return { kind: 'created', food: inserted };

  const stored = await getFood(db, userId, input.id);
  if (stored !== undefined) {
    return sameFood(stored, input) ? { kind: 'existing', food: stored } : { kind: 'id_conflict' };
  }
  const existingFoodId = await duplicateOf(db, userId, input);
  // Otherwise the id is in use by another user, which is told apart only as a conflict (§1.3).
  return existingFoodId === undefined
    ? { kind: 'id_conflict' }
    : { kind: 'food_exists', existingFoodId };
}

export type UpdateFoodResult =
  | { kind: 'updated'; food: Food }
  | { kind: 'not_found' }
  | { kind: 'food_exists'; existingFoodId: string }
  | { kind: 'unknown_rotation_group' };

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (('code' in error && error.code === '23505') ||
    ('cause' in error && isUniqueViolation(error.cause)));

/**
 * Edits a food's values, piece weight, keeping days or rotation group. Plans made before keep
 * the values they copied (docs/07 §4). A rename onto another listed food is `food_exists`.
 */
export async function updateFood(
  db: Database,
  userId: string,
  id: string,
  patch: FoodPatch,
): Promise<UpdateFoodResult> {
  const stored = await getFood(db, userId, id);
  if (stored === undefined) return { kind: 'not_found' };
  if (!(await ownsGroup(db, userId, patch.rotationGroupId))) {
    return { kind: 'unknown_rotation_group' };
  }
  const next = { ...stored, ...patch };
  const listed = stored.archivedAt === null;
  const duplicate = listed ? await duplicateOf(db, userId, next, id) : undefined;
  if (duplicate !== undefined) return { kind: 'food_exists', existingFoodId: duplicate };
  try {
    const [updated] = await db.transaction((tx) =>
      tx
        .update(food)
        .set({ ...patch, updatedAt: sql`now()` })
        .where(and(eq(food.id, id), eq(food.userId, userId)))
        .returning(columns),
    );
    if (updated === undefined) return { kind: 'not_found' };
    return { kind: 'updated', food: updated };
  } catch (error) {
    // Another save made the duplicate between the check and the update.
    if (!isUniqueViolation(error)) throw error;
    const existingFoodId = await duplicateOf(db, userId, next, id);
    if (existingFoodId === undefined) throw error;
    return { kind: 'food_exists', existingFoodId };
  }
}

/**
 * Archives a food: off the list and out of new plans, while past plans still name it. Archiving
 * again keeps the first time. No food with that id is still a success (docs/07 §1.2).
 */
export async function archiveFood(db: Database, userId: string, id: string): Promise<void> {
  await db
    .update(food)
    .set({ archivedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(eq(food.id, id), eq(food.userId, userId), isNull(food.archivedAt)));
}

/** S10's `foods` section, archived ones included: by id, a page at a time (docs/07 §2). */
export async function exportFoods(
  db: Database,
  userId: string,
  page: { limit: number; after?: { id: string } | undefined },
): Promise<{ items: Food[]; next: { id: string } | null }> {
  const found = await db
    .select(columns)
    .from(food)
    .where(
      and(
        eq(food.userId, userId),
        page.after === undefined ? undefined : sql`${food.id} > ${page.after.id}::uuid`,
      ),
    )
    .orderBy(asc(food.id))
    .limit(page.limit + 1);
  const items = found.slice(0, page.limit);
  const last = items.at(-1);
  return {
    items,
    next: found.length > page.limit && last !== undefined ? { id: last.id } : null,
  };
}
