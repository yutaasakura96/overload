import type { Basis, Food, FoodCandidate, FoodSource, FoodState } from '@overload/api-contract';
import { create } from 'zustand';

// The food list's words and figures (docs/10 §8.6), and the candidate on its way to the check
// screen. A candidate is not a record (docs/09 F9): it lives in memory only, and leaving the check
// screen discards it.

export const NUTRIENTS = [
  { key: 'energyKcal', label: 'Calories', printed: 'Energy', unit: 'kcal' },
  { key: 'proteinG', label: 'Protein', printed: 'Protein', unit: 'g' },
  { key: 'carbG', label: 'Carbs', printed: 'Carbs', unit: 'g' },
  { key: 'fatG', label: 'Fat', printed: 'Fat', unit: 'g' },
  { key: 'fiberG', label: 'Fiber', printed: 'Fiber', unit: 'g' },
] as const;

export type NutrientKey = (typeof NUTRIENTS)[number]['key'];
export type Given = Record<NutrientKey, number | null>;

/** A figure as the screens print it: at most one decimal, no trailing zero. */
export const figure = (value: number) => String(Math.round(value * 10) / 10);

/** Calories in whole kcal, as every other screen prints them; the stored value keeps its hundredths. */
export const kcal = (value: number) => String(Math.round(value));

/** A nutrient's figure on a screen that only shows it: calories whole, the rest to one decimal. */
export const nutrientFigure = (key: NutrientKey, value: number) =>
  key === 'energyKcal' ? kcal(value) : figure(value);

/** `105 kcal · 23.3 g protein · per 100 g raw` (the food list's row). */
export const macroLine = (food: Pick<Food, 'energyKcal' | 'proteinG' | 'state'>) =>
  `${kcal(food.energyKcal)} kcal · ${figure(food.proteinG)} g protein · per 100 g ${food.state}`;

/**
 * MEXT's Japanese name as the screens print it: without the leading food-group label (`＜魚類＞`),
 * which the English name already says, and with its full-width spaces as one space.
 */
export const mextName = (name: string) =>
  name
    .replace(/^＜[^＞]*＞/u, '')
    .replace(/\s+/gu, ' ')
    .trim();

/** The name a food is known by in the MEXT table: English where MEXT had one, else its own. */
export const referenceName = (entry: { name: string; nameEn: string | null }) =>
  entry.nameEn ?? mextName(entry.name);

const SOURCE_WORDS: Record<FoodSource, string> = {
  mext: 'MEXT food table',
  open_food_facts: 'Open Food Facts',
  label_photo: 'Label photo',
  manual: 'Typed by hand',
};

/** `MEXT FOOD TABLE · 11220`, under one food's name. */
export const sourceLine = (food: Pick<Food, 'source' | 'sourceRef'>) =>
  `${SOURCE_WORDS[food.source].toUpperCase()}${food.sourceRef === null ? '' : ` · ${food.sourceRef}`}`;

export const BASES = [
  { kind: 'per_100g', label: 'Per 100 g' },
  { kind: 'per_piece', label: 'Per piece' },
  { kind: 'per_serving', label: 'Per serving' },
  { kind: 'per_package', label: 'Per package' },
] as const satisfies readonly { kind: Basis['kind']; label: string }[];

/** `Per package (113 g)`, the basis a source gave its values on. */
export function basisLabel(basis: Basis) {
  const label = BASES.find((each) => each.kind === basis.kind)?.label ?? 'Per 100 g';
  if (basis.kind === 'per_100g' || basis.grams === null) return label;
  return `${label} (${figure(basis.grams)} g)`;
}

/**
 * The values per 100 g, for the screen to show before saving. The API converts again when it saves
 * and its figures are the ones kept; this is the same arithmetic, for the preview only.
 */
export function previewPer100g(given: Given, basis: Basis): Given | null {
  const grams = basis.kind === 'per_100g' ? 100 : basis.grams;
  if (grams === null || !(grams > 0)) return null;
  const scale = (value: number | null) =>
    value === null ? null : Math.round(((value * 100) / grams) * 100) / 100;
  return {
    energyKcal: scale(given.energyKcal),
    proteinG: scale(given.proteinG),
    carbG: scale(given.carbG),
    fatG: scale(given.fatG),
    fiberG: scale(given.fiberG),
  };
}

/** What opens the check screen: where it came from, what it gave, and what it would duplicate. */
export type Candidate = {
  source: FoodSource;
  sourceRef: string | null;
  /** The check screen's subline: `LABEL PHOTO · READ 12:14`, `BARCODE · OPEN FOOD FACTS`. */
  sourceLine: string;
  name: string;
  brand: string | null;
  state: FoodState;
  /** The source's own values on its basis, for the `As printed` box. Null for MEXT and by hand. */
  printed: { basis: Basis; values: Given } | null;
  /** Converted values for the fields. Null by hand or when the source lacks a basis weight. */
  per100g: Given | null;
  /** The food on the list this would duplicate, said on the check screen. */
  existingFoodId: string | null;
};

/** A candidate typed by hand, from nothing, or carrying a barcode that was scanned first. */
export const manualCandidate = (barcode: string | null = null): Candidate => ({
  source: 'manual',
  sourceRef: barcode,
  sourceLine: 'TYPED BY HAND',
  name: '',
  brand: null,
  state: 'raw',
  printed: null,
  per100g: null,
  existingFoodId: null,
});

export const valuesOf = (source: FoodCandidate | Given): Given => ({
  energyKcal: source.energyKcal,
  proteinG: source.proteinG,
  carbG: source.carbG,
  fatG: source.fatG,
  fiberG: source.fiberG,
});

type CandidateStore = {
  candidate: Candidate | undefined;
  /** A barcode scanned but not found, carried to the label photo or the form as the food's key. */
  barcode: string | null;
};

export const useCandidateStore = create<CandidateStore>(() => ({
  candidate: undefined,
  barcode: null,
}));

export const holdCandidate = (candidate: Candidate) =>
  useCandidateStore.setState({ candidate, barcode: null });
export const holdBarcode = (barcode: string | null) => useCandidateStore.setState({ barcode });
export const dropCandidate = () =>
  useCandidateStore.setState({ candidate: undefined, barcode: null });
