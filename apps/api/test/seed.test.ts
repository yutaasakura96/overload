import { readFileSync } from 'node:fs';
import { and, eq, isNull } from 'drizzle-orm';
import { expect, it } from 'vitest';
import {
  fileCustomNamesakes,
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

it('only updates and inserts, so every seeded id survives', () => {
  expect(growMigration()).not.toMatch(/\b(DELETE|TRUNCATE|DROP)\b/i);
  for (const [from] of renames) {
    expect(readFileSync(seedMigrationPath, 'utf8')).toContain(`('${from}',`);
  }
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

// A custom exercise made before the list grew may share a name with a new seeded one. It stays the
// user's own; the migration only files it under the seeded row's muscle group.
it('files a custom namesake under the seeded exercise’s muscle group and leaves the rest', async () => {
  const { user } = await t.createSignedInUser('namesake@example.test');
  const [namesake, filed, unrelated] = await t.db
    .insert(exercise)
    .values([
      { ownerUserId: user.id, name: 'push-up', equipment: 'bodyweight' },
      {
        ownerUserId: user.id,
        name: 'Barbell Shrug',
        equipment: 'barbell',
        muscleGroup: 'shoulders',
      },
      { ownerUserId: user.id, name: 'Cable Y-Raise', equipment: 'cable' },
    ])
    .returning({ id: exercise.id });

  await t.db.execute(fileCustomNamesakes);

  const groupOf = async (id: string) => {
    const [row] = await t.db
      .select({ name: exercise.name, muscleGroup: exercise.muscleGroup })
      .from(exercise)
      .where(and(eq(exercise.id, id), eq(exercise.ownerUserId, user.id)));
    return row;
  };
  expect(await groupOf(namesake!.id)).toEqual({ name: 'push-up', muscleGroup: 'chest' });
  expect(await groupOf(filed!.id)).toEqual({ name: 'Barbell Shrug', muscleGroup: 'shoulders' });
  expect(await groupOf(unrelated!.id)).toEqual({ name: 'Cable Y-Raise', muscleGroup: null });
});
