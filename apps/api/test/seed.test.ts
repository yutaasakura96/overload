import { readFileSync } from 'node:fs';
import { eq, isNull, sql } from 'drizzle-orm';
import { expect, it } from 'vitest';
import {
  growMigration,
  growMigrationPath,
  renames,
  seedMigration,
  seedMigrationPath,
  seededExercises,
} from '../seed/exercises';
import { exercise } from '../src/db/schema';
import { useTestApp } from './harness';

const t = useTestApp();

// The seed migration is generated from seed/exercises.ts; the two must not drift apart.
it('the committed seed migration is what seed/exercises.ts generates', () => {
  expect(readFileSync(seedMigrationPath, 'utf8')).toBe(seedMigration());
});

// The first seed file has run everywhere, so it never changes; what came after is its own file.
it('the committed grow migration is what seed/exercises.ts generates', () => {
  expect(readFileSync(growMigrationPath, 'utf8')).toBe(growMigration());
});

it('seeds each name once, whatever the case, and no alias twice on one exercise', () => {
  const names = seededExercises.map((e) => e.name.toLowerCase());
  expect(names.filter((name, index) => names.indexOf(name) !== index)).toEqual([]);
  const repeated = seededExercises.filter((e) => new Set(e.aliases).size !== e.aliases.length);
  expect(repeated.map((e) => e.name)).toEqual([]);
});

it('preserves all original ids and leaves custom namesakes untouched', async () => {
  await t.db.delete(exercise).where(isNull(exercise.ownerUserId));
  await t.db.execute(sql.raw(seedMigration()));
  const before = await t.db
    .select({ id: exercise.id, name: exercise.name })
    .from(exercise)
    .where(isNull(exercise.ownerUserId));
  expect(before).toHaveLength(50);

  const { user } = await t.createSignedInUser('namesake@example.test');
  const [custom] = await t.db
    .insert(exercise)
    .values({ ownerUserId: user.id, name: 'push-up', equipment: 'bodyweight' })
    .returning({ id: exercise.id, name: exercise.name, muscleGroup: exercise.muscleGroup });

  for (const statement of growMigration().split('--> statement-breakpoint')) {
    if (statement.trim() !== '') await t.db.execute(sql.raw(statement));
  }

  const after = await t.db
    .select({ id: exercise.id, name: exercise.name })
    .from(exercise)
    .where(isNull(exercise.ownerUserId));
  expect(after).toHaveLength(185);
  const namesById = new Map(after.map(({ id, name }) => [id, name]));
  for (const { id, name } of before) {
    expect(namesById.get(id)).toBe(renames.find(([from]) => from === name)?.[1] ?? name);
  }
  const [customAfter] = await t.db
    .select({ id: exercise.id, name: exercise.name, muscleGroup: exercise.muscleGroup })
    .from(exercise)
    .where(eq(exercise.id, custom!.id));
  expect(customAfter).toEqual(custom);
});

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

it('the database holds the seeded list as the script has it', async () => {
  const rows = await t.db
    .select({ name: exercise.name, muscleGroup: exercise.muscleGroup, aliases: exercise.aliases })
    .from(exercise)
    .where(isNull(exercise.ownerUserId));

  expect(rows.toSorted(byName)).toEqual(
    seededExercises
      .map(({ name, muscleGroup, aliases }) => ({ name, muscleGroup, aliases }))
      .toSorted(byName),
  );
});
