import { and, asc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import type { Database, Queryable } from './connection.js';
import { food, rotationGroup } from './schema.js';

/**
 * A set of foods that stand in for each other (S12), with its members: the listed foods whose
 * `rotation_group_id` names it. A food is in one group at most, so membership is that column.
 */
export type RotationGroup = { id: string; name: string; foodIds: string[] };

async function withMembers(
  db: Queryable,
  userId: string,
  groups: { id: string; name: string }[],
): Promise<RotationGroup[]> {
  if (groups.length === 0) return [];
  const members = await db
    .select({ id: food.id, groupId: food.rotationGroupId })
    .from(food)
    .where(
      and(
        eq(food.userId, userId),
        isNull(food.archivedAt),
        inArray(
          food.rotationGroupId,
          groups.map((group) => group.id),
        ),
      ),
    )
    .orderBy(asc(sql`lower(${food.name})`), asc(food.id));
  return groups.map((group) => ({
    ...group,
    foodIds: members.filter((member) => member.groupId === group.id).map((member) => member.id),
  }));
}

/** Every group the user has, by name, each with its listed foods by name. */
export async function listRotationGroups(db: Database, userId: string): Promise<RotationGroup[]> {
  const groups = await db
    .select({ id: rotationGroup.id, name: rotationGroup.name })
    .from(rotationGroup)
    .where(eq(rotationGroup.userId, userId))
    .orderBy(asc(sql`lower(${rotationGroup.name})`), asc(rotationGroup.id));
  return withMembers(db, userId, groups);
}

async function getRotationGroup(
  db: Queryable,
  userId: string,
  id: string,
): Promise<RotationGroup | undefined> {
  const groups = await db
    .select({ id: rotationGroup.id, name: rotationGroup.name })
    .from(rotationGroup)
    .where(and(eq(rotationGroup.id, id), eq(rotationGroup.userId, userId)));
  const [found] = await withMembers(db, userId, groups);
  return found;
}

/** The indexes of the ids that are not the caller's listed foods, which are refused (docs/07 §1.3). */
async function unknownFoods(db: Queryable, userId: string, foodIds: string[]): Promise<number[]> {
  if (foodIds.length === 0) return [];
  const owned = await db
    .select({ id: food.id })
    .from(food)
    .where(and(eq(food.userId, userId), isNull(food.archivedAt), inArray(food.id, foodIds)));
  const ids = new Set(owned.map((row) => row.id));
  return foodIds.flatMap((id, index) => (ids.has(id) ? [] : [index]));
}

/** Makes `foodIds` the group's listed members: each moves here from any other group. */
async function setMembers(tx: Queryable, userId: string, groupId: string, foodIds: string[]) {
  await tx
    .update(food)
    .set({ rotationGroupId: null, updatedAt: sql`now()` })
    .where(
      and(
        eq(food.userId, userId),
        eq(food.rotationGroupId, groupId),
        isNull(food.archivedAt),
        foodIds.length === 0 ? undefined : notInArray(food.id, foodIds),
      ),
    );
  if (foodIds.length === 0) return;
  await tx
    .update(food)
    .set({ rotationGroupId: groupId, updatedAt: sql`now()` })
    .where(and(eq(food.userId, userId), inArray(food.id, foodIds)));
}

export type CreateGroupResult =
  | { kind: 'created'; group: RotationGroup }
  | { kind: 'existing'; group: RotationGroup }
  | { kind: 'id_conflict' }
  | { kind: 'unknown_foods'; indexes: number[] };

const sameMembers = (stored: string[], given: string[]) =>
  stored.length === given.length && given.every((id) => stored.includes(id));

/**
 * A group with its foods. A repeat with the same name and members returns the stored group;
 * anything else under that id is a conflict (docs/07 §1.2).
 */
export async function createRotationGroup(
  db: Database,
  userId: string,
  input: { id: string; name: string; foodIds: string[] },
): Promise<CreateGroupResult> {
  const unknown = await unknownFoods(db, userId, input.foodIds);
  if (unknown.length > 0) return { kind: 'unknown_foods', indexes: unknown };
  const created = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(rotationGroup)
      .values({ id: input.id, userId, name: input.name })
      .onConflictDoNothing()
      .returning({ id: rotationGroup.id });
    if (inserted.length === 0) return false;
    await setMembers(tx, userId, input.id, input.foodIds);
    return true;
  });
  const stored = await getRotationGroup(db, userId, input.id);
  if (created && stored !== undefined) return { kind: 'created', group: stored };
  const same =
    stored !== undefined && stored.name === input.name && sameMembers(stored.foodIds, input.foodIds);
  return same ? { kind: 'existing', group: stored } : { kind: 'id_conflict' };
}

export type UpdateGroupResult =
  | { kind: 'updated'; group: RotationGroup }
  | { kind: 'not_found' }
  | { kind: 'unknown_foods'; indexes: number[] };

/** Renames a group, or replaces its foods: those left out stay on the list, ungrouped. */
export async function updateRotationGroup(
  db: Database,
  userId: string,
  id: string,
  patch: { name?: string | undefined; foodIds?: string[] | undefined },
): Promise<UpdateGroupResult> {
  if (patch.foodIds !== undefined) {
    const unknown = await unknownFoods(db, userId, patch.foodIds);
    if (unknown.length > 0) return { kind: 'unknown_foods', indexes: unknown };
  }
  const found = await db.transaction(async (tx) => {
    const owned = await tx
      .update(rotationGroup)
      .set({ ...(patch.name === undefined ? {} : { name: patch.name }), updatedAt: sql`now()` })
      .where(and(eq(rotationGroup.id, id), eq(rotationGroup.userId, userId)))
      .returning({ id: rotationGroup.id });
    if (owned.length === 0) return false;
    if (patch.foodIds !== undefined) await setMembers(tx, userId, id, patch.foodIds);
    return true;
  });
  const group = found ? await getRotationGroup(db, userId, id) : undefined;
  return group === undefined ? { kind: 'not_found' } : { kind: 'updated', group };
}

/** Deletes a group. Its foods stay, ungrouped (`ON DELETE SET NULL`). */
export async function deleteRotationGroup(db: Database, userId: string, id: string): Promise<void> {
  await db
    .delete(rotationGroup)
    .where(and(eq(rotationGroup.id, id), eq(rotationGroup.userId, userId)));
}

/** S10's `rotationGroups` section: by id, a page at a time (docs/07 §2). */
export async function exportRotationGroups(
  db: Database,
  userId: string,
  page: { limit: number; after?: { id: string } | undefined },
): Promise<{ items: RotationGroup[]; next: { id: string } | null }> {
  const found = await db
    .select({ id: rotationGroup.id, name: rotationGroup.name })
    .from(rotationGroup)
    .where(
      and(
        eq(rotationGroup.userId, userId),
        page.after === undefined ? undefined : sql`${rotationGroup.id} > ${page.after.id}::uuid`,
      ),
    )
    .orderBy(asc(rotationGroup.id))
    .limit(page.limit + 1);
  const shown = found.slice(0, page.limit);
  const last = shown.at(-1);
  return {
    items: await withMembers(db, userId, shown),
    next: found.length > page.limit && last !== undefined ? { id: last.id } : null,
  };
}
