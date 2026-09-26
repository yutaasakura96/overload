import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { apiFixture, devSession } from './fixture';

type Cookies = Parameters<import('@playwright/test').BrowserContext['addCookies']>[0];

// `pnpm dev:session` is how an agent signs a browser in to the app it runs locally (docs/06,
// 2026-09-26). Its storageState file must be accepted by the running app as a real session.
const DEV_EMAIL = 'dev-session@example.test';

test.afterAll(() => {
  apiFixture('delete', DEV_EMAIL);
});

test('pnpm dev:session signs a browser in to the local app', async ({ page, context }, info) => {
  const out = info.outputPath('storage-state.json');
  const printed = devSession(DEV_EMAIL, out);
  expect(printed).toContain('better-auth.session_token');

  const state: { cookies: Cookies } = JSON.parse(readFileSync(out, 'utf8'));
  await context.addCookies(state.cookies);
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Exercises' })).toBeVisible();
  await expect(page.getByText(DEV_EMAIL)).toBeVisible();
  await expect(page).toHaveURL('/');

  // A second run reuses the user.
  expect(devSession(DEV_EMAIL, out)).toContain('reused');
});
