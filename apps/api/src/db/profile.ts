import { eq } from 'drizzle-orm';
import type { Database } from './connection';
import { userProfile } from './schema';

export type Profile = {
  timezone: string;
  heightCm: number | null;
  sex: 'male' | 'female' | null;
  birthDate: string | null;
  trainingWeekdays: number[];
};

/** The user's profile, or null until they have set one up (the setup screen lands in slice 3). */
export async function getProfile(db: Database, userId: string): Promise<Profile | null> {
  const [row] = await db
    .select({
      timezone: userProfile.timezone,
      heightCm: userProfile.heightCm,
      sex: userProfile.sex,
      // A local 'YYYY-MM-DD' string (the column's string mode), never a JavaScript Date.
      birthDate: userProfile.birthDate,
      trainingWeekdays: userProfile.trainingWeekdays,
    })
    .from(userProfile)
    .where(eq(userProfile.userId, userId));
  return row ?? null;
}
