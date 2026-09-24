import { testUtils, type TestHelpers } from 'better-auth/plugins';
import { sql } from 'kysely';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { createApp } from '../src/app';
import { createAuth } from '../src/auth/auth';
import { createDatabase } from '../src/db/connection';
import { testDatabaseUrl } from './database-urls';
import { WEB_ORIGIN, testConfig } from './harness-config';

export { ADMIN_EMAIL, WEB_ORIGIN, testConfig } from './harness-config';

/** What Google would assert about a user. The stub below reads it back out of the "id token". */
export type GoogleIdentity = { sub: string; email: string; emailVerified: boolean; name?: string };

/**
 * One app per test file, on one connection, as the app role (so a missing grant fails here, not in
 * production). Each test runs inside a transaction that is rolled back (docs/11 §1).
 *
 * Google is the only thing replaced: its token check and userinfo read. The gate, the hooks and
 * Better Auth's own sign-in pipeline all run for real. `testUtils()` sits on this test-only
 * instance and never in the production config.
 */
export function useTestApp() {
  // max: 1 and no idle timeout keep every query, Better Auth's included, on the one connection that
  // holds the open transaction.
  const pool = new Pool({ connectionString: testDatabaseUrl, max: 1, idleTimeoutMillis: 0 });
  const db = createDatabase(pool);
  const auth = createAuth({
    config: testConfig,
    pool,
    db,
    google: {
      verifyIdToken: async () => true,
      getUserInfo: async (tokens) => {
        const claims: GoogleIdentity = JSON.parse(tokens.idToken ?? '{}');
        return {
          user: {
            email: claims.email,
            name: claims.name ?? 'Test User',
            emailVerified: claims.emailVerified,
          },
          // The claims Google's ID token carries (GoogleProfile), with test values.
          data: {
            iss: 'https://accounts.google.com',
            aud: testConfig.googleClientId,
            azp: testConfig.googleClientId,
            sub: claims.sub,
            email: claims.email,
            email_verified: claims.emailVerified,
            name: claims.name ?? 'Test User',
            given_name: 'Test',
            family_name: 'User',
            picture: '',
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 3600,
          },
        };
      },
    },
    plugins: [testUtils()],
  });
  const app = createApp({ auth, config: testConfig, db, log: () => {} });

  beforeAll(async () => {
    await pool.query('SELECT 1');
  });
  beforeEach(async () => {
    await pool.query('BEGIN');
  });
  afterEach(async () => {
    await pool.query('ROLLBACK');
  });
  afterAll(async () => {
    await pool.end();
  });

  const helpers = async () => {
    const ctx = await auth.$context;
    // `ctx.test` is typed only when testUtils() is in a static plugin list, and here it is passed
    // through createAuth so the test instance keeps the production config around it.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return (ctx as unknown as { test: TestHelpers }).test;
  };

  return {
    app,
    db,
    auth,
    sql,

    /** Sign in through Better Auth's real Google ID-token path, with Google stubbed. */
    signInWithGoogle(identity: GoogleIdentity) {
      return app.request('/api/auth/sign-in/social', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: WEB_ORIGIN },
        body: JSON.stringify({ provider: 'google', idToken: { token: JSON.stringify(identity) } }),
      });
    },

    /**
     * A user with a session. The session and its signed cookie come from Better Auth's test helper.
     * The user row is inserted directly: the helper's `saveUser` goes through `createUser`, which in
     * 1.7.5 runs `validateUserInfo` and refuses outside an endpoint context.
     */
    async createSignedInUser(email: string) {
      const user = await db
        .insertInto('user')
        .values({ email, name: `Test ${email}`, emailVerified: true })
        .returningAll()
        .executeTakeFirstOrThrow();
      const login = await (await helpers()).login({ userId: user.id });
      return { user, cookie: login.headers.get('cookie') ?? '', token: login.token };
    },

    async invite(email: string, options: { revoked?: boolean } = {}) {
      await db
        .insertInto('invite')
        .values({ email, revokedAt: options.revoked === true ? new Date() : null })
        .execute();
    },
  };
}
