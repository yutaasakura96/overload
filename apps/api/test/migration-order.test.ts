import { describe, expect, it } from 'vitest';
import { migrationOrderViolations } from '../scripts/migration-order';

const entry = (idx: number, when: number) => ({ idx, when, tag: `000${idx}_m` });

describe('migrationOrderViolations', () => {
  it('passes a journal whose `when` values strictly increase', () => {
    expect(migrationOrderViolations([entry(0, 100), entry(1, 200), entry(2, 300)])).toEqual([]);
  });

  it('names an entry whose `when` equals the previous one', () => {
    expect(migrationOrderViolations([entry(0, 100), entry(1, 100)])).toEqual([
      '0001_m (when 100) is not later than 0000_m (when 100)',
    ]);
  });

  // A branch that renumbered its migration after another merged first, keeping its older `when`.
  it('names an entry whose `when` decreases', () => {
    expect(migrationOrderViolations([entry(0, 100), entry(1, 300), entry(2, 200)])).toEqual([
      '0002_m (when 200) is not later than 0001_m (when 300)',
    ]);
  });
});
