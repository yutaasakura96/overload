import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDevSession } from '../scripts/dev-session-core';
import { localOnlyRefusals } from '../scripts/dev-session-guard';

const local = {
  DATABASE_URL: 'postgres://overload_app:overload_app_dev@localhost:5434/overload',
  BETTER_AUTH_URL: 'http://localhost:5173',
  BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-long',
  GOOGLE_CLIENT_ID: 'test-google-client',
  GOOGLE_CLIENT_SECRET: 'test-google-secret',
  ADMIN_EMAIL: 'admin@example.test',
};

describe('the dev:session guard', () => {
  it('accepts the documented local target and matching exported values', () => {
    expect(localOnlyRefusals(local, { ...local })).toEqual([]);
    expect(
      localOnlyRefusals({ ...local, DATABASE_URL: 'postgres://u:p@127.0.0.1:5434/overload' }, {}),
    ).toEqual([]);
  });

  it.each([
    ['a non-local database', { DATABASE_URL: 'postgres://u:p@db.example.com:5434/overload' }, {}],
    ['the wrong port', { DATABASE_URL: 'postgres://u:p@localhost:5432/overload' }, {}],
    ['the wrong database', { DATABASE_URL: 'postgres://u:p@localhost:5434/other' }, {}],
    [
      'a pg host override',
      { DATABASE_URL: 'postgres://u:p@localhost:5434/overload?host=remote.example' },
      {},
    ],
    ['production in the file', { NODE_ENV: 'production' }, {}],
    ['production in the shell', {}, { NODE_ENV: 'production' }],
    ['a different exported runtime mode', {}, { NODE_ENV: 'development' }],
    ['Vercel in the file', { VERCEL: '1' }, {}],
    ['Vercel in the shell', {}, { VERCEL_ENV: 'preview' }],
    ['a different exported secret', {}, { BETTER_AUTH_SECRET: 'deployed-secret' }],
    ['a different exported database URL', {}, { DATABASE_URL: 'postgres://u:p@remote.example/db' }],
  ])('refuses %s without writing artifacts', async (_, fileOverride, exportedEnv) => {
    const stateDirectory = mkdtempSync(join(tmpdir(), 'dev-session-'));
    try {
      await expect(
        createDevSession({
          fileValues: { ...local, ...fileOverride },
          exportedEnv,
          stateDirectory,
        }),
      ).rejects.toThrow('dev:session refused:');
      expect(readdirSync(stateDirectory)).toEqual([]);
    } finally {
      rmSync(stateDirectory, { recursive: true, force: true });
    }
  });

  it('names mismatched variables without printing their values', () => {
    const refusal = localOnlyRefusals(local, { BETTER_AUTH_SECRET: 'deployed-secret' }).join('\n');
    expect(refusal).toContain('BETTER_AUTH_SECRET');
    expect(refusal).not.toContain('deployed-secret');
    expect(refusal).not.toContain(local.BETTER_AUTH_SECRET);
  });
});
