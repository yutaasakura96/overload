// The config the Better Auth CLI reads to generate its tables' SQL (docs/12 §3):
//
//   DATABASE_URL=<local owner url> pnpm dlx auth@<pinned version> generate \
//     --config scripts/auth-schema.ts --adapter kysely --output <scratch file>
//
// It emits a diff against the connected database, so run it against local Docker Postgres at the
// current migration state, then paste the SQL into a new dbmate migration and write its down.
import { createAuth } from '../src/auth/auth';
import { createDatabase, createPool } from '../src/db/connection';

const pool = createPool(process.env.DATABASE_URL ?? '');

export const auth = createAuth({
  config: {
    databaseUrl: process.env.DATABASE_URL ?? '',
    webOrigin: 'http://localhost:5173',
    authSecret: 'schema-generation-only-not-a-secret-0000',
    googleClientId: 'schema-generation',
    googleClientSecret: 'schema-generation',
    adminEmail: 'schema-generation@example.com',
  },
  pool,
  db: createDatabase(pool),
});
