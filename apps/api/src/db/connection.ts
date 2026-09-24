import { CamelCasePlugin, Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DB } from './schema';

export type Database = Kysely<DB>;

export function createPool(connectionString: string): Pool {
  return new Pool({ connectionString });
}

/**
 * Our query builder. It shares the one `pg` Pool with Better Auth (docs/03 §2) and maps the
 * tables' snake_case to the API's camelCase here, in one place (docs/07 §1.1).
 */
export function createDatabase(pool: Pool): Database {
  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool }),
    plugins: [new CamelCasePlugin()],
  });
}
