import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { apiFixture } from './fixture';

type Cookies = Parameters<import('@playwright/test').BrowserContext['addCookies']>[0];

// S10 end to end (docs/09 F7): the export saves one file with every section, a member deletes their
// own account and lands on the sign-in page, and the admin is told their account can't be deleted.
// The deletion runs on a user made for the test, so the run's shared users stay.
const adminId = process.env.E2E_ADMIN_ID ?? '';
const memberId = process.env.E2E_USER_ID ?? '';

const signIn = async (context: import('@playwright/test').BrowserContext, userId: string) => {
  if (userId === '') throw new Error('global setup did not create the test users');
  const cookies: Cookies = JSON.parse(apiFixture('cookies', userId, 'localhost'));
  await context.addCookies(cookies);
};

test('a member exports their data as one file', async ({ context, page }) => {
  await signIn(context, memberId);
  await page.goto('/');
  await page.getByRole('link', { name: 'Your data' }).click();
  await expect(page.getByRole('heading', { name: 'Your data', level: 1 })).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export your data' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^overload-export-\d{4}-\d{2}-\d{2}\.json$/);
  const saved: Record<string, unknown> = JSON.parse(await readFile(await file.path(), 'utf8'));
  expect(Object.keys(saved)).toEqual([
    'exportedAt',
    'profile',
    'exercises',
    'routines',
    'workouts',
  ]);
  expect(saved['profile']).toEqual([
    expect.objectContaining({ user: expect.objectContaining({ id: memberId }) }),
  ]);
  await expect(page.getByText(`Saved ${file.suggestedFilename()}.`)).toBeVisible();
});

test('a member deletes their account after typing DELETE', async ({ context, page }, testInfo) => {
  const email = `leaving-${testInfo.project.name}-${Date.now()}@example.test`;
  const { userId }: { userId: string } = JSON.parse(apiFixture('user', email));
  await signIn(context, userId);
  try {
    await page.goto('/account');
    await expect(page.getByText('Two things outlast it')).toBeVisible();
    const remove = page.getByRole('button', { name: 'Delete account' });
    await expect(remove).toBeDisabled();
    await page.getByRole('textbox', { name: 'Type DELETE to confirm' }).fill('delete');
    await expect(remove).toBeDisabled();
    await page.getByRole('textbox', { name: 'Type DELETE to confirm' }).fill('DELETE');
    await remove.click();

    await expect(page).toHaveURL(/\/sign-in\?deleted=1$/);
    await expect(page.getByText('Your account was deleted.')).toBeVisible();
    await page.goto('/');
    await expect(page).toHaveURL(/\/sign-in/);
  } finally {
    apiFixture('delete', email);
  }
});

test('a missing session lookup still offers server-checked deletion', async ({ context, page }) => {
  await signIn(context, memberId);
  await page.route('**/api/auth/get-session', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }),
  );
  await page.goto('/account');
  const remove = page.getByRole('button', { name: 'Delete account' });
  await page.getByRole('textbox', { name: 'Type DELETE to confirm' }).fill('DELETE');
  await expect(remove).toBeEnabled();
});

test('the admin is told their account can’t be deleted', async ({ context, page }) => {
  await signIn(context, adminId);
  await page.goto('/account');
  await expect(page.getByText('This is the admin account, so it can’t be deleted.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete account' })).toHaveCount(0);
});
