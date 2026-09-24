import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { testDatabaseOwnerUrl } from './database-urls';

// Once per run: bring the test database up to the current migrations, exactly as the API build
// does (docs/12 §3). bootstrap.sql has already run (Docker's init scripts, or CI's first step).
export default function setup() {
  const apiRoot = fileURLToPath(new URL('..', import.meta.url));
  execFileSync(
    'node_modules/.bin/dbmate',
    [
      '--url',
      testDatabaseOwnerUrl,
      '--migrations-dir',
      './migrations',
      '--no-dump-schema',
      'migrate',
    ],
    { cwd: apiRoot, stdio: 'inherit' },
  );
}
