import { eq, sql } from 'drizzle-orm';
import type { Database } from './connection.js';
import { userProfile } from './schema.js';

export type Profile = {
  timezone: string;
  heightCm: number | null;
  sex: 'male' | 'female' | null;
  birthDate: string | null;
  trainingWeekdays: number[];
  /** How weights are shown. They are stored in kg whatever it says (docs/06, 2026-09-23). */
  weightUnit: 'kg' | 'lb';
};

const columns = {
  timezone: userProfile.timezone,
  heightCm: userProfile.heightCm,
  sex: userProfile.sex,
  // A local 'YYYY-MM-DD' string (the column's string mode), never a JavaScript Date.
  birthDate: userProfile.birthDate,
  trainingWeekdays: userProfile.trainingWeekdays,
  weightUnit: userProfile.weightUnit,
};

/**
 * The user's profile, or null until they have set one up. Its first reader is the day boundary:
 * the time zone local dates are read in (slice 3).
 */
export async function getProfile(db: Database, userId: string): Promise<Profile | null> {
  const [row] = await db.select(columns).from(userProfile).where(eq(userProfile.userId, userId));
  return row ?? null;
}

/**
 * Sets the fields given and leaves the rest. The first save creates the row, with the columns'
 * defaults for anything not given (docs/04 `user_profile`).
 */
export async function updateProfile(
  db: Database,
  userId: string,
  patch: Partial<Profile>,
): Promise<Profile> {
  const [row] = await db
    .insert(userProfile)
    .values({ userId, ...patch })
    .onConflictDoUpdate({
      target: userProfile.userId,
      set: { ...patch, updatedAt: sql`now()` },
    })
    .returning(columns);
  if (row === undefined) throw new Error('profile upsert returned no row');
  return row;
}
