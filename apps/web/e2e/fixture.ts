import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { WEB_ORIGIN } from '../playwright.config';

// The browser tests reach the database only through apps/api's fixture script, run as a process:
// apps/web never imports apps/api (CLAUDE.md).
const apiRoot = fileURLToPath(new URL('../../api/', import.meta.url));

export const E2E_EMAIL = 'playwright@example.test';

export function apiFixture(...args: string[]): string {
  return execFileSync('node_modules/.bin/tsx', ['test/e2e/session.ts', ...args], {
    cwd: apiRoot,
    encoding: 'utf8',
    env: { ...process.env, E2E_WEB_ORIGIN: WEB_ORIGIN },
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

export function devSession(stateDirectory: string): string {
  return execFileSync('node_modules/.bin/tsx', ['test/e2e/dev-session.ts', stateDirectory], {
    cwd: apiRoot,
    encoding: 'utf8',
    env: { ...process.env, E2E_WEB_ORIGIN: WEB_ORIGIN },
  });
}

/** Picks a zone in the profile form's time zone list: search for it, then choose the option. */
export async function chooseTimezone(page: Page, zone: string) {
  await page.getByRole('combobox', { name: 'Time zone' }).fill(zone);
  await page.getByRole('option', { name: zone, exact: false }).first().click();
}
