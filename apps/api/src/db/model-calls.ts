import { and, eq, lt, sql } from 'drizzle-orm';
import type { Database } from './connection.js';
import { modelCallCount } from './schema.js';

/**
 * Model calls per user per local day: label reads now, meal estimates in M3, counted together
 * (docs/06, 2026-09-22). The figure proposed in docs/13 §9.
 */
export const MODEL_CALLS_PER_DAY = 20;

/**
 * Counts one model call against the user's day, unless the day's calls have reached the cap: then
 * nothing is counted and the call must not be made. One statement, so two calls at once cannot
 * both take the last one.
 */
export async function takeModelCall(
  db: Database,
  userId: string,
  day: string,
  cap = MODEL_CALLS_PER_DAY,
): Promise<boolean> {
  const counted = await db
    .insert(modelCallCount)
    .values({ userId, day, calls: 1 })
    .onConflictDoUpdate({
      target: [modelCallCount.userId, modelCallCount.day],
      set: { calls: sql`${modelCallCount.calls} + 1`, updatedAt: sql`now()` },
      setWhere: and(
        eq(modelCallCount.userId, userId),
        eq(modelCallCount.day, day),
        lt(modelCallCount.calls, cap),
      ),
    })
    .returning({ calls: modelCallCount.calls });
  return counted.length > 0;
}
