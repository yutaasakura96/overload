import { describe, expect, it, vi } from 'vitest';
import { basisGrams, impossibleValues, toPer100g } from '../src/domain/food';
import { labelReadOf, labelReader } from '../src/lib/label-reader';
import { candidateOf } from '../src/lib/open-food-facts';

// S12's conversion (issue #78): whatever basis a source gave, the list keeps per 100 g. Also how a
// model's answer and an Open Food Facts record become a candidate, without either service.

const given = { energyKcal: 121, proteinG: 26.4, carbG: 0.3, fatG: 1.5, fiberG: null };

describe('toPer100g', () => {
  it('keeps values given per 100 g, whatever grams were sent', () => {
    expect(toPer100g(given, { kind: 'per_100g', grams: null })).toEqual(given);
    expect(toPer100g(given, { kind: 'per_100g', grams: 55 })).toEqual(given);
  });

  it('scales a package by its weight, to the hundredth (docs/07 §4’s example)', () => {
    expect(toPer100g(given, { kind: 'per_package', grams: 110 })).toEqual({
      energyKcal: 110,
      proteinG: 24,
      carbG: 0.27,
      fatG: 1.36,
      fiberG: null,
    });
  });

  it('scales a piece and a serving the same way', () => {
    const egg = { energyKcal: 78.1, proteinG: 6.71, carbG: 0.17, fatG: 5.61, fiberG: 0 };
    expect(toPer100g(egg, { kind: 'per_piece', grams: 55 })).toEqual({
      energyKcal: 142,
      proteinG: 12.2,
      carbG: 0.31,
      fatG: 10.2,
      fiberG: 0,
    });
    expect(toPer100g(egg, { kind: 'per_serving', grams: 200 })?.energyKcal).toBe(39.05);
  });

  it('leaves a value not given as null, never a guess', () => {
    expect(toPer100g(given, { kind: 'per_serving', grams: 50 })?.fiberG).toBeNull();
  });

  it('cannot scale a basis without its weight', () => {
    expect(toPer100g(given, { kind: 'per_piece', grams: null })).toBeNull();
    expect(toPer100g(given, { kind: 'per_serving', grams: 0 })).toBeNull();
    expect(basisGrams({ kind: 'per_package', grams: null })).toBeNull();
  });
});

describe('impossibleValues', () => {
  it('names a value above what 100 g can hold', () => {
    expect(
      impossibleValues({ energyKcal: 950, proteinG: 101, carbG: 100, fatG: 0, fiberG: null }),
    ).toEqual(['energyKcal', 'proteinG']);
    expect(impossibleValues({ ...given, fiberG: 0 })).toEqual([]);
  });
});

describe('labelReadOf', () => {
  const answer = {
    readable: true,
    name: 'サラダチキン プレーン',
    brand: null,
    state: 'cooked',
    basisKind: 'per_package',
    basisGrams: 110,
    energyKcal: 121,
    proteinG: 26.4,
    carbG: 0.3,
    fatG: 1.5,
    fiberG: null,
  };

  it('makes the model’s answer a candidate on its basis', () => {
    expect(labelReadOf(answer)).toEqual({
      kind: 'read',
      model: 'claude-haiku-4-5',
      candidate: {
        name: 'サラダチキン プレーン',
        brand: null,
        state: 'cooked',
        basis: { kind: 'per_package', grams: 110 },
        energyKcal: 121,
        proteinG: 26.4,
        carbG: 0.3,
        fatG: 1.5,
        fiberG: null,
      },
    });
  });

  it('is unreadable when the model says so, or read no value at all', () => {
    expect(labelReadOf({ ...answer, readable: false })).toEqual({ kind: 'unreadable' });
    expect(
      labelReadOf({
        ...answer,
        energyKcal: null,
        proteinG: null,
        carbG: null,
        fatG: null,
        fiberG: null,
      }),
    ).toEqual({ kind: 'unreadable' });
    expect(labelReadOf({ ...answer, proteinG: -1 })).toEqual({ kind: 'unreadable' });
  });

  it('treats an answer outside the schema as the reader failing', () => {
    expect(labelReadOf({ readable: 'yes' })).toEqual({ kind: 'failed' });
    expect(labelReadOf(null)).toEqual({ kind: 'failed' });
  });

  it('keeps a basis without a printed weight, for the user to weigh', () => {
    const read = labelReadOf({ ...answer, basisKind: 'per_piece', basisGrams: null });
    expect(read.kind === 'read' && read.candidate.basis).toEqual({
      kind: 'per_piece',
      grams: null,
    });
  });
});

it('counts one upstream attempt for a failed label read', async () => {
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response('Service unavailable', { status: 503 }));
  try {
    const result = await labelReader({ apiKey: 'test-key' }).read({
      data: new Uint8Array([1]),
      mediaType: 'image/jpeg',
    });
    expect(result).toEqual({ kind: 'failed' });
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    fetch.mockRestore();
  }
});

describe('candidateOf (Open Food Facts)', () => {
  it('takes per 100 g values, the Japanese name first and the first brand', () => {
    expect(
      candidateOf({
        product_name: 'Greek yogurt',
        product_name_ja: 'ギリシャヨーグルト',
        brands: 'Oikos, Danone',
        nutrition_data_per: '100g',
        nutriments: {
          'energy-kcal_100g': 92,
          proteins_100g: 10.3,
          carbohydrates_100g: '4.1',
          fat_100g: 2.7,
        },
      }),
    ).toEqual({
      name: 'ギリシャヨーグルト',
      brand: 'Oikos',
      state: null,
      basis: { kind: 'per_100g', grams: 100 },
      energyKcal: 92,
      proteinG: 10.3,
      carbG: 4.1,
      fatG: 2.7,
      fiberG: null,
    });
  });

  it('takes per serving values when the label gave them so, with the serving’s grams', () => {
    const candidate = candidateOf({
      product_name: 'Protein bar',
      nutrition_data_per: 'serving',
      serving_quantity: 45,
      nutriments: { 'energy-kcal_serving': 190, proteins_serving: 15, energy_100g: 1766 },
    });
    expect(candidate.basis).toEqual({ kind: 'per_serving', grams: 45 });
    expect(candidate.energyKcal).toBe(190);
    expect(candidate.proteinG).toBe(15);
  });

  it('works out kcal from kJ only when kcal is missing, and leaves the rest null', () => {
    const candidate = candidateOf({ product_name: 'Water', nutriments: { energy_100g: 418.4 } });
    expect(candidate.energyKcal).toBe(100);
    expect(candidate.fatG).toBeNull();
    expect(candidateOf(undefined).name).toBeNull();
  });
});
