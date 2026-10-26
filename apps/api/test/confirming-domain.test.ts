import { describe, expect, it } from 'vitest';
import { resolveConfirmation, type ConfirmFood } from '../src/domain/confirming';

// What a confirm body makes of a meal's items (S18, docs/07 §4, Confirming a meal), apart from the
// route: pieces turned into grams, the planned items a replace keeps at 0 g, and each refusal.

const planned = [
  { id: 'rice', plannedGrams: 160, pieceCount: null },
  { id: 'egg', plannedGrams: 165, pieceCount: 3 },
];
const values = { energyKcal: 59, proteinG: 10.3, carbG: 3.6, fatG: 0.4, fiberG: 0 };
const yogurt: ConfirmFood = {
  id: 'yogurt',
  name: 'Greek yogurt',
  per100g: values,
  cooked: false,
  approximate: false,
  noCookedMatch: false,
};

/** The paths a body is refused at, or none. */
function paths(body: Parameters<typeof resolveConfirmation>[0]) {
  const result = resolveConfirmation(body, planned, [yogurt]);
  return result.kind === 'invalid' ? result.errors.map((error) => error.path) : [];
}

describe('resolveConfirmation', () => {
  it('turns pieces of a unit food into grams at its planned piece weight', () => {
    const result = resolveConfirmation(
      { status: 'adjusted', items: [{ id: 'egg', pieceCount: 2 }] },
      planned,
      [],
    );
    expect(result.kind === 'confirmed' && [...result.confirmation.actual]).toEqual([['egg', 110]]);
  });

  it('keeps every planned item at 0 g on a replace, with the food eaten instead added', () => {
    const result = resolveConfirmation(
      { status: 'replaced', items: [{ id: 'new', foodId: 'yogurt', actualGrams: 200 }] },
      planned,
      [yogurt],
    );
    expect(result).toMatchObject({
      kind: 'confirmed',
      confirmation: {
        status: 'replaced',
        actual: new Map([
          ['rice', 0],
          ['egg', 0],
        ]),
        added: [{ id: 'new', foodId: 'yogurt', name: 'Greek yogurt', actualGrams: 200 }],
      },
    });
  });

  it('keeps a food typed by hand on an adjust, as an earlier replace left it', () => {
    const result = resolveConfirmation(
      {
        status: 'adjusted',
        items: [{ id: 'ramen', name: 'Ramen', actualGrams: 100, per100g: values }],
      },
      planned,
      [],
    );
    expect(result.kind === 'confirmed' && result.confirmation.added[0]?.foodId).toBeNull();
  });

  it('refuses pieces of a food weighed in grams, an id named twice, and items on as planned', () => {
    expect(paths({ status: 'adjusted', items: [{ id: 'rice', pieceCount: 2 }] })).toEqual([
      'items.0.pieceCount',
    ]);
    expect(
      paths({
        status: 'adjusted',
        items: [
          { id: 'rice', actualGrams: 10 },
          { id: 'rice', actualGrams: 20 },
        ],
      }),
    ).toEqual(['items.1.id']);
    expect(paths({ status: 'as_planned', items: [{ id: 'rice', actualGrams: 10 }] })).toEqual([
      'items',
    ]);
    expect(
      paths({ status: 'adjusted', items: [{ id: 'rice', actualGrams: 10, pieceCount: 1 }] }),
    ).toEqual(['items.0.actualGrams']);
  });
});
