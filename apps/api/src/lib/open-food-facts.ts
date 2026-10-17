import { z } from 'zod';
import type { BarcodeLookup, FoodCandidate, OpenFoodFacts } from './food-candidate.js';

// Open Food Facts' product read, API v2 (docs/03 §4): 15 product reads a minute per IP, and a
// User-Agent naming the app and a contact. Its record is untrusted input and goes through a schema
// (docs/03 §10). Nothing of it is stored but what the user confirms; a barcode is not logged.

const FIELDS = [
  'code',
  'product_name',
  'product_name_ja',
  'brands',
  'nutriments',
  'nutrition_data_per',
  'serving_quantity',
  'serving_quantity_unit',
  'product_quantity_unit',
].join(',');

const TIMEOUT_MS = 8000;
const KJ_PER_KCAL = 4.184;

const figure = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() !== '' ? Number(value) : value),
  z.number().finite().nonnegative(),
);
const optional = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);

const Product = z.object({
  status: z.number(),
  product: optional(
    z.object({
      product_name: optional(z.string()),
      product_name_ja: optional(z.string()),
      brands: optional(z.string()),
      nutrition_data_per: optional(z.string()),
      serving_quantity: optional(figure),
      serving_quantity_unit: optional(z.string()),
      product_quantity_unit: optional(z.string()),
      nutriments: optional(z.record(z.string(), z.unknown())),
    }),
  ),
});

const text = (value: string | undefined) => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
};

/** A nutriment on the basis read, or null when the record does not give it. */
function nutriment(nutriments: Record<string, unknown>, key: string, suffix: string) {
  const read = figure.safeParse(nutriments[`${key}${suffix}`]);
  return read.success ? read.data : null;
}

/**
 * The candidate in a record. Values are taken on the basis the product's label gave them, per
 * serving when the record says so and knows the serving's amount, else per 100 g. A record whose
 * amounts are in ml gives its values per ml, not per gram: a serving then has no grams and the
 * per-100 basis becomes per 100 ml, so the member weighs it, as for a label (docs/09 F9).
 */
export function candidateOf(record: z.infer<typeof Product>['product']): FoodCandidate {
  const nutriments = record?.nutriments ?? {};
  const servingAmount = record?.serving_quantity;
  const perServing =
    record?.nutrition_data_per === 'serving' && servingAmount !== undefined && servingAmount > 0;
  const servingUnit = record?.serving_quantity_unit?.trim().toLowerCase();
  const productUnit = record?.product_quantity_unit?.trim().toLowerCase();
  const isVolume = perServing
    ? (servingUnit || productUnit) === 'ml'
    : record?.nutrition_data_per === '100ml' || (productUnit || servingUnit) === 'ml';
  const suffix = perServing ? '_serving' : '_100g';
  const kj = nutriment(nutriments, 'energy-kj', suffix) ?? nutriment(nutriments, 'energy', suffix);
  const kcal =
    nutriment(nutriments, 'energy-kcal', suffix) ??
    (kj === null ? null : Math.round((kj / KJ_PER_KCAL) * 10) / 10);
  return {
    name: text(record?.product_name_ja) ?? text(record?.product_name),
    brand: text(record?.brands?.split(',')[0]),
    state: null,
    basis: perServing
      ? { kind: 'per_serving', grams: isVolume ? null : (servingAmount ?? null) }
      : isVolume
        ? { kind: 'per_100ml', grams: null }
        : { kind: 'per_100g', grams: 100 },
    energyKcal: kcal,
    proteinG: nutriment(nutriments, 'proteins', suffix),
    carbG: nutriment(nutriments, 'carbohydrates', suffix),
    fatG: nutriment(nutriments, 'fat', suffix),
    fiberG: nutriment(nutriments, 'fiber', suffix),
  };
}

export function openFoodFacts({
  userAgent,
  fetch: get = fetch,
}: {
  userAgent: string;
  fetch?: typeof fetch;
}): OpenFoodFacts {
  return {
    async lookup(barcode): Promise<BarcodeLookup> {
      let response: Response;
      try {
        response = await get(
          `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}?fields=${FIELDS}`,
          { headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(TIMEOUT_MS) },
        );
      } catch {
        return { kind: 'failed' };
      }
      if (response.status === 429) return { kind: 'rate_limited' };
      if (response.status === 404) return { kind: 'not_found' };
      if (!response.ok) return { kind: 'failed' };
      const read = Product.safeParse(await response.json().catch(() => undefined));
      if (!read.success) return { kind: 'failed' };
      if (read.data.status !== 1 || read.data.product === undefined) return { kind: 'not_found' };
      return { kind: 'found', candidate: candidateOf(read.data.product) };
    },
  };
}
