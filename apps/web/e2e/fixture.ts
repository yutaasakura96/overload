import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The browser tests reach the database only through apps/api's fixture script, run as a process:
// apps/web never imports apps/api (CLAUDE.md).
const apiRoot = fileURLToPath(new URL('../../api/', import.meta.url));

export const E2E_EMAIL = 'playwright@example.test';

export function apiFixture(...args: string[]): string {
  return execFileSync('node_modules/.bin/tsx', ['test/e2e/session.ts', ...args], {
    cwd: apiRoot,
    encoding: 'utf8',
    env: { ...process.env, E2E_WEB_ORIGIN: 'http://localhost:4174' },
  });
}

export function migrateTestDatabase() {
  const url =
    process.env.TEST_DATABASE_URL_DIRECT ??
    'postgres://overload_owner:overload_owner_dev@localhost:5434/overload_test?sslmode=disable';
  execFileSync('node_modules/.bin/drizzle-kit', ['migrate'], {
    cwd: apiRoot,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL_DIRECT: url },
  });
}
