import { createApp } from './app';
import { createAuth } from './auth/auth';
import { readConfig } from './config';
import { createDatabase, createPool } from './db/connection';

// The deployed entry: Vercel's Hono preset serves the default export (docs/03 §5). Node and Lambda
// entries wrap the same object.
const config = readConfig();
const pool = createPool(config.databaseUrl);
const db = createDatabase(pool);
const auth = createAuth({ config, db });

export default createApp({ auth, config, db });
