// Browser-test fixture, run by Playwright as a process so apps/web never imports apps/api
// (CLAUDE.md). It commits real rows to the test database, unlike the Vitest suites:
//
//   tsx test/e2e/session.ts user <email>              → a fresh user; prints { userId }
//   tsx test/e2e/session.ts cookies <userId> <domain> → a new session; prints its cookies
//   tsx test/e2e/session.ts delete <email>            → removes the user and every row of theirs
//
// The cookie is minted by Better Auth's testUtils() on a test-only instance, never the production
// config (docs/11 §1). The real Google round trip is proven by hand on staging (docs/11 §3).
import { testUtils, type TestHelpers } from 'better-auth/plugins';
import { createAuth } from '../../src/auth/auth';
import { createDatabase, createPool } from '../../src/db/connection';
import { testDatabaseUrl } from '../database-urls';
import { testConfig } from '../harness-config';

const [command, subject, domain] = process.argv.slice(2);
if (subject === undefined) throw new Error('usage: session.ts user|cookies|delete <subject>');

const pool = createPool(testDatabaseUrl);
const db = createDatabase(pool);

try {
  if (command === 'user' || command === 'delete') {
    await db.deleteFrom('user').where('email', '=', subject).execute();
  }
  if (command === 'user') {
    // Inserted directly: testUtils' saveUser runs validateUserInfo, which Better Auth 1.7.5 refuses
    // outside an endpoint context.
    const user = await db
      .insertInto('user')
      .values({ email: subject, name: 'Playwright', emailVerified: true })
      .returning('id')
      .executeTakeFirstOrThrow();
    process.stdout.write(JSON.stringify({ userId: user.id }));
  }
  if (command === 'cookies') {
    const config = { ...testConfig, webOrigin: process.env.E2E_WEB_ORIGIN ?? testConfig.webOrigin };
    const auth = createAuth({ config, pool, db, plugins: [testUtils()] });
    // `ctx.test` is typed only when testUtils() is in a static plugin list.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const { test } = (await auth.$context) as unknown as { test: TestHelpers };
    process.stdout.write(JSON.stringify(await test.getCookies({ userId: subject, domain })));
  }
} finally {
  await pool.end();
}
