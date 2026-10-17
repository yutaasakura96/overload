import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { apiFixture } from './fixture';

type Cookies = Parameters<import('@playwright/test').BrowserContext['addCookies']>[0];

// S10 end to end (docs/09 F7): the export saves one file with every section, a member deletes their
// own account and lands on the sign-in page, and the admin is told their account can't be deleted.
// The deletion runs on a user made for the test, so the run's shared users stay.
const adminId = process.env.E2E_ADMIN_ID ?? '';
const memberId = process.env.E2E_USER_ID ?? '';

test.use({ serviceWorkers: 'block' });

const signIn = async (context: import('@playwright/test').BrowserContext, userId: string) => {
  if (userId === '') throw new Error('global setup did not create the test users');
  const cookies: Cookies = JSON.parse(apiFixture('cookies', userId, 'localhost'));
  await context.addCookies(cookies);
};

test('a member exports their data as one file', async ({ context, page }, testInfo) => {
  const email = `export-${testInfo.project.name}-${Date.now()}@example.test`;
  const { userId }: { userId: string } = JSON.parse(apiFixture('user', email));
  try {
    await signIn(context, userId);
    const weighInId = crypto.randomUUID();
    const measuredAt = new Date().toISOString();
    const created = await page.request.post('/api/weigh-ins', {
      data: { id: weighInId, measuredAt, weightKg: 82.4 },
    });
    expect(created.status()).toBe(201);
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
      'weighIns',
      'foods',
      'rotationGroups',
    ]);
    expect(saved['profile']).toEqual([
      expect.objectContaining({ user: expect.objectContaining({ id: userId }) }),
    ]);
    expect(saved['weighIns']).toEqual([
      expect.objectContaining({ id: weighInId, measuredAt, weightKg: 82.4, source: 'manual' }),
    ]);
    await expect(page.getByText(`Saved ${file.suggestedFilename()}.`)).toBeVisible();
  } finally {
    apiFixture('delete', email);
  }
});

test('leaving the screen during export does not save a file', async ({ context, page }) => {
  await signIn(context, memberId);
  const requested = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  await page.route('**/api/me/export?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('section') !== 'workouts') {
      await route.continue();
      return;
    }
    requested.resolve();
    await release.promise;
    await route.continue();
  });
  await page.goto('/account');
  await page.getByRole('button', { name: 'Export your data' }).click();
  await requested.promise;
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL('/');
  const download = page.waitForEvent('download', { timeout: 500 });
  const response = page.waitForResponse((reply) =>
    reply.url().includes('/api/me/export?section=workouts'),
  );
  release.resolve();
  await response;
  await expect(download).rejects.toThrow();
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

for (const sessionCase of ['another account', 'no account'] as const) {
  test(`deletion stops when the current session has ${sessionCase}`, async ({ context, page }) => {
    await signIn(context, memberId);
    let deleteCalls = 0;
    await page.route('**/api/auth/get-session**', async (route) => {
      if (new URL(route.request().url()).searchParams.get('disableCookieCache') !== 'true') {
        await route.continue();
        return;
      }
      if (sessionCase === 'no account') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
        return;
      }
      const response = await route.fetch();
      const session: { user: { id: string } } = await response.json();
      await route.fulfill({
        response,
        json: { ...session, user: { ...session.user, id: adminId } },
      });
    });
    await page.route('**/api/auth/delete-user', (route) => {
      deleteCalls += 1;
      return route.abort();
    });
    await page.goto('/account');
    await page.getByRole('textbox', { name: 'Type DELETE to confirm' }).fill('DELETE');
    await page.getByRole('button', { name: 'Delete account' }).click();
    await expect(
      page.getByText('The signed-in account changed. Reload this page before deleting.'),
    ).toBeVisible();
    expect(deleteCalls).toBe(0);
  });
}

test('an interrupted delete response reports an unknown outcome', async ({ context, page }) => {
  await signIn(context, memberId);
  await page.route('**/api/auth/delete-user', (route) => route.abort('internetdisconnected'));
  await page.goto('/account');
  await page.getByRole('textbox', { name: 'Type DELETE to confirm' }).fill('DELETE');
  await page.getByRole('button', { name: 'Delete account' }).click();
  await expect(
    page.getByText('Couldn’t confirm whether your account was deleted. Reload to check.'),
  ).toBeVisible();
  await expect(page.getByText('Nothing was deleted.')).toHaveCount(0);
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
