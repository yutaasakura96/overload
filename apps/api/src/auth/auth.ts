import { betterAuth, type BetterAuthPlugin } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer } from 'better-auth/plugins';
import type { GoogleOptions } from 'better-auth/social-providers';
import type { Config } from '../config';
import { authSchema } from '../db/auth-schema';
import type { Database } from '../db/connection';
import { bootstrapAdminInvite, checkInvite } from './invite-gate';

const DAY_SECONDS = 60 * 60 * 24;

export type AuthDeps = {
  config: Config;
  /** Our Drizzle instance, over the one `pg` Pool (docs/03 §2). Better Auth queries through it. */
  db: Database;
  /**
   * Test seams only. Tests replace Google's network calls here, never the gate or the hooks, and
   * add the `testUtils()` plugin to a test-only instance (docs/11 §1).
   */
  google?: Pick<GoogleOptions, 'verifyIdToken' | 'getUserInfo'>;
  plugins?: BetterAuthPlugin[];
};

export function createAuth({ config, db, google, plugins = [] }: AuthDeps) {
  return betterAuth({
    appName: 'Overload',
    // The web origin: the Google callback returns through the rewrite, so the cookie is first-party
    // (docs/03 §5).
    baseURL: config.webOrigin,
    basePath: '/api/auth',
    secret: config.authSecret,
    trustedOrigins: [config.webOrigin],
    // Its tables are src/db/auth-schema.ts, snake_case in SQL through the Drizzle columns. The
    // adapter's schema check (on by default) compares that file with the fields Better Auth expects,
    // without touching the database, so a missing field fails the first auth call, not a query.
    database: drizzleAdapter(db, { provider: 'pg', schema: authSchema }),
    advanced: { database: { generateId: 'uuid' } },
    socialProviders: {
      google: {
        clientId: config.googleClientId,
        clientSecret: config.googleClientSecret,
        ...google,
      },
    },
    session: {
      expiresIn: 30 * DAY_SECONDS,
      updateAge: DAY_SECONDS,
      freshAge: DAY_SECONDS,
      // Off, so a revoked session stops working on its very next request (docs/08 §2).
      cookieCache: { enabled: false },
    },
    // In memory, the limiter would reset on every cold start (docs/08 §2).
    rateLimit: { enabled: true, storage: 'database' },
    user: {
      validateUserInfo: async ({ user }) => checkInvite(db, config.adminEmail, user),
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => bootstrapAdminInvite(db, config.adminEmail, user),
        },
      },
    },
    plugins: [bearer(), ...plugins],
  });
}

export type Auth = ReturnType<typeof createAuth>;
