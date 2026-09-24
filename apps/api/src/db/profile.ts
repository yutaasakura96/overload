import { sql } from 'kysely';
import type { Database } from './connection';

export type Profile = {
  timezone: string;
  heightCm: number | null;
  sex: 'male' | 'female' | null;
  birthDate: string | null;
  trainingWeekdays: number[];
};

/** The user's profile, or null until they have set one up (the setup screen lands in slice 3). */
export async function getProfile(db: Database, userId: string): Promise<Profile | null> {
  const row = await db
    .selectFrom('userProfile')
    .select([
      'timezone',
      'heightCm',
      'sex',
      // A local date, so it never passes through a JavaScript Date and its time zone.
      sql<string | null>`to_char(birth_date, 'YYYY-MM-DD')`.as('birthDate'),
      'trainingWeekdays',
    ])
    .where('userId', '=', userId)
    .executeTakeFirst();
  if (row === undefined) return null;
  return {
    timezone: row.timezone,
    heightCm: row.heightCm === null ? null : Number(row.heightCm),
    sex: toSex(row.sex),
    birthDate: row.birthDate,
    trainingWeekdays: row.trainingWeekdays,
  };
}

// The column's CHECK allows exactly these, so a miss means the schema and this code disagree.
function toSex(value: string | null): Profile['sex'] {
  if (value === null || value === 'male' || value === 'female') return value;
  throw new Error(`user_profile.sex outside its CHECK: ${value}`);
}
