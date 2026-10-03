// The one place a session cookie is minted outside a real Google sign-in: Better Auth's testUtils()
// on a test-only instance, never the production config (docs/11 §1). Used by the browser-test
// fixture (session.ts) and by `pnpm dev:session` (scripts/dev-session-core.ts), and by nothing in src.
import { testUtils, type TestHelpers } from 'better-auth/plugins';
import { asc, eq } from 'drizzle-orm';
import { createAuth } from '../../src/auth/auth';
import type { Config } from '../../src/config';
import type { Database } from '../../src/db/connection';
import { exercise, set, user, workout, workoutExercise } from '../../src/db/schema';

export type SessionCookie = Awaited<ReturnType<TestHelpers['getCookies']>>[number];

/** A user with this email, inserted directly. */
export async function insertUser(db: Database, email: string, name: string): Promise<string> {
  // Inserted directly: testUtils' saveUser runs validateUserInfo, which Better Auth 1.7.5 refuses
  // outside an endpoint context.
  const [created] = await db
    .insert(user)
    .values({ email, name, emailVerified: true })
    .returning({ id: user.id });
  if (created === undefined) throw new Error('user insert returned no row');
  return created.id;
}

/** The existing user with this email, or a new one. */
export async function findOrInsertUser(db: Database, email: string, name: string) {
  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  if (existing !== undefined) return { userId: existing.id, created: false };
  return { userId: await insertUser(db, email, name), created: true };
}

/** Removes the user and, through the foreign keys, every row of theirs. */
export async function deleteUser(db: Database, email: string) {
  await db.delete(user).where(eq(user.email, email));
}

/** A new session row for the user, and its signed cookie as Playwright's addCookies() takes it. */
export async function mintSessionCookies(opts: {
  config: Config;
  db: Database;
  userId: string;
  /** Defaults to the web origin's host. */
  domain?: string;
}): Promise<SessionCookie[]> {
  const auth = createAuth({ config: opts.config, db: opts.db, plugins: [testUtils()] });
  // `ctx.test` is typed only when testUtils() is in a static plugin list.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const { test } = (await auth.$context) as unknown as { test: TestHelpers };
  return test.getCookies({ userId: opts.userId, domain: opts.domain });
}

/** A user's workouts as the server holds them, oldest first, each with its exercises and sets. */
export async function storedWorkouts(db: Database, userId: string) {
  const workouts = await db
    .select()
    .from(workout)
    .where(eq(workout.userId, userId))
    .orderBy(asc(workout.startedAt));
  const exercises = await db
    .select({ row: workoutExercise, name: exercise.name })
    .from(workoutExercise)
    .innerJoin(workout, eq(workout.id, workoutExercise.workoutId))
    .innerJoin(exercise, eq(exercise.id, workoutExercise.exerciseId))
    .where(eq(workout.userId, userId))
    .orderBy(asc(workoutExercise.position));
  const sets = await db
    .select({ row: set })
    .from(set)
    .innerJoin(workoutExercise, eq(workoutExercise.id, set.workoutExerciseId))
    .innerJoin(workout, eq(workout.id, workoutExercise.workoutId))
    .where(eq(workout.userId, userId))
    .orderBy(asc(set.position));
  return workouts.map((stored) => ({
    name: stored.name,
    routineId: stored.routineId,
    startedAt: stored.startedAt,
    endedAt: stored.endedAt,
    exercises: exercises
      .filter(({ row }) => row.workoutId === stored.id)
      .map(({ row, name }) => ({
        name,
        targetSets: row.targetSets,
        repLow: row.repLow,
        repHigh: row.repHigh,
        incrementKg: row.incrementKg,
        sets: sets
          .filter((each) => each.row.workoutExerciseId === row.id)
          .map((each) => ({
            weightKg: each.row.weightKg,
            reps: each.row.reps,
            rir: each.row.rir,
            isWarmup: each.row.isWarmup,
            performedAt: each.row.performedAt,
          })),
      })),
  }));
}
