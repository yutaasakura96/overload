import { describe, expect, it } from 'vitest';
import { bestE1rmKg, epley } from '../src/domain/e1rm';
import { makeable, suggest } from '../src/domain/progression';

// The domain tests slice 3 brings (docs/11 §2): S3's progression rule and Epley with warm-ups
// excluded. Pure functions, so nothing here touches the database.

const sets = (...reps: number[]) => reps.map((r) => ({ weightKg: 80, reps: r }));

const dumbbellAt = (kg: number) =>
  suggest({
    sets: [{ weightKg: kg, reps: 12 }],
    repHigh: 12,
    incrementKg: 1,
    equipment: 'dumbbell',
  })?.weightKg;

describe('suggest (S3)', () => {
  it('adds the increment when every working set reached the top of the range', () => {
    expect(
      suggest({ sets: sets(10, 10, 10), repHigh: 10, incrementKg: 2.5, equipment: 'barbell' }),
    ).toEqual({
      weightKg: 82.5,
      rule: 'top_of_range_hit',
      reason: 'hit 10 on every set last time',
    });
  });

  it('counts reps past the top as reaching it', () => {
    const result = suggest({
      sets: sets(12, 10),
      repHigh: 10,
      incrementKg: 2.5,
      equipment: 'barbell',
    });
    expect(result?.rule).toBe('top_of_range_hit');
  });

  it('keeps the weight when any set fell short, and names the first one that did', () => {
    expect(
      suggest({ sets: sets(10, 8, 7), repHigh: 10, incrementKg: 2.5, equipment: 'barbell' }),
    ).toEqual({ weightKg: 80, rule: 'repeat', reason: 'set 2 stopped at 8 of 10 last time' });
  });

  it('starts from the heaviest working set when the weights varied', () => {
    const result = suggest({
      sets: [
        { weightKg: 77.5, reps: 10 },
        { weightKg: 80, reps: 10 },
      ],
      repHigh: 10,
      incrementKg: 2.5,
      equipment: 'barbell',
    });
    expect(result?.weightKg).toBe(82.5);
  });

  it('suggests nothing without a working set', () => {
    expect(
      suggest({ sets: [], repHigh: 10, incrementKg: 2.5, equipment: 'barbell' }),
    ).toBeUndefined();
  });

  it('rounds a dumbbell suggestion up to the rack', () => {
    expect(dumbbellAt(6)).toBe(7);
    expect(dumbbellAt(10)).toBe(12);
    expect(dumbbellAt(30)).toBe(32);
  });

  it('never moves a bodyweight exercise, whose increment is 0', () => {
    const result = suggest({
      sets: [{ weightKg: 0, reps: 15 }],
      repHigh: 12,
      incrementKg: 0,
      equipment: 'bodyweight',
    });
    expect(result).toMatchObject({ weightKg: 0, rule: 'top_of_range_hit' });
  });
});

describe('makeable', () => {
  it('rounds dumbbells to whole kilograms to 10 kg and to even ones above', () => {
    expect([0.5, 9.2, 10, 10.5, 11, 13, 32].map((kg) => makeable(kg, 'dumbbell'))).toEqual([
      1, 10, 10, 12, 12, 14, 32,
    ]);
  });

  it('leaves every other class at the hundredth the column holds', () => {
    expect(makeable(102.0587, 'barbell')).toBe(102.06);
    expect(makeable(52.5, 'machine_stack')).toBe(52.5);
  });
});

describe('Epley e1RM (S6, S7)', () => {
  it('is weight × (1 + reps / 30)', () => {
    expect(epley(100, 10)).toBeCloseTo(133.33, 2);
    expect(epley(80, 10)).toBeCloseTo(106.67, 2);
  });

  it('takes the best working set and leaves warm-ups out, however heavy their estimate', () => {
    const result = bestE1rmKg([
      { weightKg: 60, reps: 30, isWarmup: true },
      { weightKg: 80, reps: 10, isWarmup: false },
      { weightKg: 85, reps: 6, isWarmup: false },
    ]);
    expect(result).toBeCloseTo(106.67, 2);
  });

  it('has none for warm-ups alone', () => {
    expect(bestE1rmKg([{ weightKg: 40, reps: 10, isWarmup: true }])).toBeUndefined();
  });
});
