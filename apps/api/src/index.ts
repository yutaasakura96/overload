import type { Hono } from 'hono';
import { createAuth } from './auth/auth.js';
import { readConfig } from './config.js';
import { createApp } from './create-app.js';
import { createDatabase, createPool } from './db/connection.js';

// The deployed entry: Vercel's Hono preset serves the default export (docs/03 §5). Node and Lambda
// entries wrap the same object. The preset takes the first of app, index and server (at the root,
// then under src/) whose text has `from 'hono'`, so this file must say it and no earlier candidate
// may exist. Vercel compiles each file without bundling, into ESM, so relative imports under src/
// carry `.js` (docs/12 §3). `pnpm --filter @overload/api check:vercel-build` proves both.

// Sentry only when its DSN is set (docs/12 §2), so local runs and tests never load it.
const reportError = process.env.SENTRY_DSN
  ? (await import('./sentry.js')).initSentry(process.env)
  : undefined;
const config = readConfig();
const pool = createPool(config.databaseUrl);
const db = createDatabase(pool);
const auth = createAuth({ config, db });

export default createApp({ auth, config, db, reportError }) satisfies Pick<Hono, 'fetch'>;
