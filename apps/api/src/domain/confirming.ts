// S18's confirmation of a planned meal (docs/07 §4, Confirming a meal; docs/09 F11): what a confirm
// body makes of the meal's items. Pure: the route reads the meal and the food list, and writes what
// this returns in place of any earlier confirmation, so a repeat never adds to it.

import type { Per100g } from './planner.js';

/** `planned` takes a confirmation back (the prototype's Undo); the other four confirm the meal. */
export type ConfirmStatus = 'planned' | 'as_planned' | 'skipped' | 'adjusted' | 'replaced';

/** One entry of an adjusted or replaced body, as sent. */
export type ConfirmEntry = {
  id: string;
  foodId?: string | undefined;
  name?: string | undefined;
  actualGrams?: number | undefined;
  pieceCount?: number | undefined;
  per100g?: Per100g | undefined;
};

/** A food from the list as the plan weighs it: cooked weight for a batch-cooked one (S16). */
export type ConfirmFood = {
  id: string;
  name: string;
  per100g: Per100g;
  cooked: boolean;
  approximate: boolean;
  noCookedMatch: boolean;
};

/** An item eaten that the plan did not have: swapped in, or eaten instead. */
export type EatenItem = {
  id: string;
  foodId: string | null;
  name: string;
  actualGrams: number;
  cooked: boolean;
  approximate: boolean;
  noCookedMatch: boolean;
  per100g: Per100g;
};

export type Confirmation = {
  status: ConfirmStatus;
  /** The grams eaten of each planned item given one; the others keep their planned amount. */
  actual: Map<string, number>;
  added: EatenItem[];
};

export type ConfirmError = { path: string; message: string };

const hundredths = (value: number) => Math.round(value * 100) / 100;

/**
 * The meal as confirmed, or what is wrong with the body. `planned` items are the meal's own; an
 * entry naming one changes its amount, and any other entry is a food eaten that was not planned.
 * A unit food's pieces become grams at its planned piece weight.
 */
export function resolveConfirmation(
  body: { status: ConfirmStatus; items?: ConfirmEntry[] | undefined },
  planned: { id: string; plannedGrams: number | null; pieceCount: number | null }[],
  foods: ConfirmFood[],
  eaten: EatenItem[] = [],
): { kind: 'confirmed'; confirmation: Confirmation } | { kind: 'invalid'; errors: ConfirmError[] } {
  const actual = new Map<string, number>();
  const added: EatenItem[] = [];
  const errors: ConfirmError[] = [];
  const entries = body.items ?? [];
  if (body.status !== 'adjusted' && body.status !== 'replaced') {
    if (entries.length > 0) errors.push({ path: 'items', message: 'Only adjusted and replaced' });
    return errors.length > 0
      ? { kind: 'invalid', errors }
      : { kind: 'confirmed', confirmation: { status: body.status, actual, added } };
  }
  if (entries.length === 0) errors.push({ path: 'items', message: 'At least one item' });
  // Eaten instead: every planned item stays, at 0 g, so the plan stays readable.
  if (body.status === 'replaced') for (const item of planned) actual.set(item.id, 0);

  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    const at = (field: string) => `items.${index}.${field}`;
    if (seen.has(entry.id)) {
      errors.push({ path: at('id'), message: 'Named twice' });
      return;
    }
    seen.add(entry.id);
    const own = planned.find((item) => item.id === entry.id);
    if (own !== undefined) {
      if (body.status === 'replaced') {
        errors.push({ path: at('id'), message: 'A planned item, not one eaten instead' });
        return;
      }
      if (entry.foodId !== undefined || entry.name !== undefined || entry.per100g !== undefined) {
        errors.push({ path: at('id'), message: 'A planned item takes an amount only' });
        return;
      }
      if ((entry.actualGrams === undefined) === (entry.pieceCount === undefined)) {
        errors.push({ path: at('actualGrams'), message: 'Grams or pieces, one of them' });
        return;
      }
      if (entry.actualGrams !== undefined) {
        actual.set(own.id, entry.actualGrams);
        return;
      }
      if (own.pieceCount === null || own.pieceCount <= 0 || own.plannedGrams === null) {
        errors.push({ path: at('pieceCount'), message: 'Not a food counted in pieces' });
        return;
      }
      actual.set(own.id, hundredths(((entry.pieceCount ?? 0) * own.plannedGrams) / own.pieceCount));
      return;
    }
    if (entry.pieceCount !== undefined) {
      errors.push({ path: at('pieceCount'), message: 'Grams for a food eaten instead' });
      return;
    }
    if (entry.actualGrams === undefined || entry.actualGrams <= 0) {
      errors.push({ path: at('actualGrams'), message: 'More than 0 g' });
      return;
    }
    if (entry.foodId !== undefined) {
      if (entry.name !== undefined || entry.per100g !== undefined) {
        errors.push({ path: at('foodId'), message: 'A food from the list, or by hand, not both' });
        return;
      }
      const previous = eaten.find((each) => each.id === entry.id && each.foodId === entry.foodId);
      if (previous !== undefined) {
        added.push({ ...previous, actualGrams: entry.actualGrams });
        return;
      }
      const food = foods.find((each) => each.id === entry.foodId);
      if (food === undefined) {
        errors.push({ path: at('foodId'), message: 'Not on your food list' });
        return;
      }
      added.push({
        id: entry.id,
        foodId: food.id,
        name: food.name,
        actualGrams: entry.actualGrams,
        cooked: food.cooked,
        approximate: food.approximate,
        noCookedMatch: food.noCookedMatch,
        per100g: food.per100g,
      });
      return;
    }
    if (entry.name === undefined || entry.per100g === undefined) {
      errors.push({ path: at('name'), message: 'A food from the list, or a name and its values' });
      return;
    }
    const previous = eaten.find(
      (each) =>
        each.id === entry.id &&
        each.foodId === null &&
        each.actualGrams === entry.actualGrams &&
        each.name === entry.name &&
        each.per100g.energyKcal === entry.per100g?.energyKcal &&
        each.per100g.proteinG === entry.per100g?.proteinG &&
        each.per100g.carbG === entry.per100g?.carbG &&
        each.per100g.fatG === entry.per100g?.fatG &&
        each.per100g.fiberG === entry.per100g?.fiberG,
    );
    if (previous !== undefined) {
      added.push(previous);
      return;
    }
    added.push({
      id: entry.id,
      foodId: null,
      name: entry.name,
      actualGrams: entry.actualGrams,
      cooked: false,
      approximate: false,
      noCookedMatch: false,
      per100g: entry.per100g,
    });
  });
  if (errors.length > 0) return { kind: 'invalid', errors };
  return { kind: 'confirmed', confirmation: { status: body.status, actual, added } };
}
