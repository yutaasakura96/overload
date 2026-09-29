// Browser-test fixture, run by Playwright as a process so apps/web never imports apps/api
// (CLAUDE.md). It commits real rows to the test database, unlike the Vitest suites:
//
//   tsx test/e2e/session.ts user <email>              → a fresh user; prints { userId }
//   tsx test/e2e/session.ts cookies <userId> <domain> → a new session; prints its cookies
//   tsx test/e2e/session.ts delete <email>            → removes the user and every row of theirs
//
// The cookie is minted by Better Auth's testUtils() on a test-only instance, never the production
// config (docs/11 §1). The real Google round trip is proven by hand on staging (docs/11 §3).
import { createDatabase, createPool } from '../../src/db/connection';
import { testDatabaseUrl } from '../database-urls';
import { testConfig } from '../harness-config';
import { deleteUser, insertUser, mintSessionCookies } from './test-session';

const [command, subject, domain] = process.argv.slice(2);
if (subject === undefined) throw new Error('usage: session.ts user|cookies|delete <subject>');

const pool = createPool(testDatabaseUrl);
const db = createDatabase(pool);

try {
  if (command === 'user' || command === 'delete') {
    await deleteUser(db, subject);
  }
  if (command === 'user') {
    process.stdout.write(JSON.stringify({ userId: await insertUser(db, subject, 'Playwright') }));
  }
  if (command === 'cookies') {
    const config = { ...testConfig, webOrigin: process.env.E2E_WEB_ORIGIN ?? testConfig.webOrigin };
    const cookies = await mintSessionCookies({ config, db, userId: subject, domain });
    process.stdout.write(JSON.stringify(cookies));
  }
} finally {
  await pool.end();
}
