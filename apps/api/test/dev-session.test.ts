import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { localOnlyRefusals } from '../scripts/dev-session-guard';

// `pnpm dev:session` mints a real session cookie, so it must refuse anything that is not the local
// Docker database with local secrets, before it connects (docs/06, 2026-09-26). The signed-in page it
// yields is proven in the browser tests (apps/web/e2e/dev-session.spec.ts).
const local = {
  DATABASE_URL: 'postgres://overload_app:overload_app_dev@localhost:5434/overload',
  BETTER_AUTH_URL: 'http://localhost:5173',
};

describe('the dev:session guard', () => {
  it('lets the local .env.example values through', () => {
    expect(localOnlyRefusals(local)).toEqual([]);
    expect(
      localOnlyRefusals({ ...local, DATABASE_URL: 'postgres://u:p@postgres:5432/overload' }),
    ).toEqual([]);
    expect(
      localOnlyRefusals({ ...local, DATABASE_URL: 'postgres://u:p@127.0.0.1/overload' }),
    ).toEqual([]);
  });

  it('refuses a database that is not local, without echoing its password', () => {
    const refusals = localOnlyRefusals({
      ...local,
      DATABASE_URL: 'postgres://owner:s3cret@ep-cool-name.ap-southeast-1.aws.neon.tech/overload',
    });
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toContain('ep-cool-name.ap-southeast-1.aws.neon.tech');
    expect(refusals.join()).not.toContain('s3cret');
    // A lookalike host is not local.
    expect(
      localOnlyRefusals({ ...local, DATABASE_URL: 'postgres://u:p@localhost.example.com/db' }),
    ).toHaveLength(1);
  });

  it('refuses a production NODE_ENV', () => {
    expect(localOnlyRefusals({ ...local, NODE_ENV: 'production' })).toEqual([
      'NODE_ENV is production.',
    ]);
  });

  it('refuses variables that came from a Vercel deployment', () => {
    expect(localOnlyRefusals({ ...local, VERCEL_ENV: 'preview' })).toHaveLength(1);
    expect(localOnlyRefusals({ ...local, VERCEL: '1' })).toHaveLength(1);
  });

  it('refuses an auth secret paired with a deployed web origin', () => {
    expect(
      localOnlyRefusals({ ...local, BETTER_AUTH_URL: 'https://overload.example.com' }),
    ).toHaveLength(1);
    expect(localOnlyRefusals({ ...local, BETTER_AUTH_URL: 'https://localhost:5173' })).toHaveLength(
      1,
    );
  });

  it('refuses when the variables are missing', () => {
    expect(localOnlyRefusals({})).toHaveLength(2);
  });
});

describe('pnpm dev:session', () => {
  const apiRoot = fileURLToPath(new URL('..', import.meta.url));

  // The script itself, not only the guard: it exits before connecting or writing the state file.
  it.each([
    ['a non-local database', { DATABASE_URL: 'postgres://u:p@db.example.com:5432/overload' }],
    ['a production NODE_ENV', { NODE_ENV: 'production' }],
  ])('refuses %s and writes nothing', (_, override) => {
    const out = join(mkdtempSync(join(tmpdir(), 'dev-session-')), 'state.json');
    const result = spawnSync('node_modules/.bin/tsx', ['scripts/dev-session.ts', '--out', out], {
      cwd: apiRoot,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        // Unreachable, so a guard that let this through could not write anywhere either.
        DATABASE_URL: 'postgres://nobody@127.0.0.1:1/none',
        BETTER_AUTH_URL: local.BETTER_AUTH_URL,
        BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-long',
        GOOGLE_CLIENT_ID: 'test-google-client',
        GOOGLE_CLIENT_SECRET: 'test-google-secret',
        ADMIN_EMAIL: 'admin@example.test',
        ...override,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('dev:session refused');
    expect(existsSync(out)).toBe(false);
  });
});
