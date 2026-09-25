import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;

export function createPool(connectionString: string): Pool {
  return new Pool({ connectionString });
}

/**
 * Our query builder, over the one `pg` Pool shared with Better Auth (docs/03 §2). The tables'
 * snake_case names live on the Drizzle columns, so queries and rows are camelCase (docs/07 §1.1).
 */
export function createDatabase(pool: Pool): Database {
  return drizzle({ client: pool, schema });
}
