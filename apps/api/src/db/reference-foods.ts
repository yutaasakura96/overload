import { and, asc, desc, ilike, or, sql } from 'drizzle-orm';
import type { Database } from './connection.js';
import { referenceFood } from './schema.js';

/** One MEXT entry as the search returns it (docs/07 §4): values per 100 g of the state named. */
export type ReferenceFood = {
  code: string;
  name: string;
  nameEn: string | null;
  foodGroup: number;
  state: 'raw' | 'cooked';
  energyKcal: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  fiberG: number;
};

/** How many matches a search returns. */
export const SEARCH_LIMIT = 20;

/** `%` and `_` typed by the user are themselves, not wildcards. */
const literal = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`);

/**
 * The MEXT table searched by name, English or as MEXT prints it. Every word typed must appear in
 * one of the two. Best match first: a name that starts with what was typed, then raw before
 * cooked, then the shorter name, which is the plainer food.
 */
export function searchReferenceFoods(db: Database, q: string): Promise<ReferenceFood[]> {
  const words = q.trim().split(/\s+/u).filter(Boolean);
  const whole = literal(q.trim());
  return db
    .select({
      code: referenceFood.code,
      name: referenceFood.name,
      nameEn: referenceFood.nameEn,
      foodGroup: referenceFood.foodGroup,
      state: referenceFood.state,
      energyKcal: referenceFood.energyKcal,
      proteinG: referenceFood.proteinG,
      carbG: referenceFood.carbG,
      fatG: referenceFood.fatG,
      fiberG: referenceFood.fiberG,
    })
    .from(referenceFood)
    .where(
      and(
        ...words.map((word) =>
          or(
            ilike(referenceFood.name, `%${literal(word)}%`),
            ilike(referenceFood.nameEn, `%${literal(word)}%`),
          ),
        ),
      ),
    )
    .orderBy(
      desc(
        sql`(${referenceFood.nameEn} ILIKE ${`${whole}%`} OR ${referenceFood.name} ILIKE ${`${whole}%`})`,
      ),
      desc(sql`${referenceFood.state} = 'raw'`),
      asc(sql`length(coalesce(${referenceFood.nameEn}, ${referenceFood.name}))`),
      asc(referenceFood.code),
    )
    .limit(SEARCH_LIMIT);
}
