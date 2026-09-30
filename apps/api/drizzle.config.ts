import { defineConfig } from 'drizzle-kit';

// drizzle-kit's config (docs/12 §3). `generate` reads only the schema and the snapshots in
// migrations/meta. `migrate` connects as overload_owner over the direct connection, through the
// JavaScript `pg` driver: in the API's Vercel build on main and develop, and against local Docker.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './migrations',
  dbCredentials: { url: process.env.DATABASE_URL_DIRECT ?? '' },
  // The bookkeeping table sits in `public` beside everything else, so the backup role reads it with
  // the grant the first migration gives it. The migrator still runs CREATE SCHEMA IF NOT EXISTS
  // first, which is why overload_owner holds CREATE on the database (infra/db/bootstrap.sql).
  migrations: { schema: 'public', table: '__drizzle_migrations' },
  strict: true,
  verbose: true,
});
