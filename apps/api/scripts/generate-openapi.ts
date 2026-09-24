// Writes packages/api-contract/openapi.json from the route schemas (docs/03 §2). CI runs this and
// fails if the committed file differs. Nothing here connects to a database: the Pool is lazy.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp, openApiDocument } from '../src/app';
import { createAuth } from '../src/auth/auth';
import { createDatabase, createPool } from '../src/db/connection';

const config = {
  databaseUrl: 'postgres://contract-generation-only',
  webOrigin: 'http://localhost:5173',
  authSecret: 'contract-generation-only-not-a-secret-000',
  googleClientId: 'contract-generation',
  googleClientSecret: 'contract-generation',
  adminEmail: 'contract-generation@example.com',
};
const pool = createPool(config.databaseUrl);
const db = createDatabase(pool);
const app = createApp({ auth: createAuth({ config, pool, db }), config, db });

const target = fileURLToPath(
  new URL('../../../packages/api-contract/openapi.json', import.meta.url),
);
writeFileSync(target, `${JSON.stringify(openApiDocument(app), null, 2)}\n`);
await pool.end();
