// The config the Better Auth CLI reads to generate its tables as a Drizzle schema (docs/12 §3):
//
//   pnpm dlx auth@<pinned version> generate --config scripts/auth-schema.ts --output <scratch file>
//
// It needs no database: the Drizzle generator writes the whole schema from these options. Compare
// the scratch file with src/db/auth-schema.ts, carry any new field over (keeping that file's two
// edits), then `pnpm db:generate` writes the migration.
import { createAuth } from '../src/auth/auth';
import { createDatabase, createPool } from '../src/db/connection';

export const auth = createAuth({
  config: {
    databaseUrl: 'postgres://schema-generation-only@127.0.0.1:1/none',
    webOrigin: 'http://localhost:5173',
    authSecret: 'schema-generation-only-not-a-secret-0000',
    googleClientId: 'schema-generation',
    googleClientSecret: 'schema-generation',
    adminEmail: 'schema-generation@example.com',
  },
  db: createDatabase(createPool('postgres://schema-generation-only@127.0.0.1:1/none')),
});
