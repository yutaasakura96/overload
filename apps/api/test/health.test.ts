import { Pool } from 'pg';
import { expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createAuth } from '../src/auth/auth';
import { createDatabase } from '../src/db/connection';
import { testConfig } from './harness';

// CLAUDE.md, binding: /api/health must not touch the database, or the 5-minute uptime check keeps
// Neon awake all month (docs/12 §5). A fresh app, as on a cold start, over a pool that can reach
// nothing: the check must answer, and the pool must never have opened a connection.
it('GET /api/health answers without opening a database connection', async () => {
  const pool = new Pool({ connectionString: 'postgres://nobody@127.0.0.1:1/none' });
  const db = createDatabase(pool);
  const app = createApp({
    auth: createAuth({ config: testConfig, db }),
    config: testConfig,
    db,
    log: () => {},
  });

  const res = await app.request('/api/health');

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ status: 'ok' });
  expect(res.headers.get('cache-control')).toBe('private, no-store');
  // Better Auth's init runs in the background; give it the chance to reach for the database.
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(pool.totalCount).toBe(0);
  await pool.end();
});
