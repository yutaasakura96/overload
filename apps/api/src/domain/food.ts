// A food's values per 100 g (S12, docs/04 `food`). Whatever basis a label, a database or the user
// gave (per piece, per serving, per package), the list keeps one: per 100 g of the state named, so
// everything downstream does one kind of arithmetic. Pure, for the API and its tests.

export const BASIS_KINDS = [
  'per_100g',
  'per_100ml',
  'per_piece',
  'per_serving',
  'per_package',
] as const;
export type BasisKind = (typeof BASIS_KINDS)[number];

/** The amount the values were given for: per 100 g, or per a piece, serving or package of `grams`. */
export type Basis = { kind: BasisKind; grams: number | null };

export const NUTRIENTS = ['energyKcal', 'proteinG', 'carbG', 'fatG', 'fiberG'] as const;
export type Nutrient = (typeof NUTRIENTS)[number];

export type Values = Record<Nutrient, number>;
/** Values as a source gave them: one it did not print is null, never a guess (docs/09 F9). */
export type GivenValues = Record<Nutrient, number | null>;

/** The highest a value can be per 100 g: pure fat is 900 kcal, and no part outweighs the whole. */
export const PER_100G_MAX: Values = {
  energyKcal: 900,
  proteinG: 100,
  carbG: 100,
  fatG: 100,
  fiberG: 100,
};

/** The grams the basis stands for; `per_100g` is 100 whatever else was said. Null without grams. */
export function basisGrams(basis: Basis): number | null {
  if (basis.kind === 'per_100g') return 100;
  return basis.grams !== null && basis.grams > 0 ? basis.grams : null;
}

/** One value per 100 g, to the hundredth, as `numeric(6,2)` keeps it. */
const per100 = (value: number, grams: number) => Math.round(((value * 100) / grams) * 100) / 100;

/**
 * The values per 100 g. A value not given stays null. Null when the basis has no weight to scale
 * by, which a basis other than `per_100g` needs.
 */
export function toPer100g(given: GivenValues, basis: Basis): GivenValues | null {
  const grams = basisGrams(basis);
  if (grams === null) return null;
  const scaled = (value: number | null) => (value === null ? null : per100(value, grams));
  return {
    energyKcal: scaled(given.energyKcal),
    proteinG: scaled(given.proteinG),
    carbG: scaled(given.carbG),
    fatG: scaled(given.fatG),
    fiberG: scaled(given.fiberG),
  };
}

/** The values per 100 g that are above what 100 g can hold, so the input was mistyped or misread. */
export const impossibleValues = (values: GivenValues): Nutrient[] =>
  NUTRIENTS.filter((nutrient) => {
    const value = values[nutrient];
    return value !== null && value > PER_100G_MAX[nutrient];
  });
