import { createTransport } from '@sentry/node';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, beforeEach, expect, it } from 'vitest';
import { createAuth } from '../src/auth/auth';
import { createApp } from '../src/create-app';
import { createDatabase } from '../src/db/connection';
import type { ErrorContext } from '../src/lib/error-report';
import { initSentry } from '../src/sentry';
import { testDatabaseUrl } from './database-urls';
import { testConfig } from './harness';

// docs/03 §7: nothing a user typed, and no row value, reaches Sentry. The SDK runs for real here, with
// a transport that keeps each envelope instead of sending it, so these read exactly what would leave.
const sent: string[] = [];
const report = initSentry(
  { SENTRY_DSN: 'https://public@o0.ingest.sentry.io/0', VERCEL_ENV: 'production' },
  {
    transport: (options) =>
      createTransport(options, async (request) => {
        sent.push(
          typeof request.body === 'string' ? request.body : new TextDecoder().decode(request.body),
        );
        return { statusCode: 200 };
      }),
  },
);

const pool = new Pool({ connectionString: testDatabaseUrl, max: 1 });
const db = createDatabase(pool);
afterAll(() => pool.end());
beforeEach(() => {
  sent.length = 0;
});

const context: ErrorContext = { requestId: 'req_1', method: 'POST', route: '/api/auth/*' };
// Built at run time: Sentry sends the source lines around each frame, and those are code, not values.
const EMAIL = ['someone', 'example.test'].join('@');

async function failedQuery(query: ReturnType<typeof sql>): Promise<Error> {
  try {
    await db.execute(query);
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error('the query was meant to fail');
}

it('sends a failed query without its parameters, keeping the SQL and the Postgres reason', async () => {
  const error = await failedQuery(sql`select * from no_such_table where email = ${EMAIL}`);
  expect(error.message).toContain(EMAIL);

  await report(error, context);

  const envelope = sent.join('\n');
  expect(envelope).not.toContain(EMAIL);
  expect(envelope).toContain('Failed query: select * from no_such_table where email = $1');
  expect(envelope).toContain('relation \\"no_such_table\\" does not exist');
  expect(envelope).toContain('"environment":"production"');
  expect(envelope).toContain('"requestId":"req_1"');
});

it('drops a Postgres message that quotes the value that failed', async () => {
  const error = await failedQuery(sql`select ${EMAIL}::uuid`);
  expect(error.cause instanceof Error && error.cause.message).toContain(EMAIL);

  await report(error, context);

  const envelope = sent.join('\n');
  expect(envelope).not.toContain(EMAIL);
  expect(envelope).toContain('Postgres error 22P02');
});

it('reports a 500 from the app once, and never a 4xx', async () => {
  // A pool that reaches nothing: Better Auth's rate limiter queries first and fails, as on staging
  // (docs/06, 2026-09-28).
  const deadPool = new Pool({ connectionString: 'postgres://nobody@127.0.0.1:1/none' });
  const deadDb = createDatabase(deadPool);
  const reported: ErrorContext[] = [];
  const app = createApp({
    auth: createAuth({ config: testConfig, db: deadDb }),
    config: testConfig,
    db: deadDb,
    log: () => {},
    reportError: async (_error, errorContext) => {
      reported.push(errorContext);
    },
  });

  const failed = await app.request('/api/auth/ok');
  const unauthenticated = await app.request('/api/me');
  const missing = await app.request('/nothing-here');

  expect([failed.status, unauthenticated.status, missing.status]).toEqual([500, 401, 404]);
  expect(reported).toEqual([
    { requestId: expect.stringMatching(/^req_/), method: 'GET', route: '/api/auth/*' },
  ]);
  await deadPool.end();
});
