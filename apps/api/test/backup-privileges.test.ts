import { Pool } from 'pg';
import { afterAll, expect, it } from 'vitest';
import { testDatabaseUrl } from './database-urls';

// The nightly pg_dump runs as overload_backup (docs/13 §2, §5). pg_dump stops at the first table or
// sequence it cannot read, so one missing grant loses the whole night's backup. The CI job
// `backup-restore` proves the dump end to end; this names the object that broke it.
const pool = new Pool({ connectionString: testDatabaseUrl, max: 1 });
afterAll(() => pool.end());

it('overload_backup can read every table and sequence in public', async () => {
  const { rows } = await pool.query<{ kind: string; name: string }>(`
    SELECT CASE c.relkind WHEN 'S' THEN 'sequence' ELSE 'table' END AS kind, c.relname AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'S')
      AND NOT has_table_privilege('overload_backup', c.oid, 'SELECT')
    ORDER BY 1, 2
  `);
  expect(rows).toEqual([]);
});
