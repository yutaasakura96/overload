import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { seedMigration, seedMigrationPath } from '../seed/exercises';

// The seed migration is generated from seed/exercises.ts; the two must not drift apart.
it('the committed seed migration is what seed/exercises.ts generates', () => {
  expect(readFileSync(seedMigrationPath, 'utf8')).toBe(seedMigration());
});
