import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { testDatabaseOwnerUrl } from './database-urls';

// Once per run: bring the test database up to the current migrations, exactly as the API build
// does (docs/12 §3). bootstrap.sql has already run (Docker's init scripts, or CI's first step).
export default function setup() {
  const apiRoot = fileURLToPath(new URL('..', import.meta.url));
  execFileSync('node_modules/.bin/drizzle-kit', ['migrate'], {
    cwd: apiRoot,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL_DIRECT: testDatabaseOwnerUrl },
  });
}
