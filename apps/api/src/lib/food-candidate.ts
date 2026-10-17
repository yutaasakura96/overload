import type { Basis, GivenValues } from '../domain/food.js';

/**
 * What a lookup or a label read found: a candidate, never a saved food (docs/09 F9). Its values
 * are as the source gave them, on `basis`; one it did not give is null, never a guess.
 */
export type FoodCandidate = {
  name: string | null;
  brand: string | null;
  state: 'raw' | 'cooked' | null;
  basis: Basis;
} & GivenValues;

export type BarcodeLookup =
  | { kind: 'found'; candidate: FoodCandidate }
  | { kind: 'not_found' }
  | { kind: 'rate_limited' }
  | { kind: 'failed' };

/** Open Food Facts by barcode (docs/03 §4). Replaced by a stub in the tests. */
export type OpenFoodFacts = { lookup: (barcode: string) => Promise<BarcodeLookup> };

export type LabelRead =
  | { kind: 'read'; candidate: FoodCandidate; model: string }
  | { kind: 'unreadable' }
  | { kind: 'failed' };

/** A photo the reader accepts, held in memory only and never written anywhere (docs/07 §1.5). */
export type LabelImage = { data: Uint8Array; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' };

/**
 * The 栄養成分表示 reader (docs/03 §4). Null when the API has no Anthropic key, as until the
 * owner sets one (docs/00): the route then answers as if the reader were down, and counts nothing.
 */
export type LabelReader = { read: (image: LabelImage) => Promise<LabelRead> };
