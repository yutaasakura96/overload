import { DrizzleQueryError } from 'drizzle-orm/errors';
import { Pool } from 'pg';
import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/create-app';
import { createAuth } from '../src/auth/auth';
import { createDatabase } from '../src/db/connection';
import { describeError } from '../src/lib/error-log';
import { testDatabaseUrl } from './database-urls';
import { WEB_ORIGIN, testConfig } from './harness';

// An unhandled error's log line carries Postgres's reason, so a failing staging query can be read
// from the logs, and never a query parameter, which can be an email or an IP (docs/03 §7).

const pool = new Pool({ connectionString: testDatabaseUrl, max: 1 });
afterAll(() => pool.end());
afterEach(() => vi.restoreAllMocks());

async function failedQuery(text: string, params: unknown[]) {
  try {
    await pool.query(text, params);
  } catch (cause) {
    if (cause instanceof Error) return new DrizzleQueryError(text, params, cause);
  }
  throw new Error(`Expected the query to fail: ${text}`);
}

it('names the SQL and the Postgres cause, but no parameter', async () => {
  const line = describeError(
    await failedQuery('select "id" from "no_such_table" where "key" = $1', [
      'someone@example.test',
    ]),
  );

  expect(line.error).toBe('DrizzleQueryError');
  expect(line.stack).toMatch(/^DrizzleQueryError: Failed query: select "id" from "no_such_table"/);
  expect(line.stack).toMatch(/\n {4}at /);
  expect(line.cause).toMatchObject({
    code: '42P01',
    message: 'relation "no_such_table" does not exist',
  });
  expect(JSON.stringify(line)).not.toContain('someone@example.test');
});

it('keeps a data error to its code, since its message can quote the value', async () => {
  const line = describeError(await failedQuery('select $1::uuid', ['someone@example.test']));

  expect(line.cause).toEqual({ code: '22P02' });
  expect(JSON.stringify(line)).not.toContain('someone@example.test');
});

it('logs why an auth route failed when the database refuses it', async () => {
  // The staging failure (docs/06, 2026-09-28): DATABASE_URL carries a password the database no
  // longer accepts, so the app starts and the first query, the rate limiter's, fails.
  const url = new URL(testDatabaseUrl);
  url.password = 'not-the-password';
  const badPool = new Pool({ connectionString: url.href });
  const db = createDatabase(badPool);
  const app = createApp({
    auth: createAuth({ config: testConfig, db }),
    config: testConfig,
    db,
    log: () => {},
  });
  const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

  const res = await app.request('/api/auth/sign-in/social', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: WEB_ORIGIN,
      'X-Forwarded-For': '203.0.113.7',
    },
    body: JSON.stringify({ provider: 'google', callbackURL: WEB_ORIGIN }),
  });
  await badPool.end();

  expect(res.status).toBe(500);
  expect(errorLog).toHaveBeenCalledOnce();
  const logged = String(errorLog.mock.calls[0]?.[0]);
  expect(JSON.parse(logged)).toMatchObject({
    error: 'DrizzleQueryError',
    cause: { code: '28P01', message: `password authentication failed for user "${url.username}"` },
  });
  expect(logged).toContain('from \\"rate_limit\\"');
  expect(logged).not.toContain('203.0.113.7');
});
