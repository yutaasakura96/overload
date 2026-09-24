import { betterAuth, type BetterAuthPlugin } from 'better-auth';
import { bearer } from 'better-auth/plugins';
import type { GoogleOptions } from 'better-auth/social-providers';
import { PostgresDialect } from 'kysely';
import type { Pool } from 'pg';
import type { Config } from '../config';
import type { Database } from '../db/connection';
import { bootstrapAdminInvite, checkInvite } from './invite-gate';
import { snakeCaseSchema } from './snake-case-schema';

const DAY_SECONDS = 60 * 60 * 24;

export type AuthDeps = {
  config: Config;
  /** The one Pool, shared with our own Kysely instance (docs/03 §2). */
  pool: Pool;
  db: Database;
  /**
   * Test seams only. Tests replace Google's network calls here, never the gate or the hooks, and
   * add the `testUtils()` plugin to a test-only instance (docs/11 §1).
   */
  google?: Pick<GoogleOptions, 'verifyIdToken' | 'getUserInfo'>;
  plugins?: BetterAuthPlugin[];
};

export function createAuth({ config, pool, db, google, plugins = [] }: AuthDeps) {
  return betterAuth({
    appName: 'Overload',
    // The web origin: the Google callback returns through the rewrite, so the cookie is first-party
    // (docs/03 §5).
    baseURL: config.webOrigin,
    basePath: '/api/auth',
    secret: config.authSecret,
    trustedOrigins: [config.webOrigin],
    // Its own Kysely instance, without our camelCase plugin, over the same Pool.
    database: { dialect: new PostgresDialect({ pool }), type: 'postgres' },
    advanced: {
      database: {
        generateId: 'uuid',
        // On by default, it introspects the database whenever an instance starts, so a cold start
        // serving /api/health would wake Neon. The migrations are the schema's authority, and the
        // API tests sign in against it.
        validateSchema: false,
      },
    },
    socialProviders: {
      google: {
        clientId: config.googleClientId,
        clientSecret: config.googleClientSecret,
        ...google,
      },
    },
    session: {
      ...snakeCaseSchema.session,
      expiresIn: 30 * DAY_SECONDS,
      updateAge: DAY_SECONDS,
      freshAge: DAY_SECONDS,
      // Off, so a revoked session stops working on its very next request (docs/08 §2).
      cookieCache: { enabled: false },
    },
    account: snakeCaseSchema.account,
    verification: snakeCaseSchema.verification,
    // In memory, the limiter would reset on every cold start (docs/08 §2).
    rateLimit: { ...snakeCaseSchema.rateLimit, enabled: true, storage: 'database' },
    user: {
      ...snakeCaseSchema.user,
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
