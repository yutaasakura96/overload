import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { mextState, mextValue, readTsv, seedMigration, seedMigrationPath } from '../seed/mext';
import { useTestApp } from './harness';

// The MEXT catalogue (docs/04 `reference_food`, issue #78): the committed seed migration is what
// seed/mext.ts makes from the committed TSV, the database holds every row of it, and the app role
// cannot change it.
const t = useTestApp();

describe('the MEXT seed', () => {
  it('is the migration seed/mext.ts generates from mext-2023.tsv', () => {
    expect(readFileSync(seedMigrationPath, 'utf8')).toBe(seedMigration());
  });

  it('holds every food of the TSV, once, with the values the screens show', async () => {
    const foods = readTsv();
    expect(foods.length).toBeGreaterThan(2500);
    expect(new Set(foods.map((each) => each.code)).size).toBe(foods.length);
    const { rows } = await t.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM reference_food`,
    );
    expect(rows[0]?.n).toBe(foods.length);
    expect(foods.find((each) => each.code === '11220')).toEqual({
      code: '11220',
      foodGroup: 11,
      state: 'raw',
      name: '＜鳥肉類＞　にわとり　［若どり・主品目］　むね　皮なし　生',
      nameEn: 'Chicken, broiler, breast, meat without skin, raw',
      energyKcal: 105,
      proteinG: 23.3,
      carbG: 0.1,
      fatG: 1.9,
      fiberG: 0,
    });
  });

  it('is read-only to the app', async () => {
    await expect(
      t.db.execute(sql`UPDATE reference_food SET energy_kcal = 0 WHERE code = '11220'`),
    ).rejects.toThrow('Failed query');
  });
});

describe('reading MEXT’s cells', () => {
  it.each([
    ['23.3', 23.3],
    ['(3.4)', 3.4],
    ['Tr', 0],
    ['(Tr)', 0],
    ['-', null],
    ['', null],
    ['14.0†', 14],
  ])('reads %j as %j', (cell, value) => {
    expect(mextValue(cell)).toBe(value);
  });

  it('names a food cooked by MEXT’s cooking words', () => {
    expect(mextState('こめ　［水稲めし］　精白米　うるち米')).toBe('cooked');
    expect(mextState('ブロッコリー　花序　ゆで')).toBe('cooked');
    expect(mextState('ブロッコリー　花序　生')).toBe('raw');
    expect(mextState('えんばく　オートミール')).toBe('raw');
  });
});
