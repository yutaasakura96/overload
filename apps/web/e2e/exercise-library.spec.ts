import { expect, test } from '@playwright/test';
import { cacheKey, deviceKeys, savedCache } from './device-store';
import { apiFixture } from './fixture';

type Cookies = Parameters<import('@playwright/test').BrowserContext['addCookies']>[0];

// Signed in through Better Auth's testUtils() cookie helper, not Google (docs/11 §1).
const userId = process.env.E2E_USER_ID ?? '';

test.beforeEach(async ({ context }) => {
  if (userId === '') throw new Error('global setup did not create the test user');
  const cookies: Cookies = JSON.parse(apiFixture('cookies', userId, 'localhost'));
  await context.addCookies(cookies);
});

test('a signed-in user sees the seeded exercise library', async ({ page }) => {
  await page.goto('/exercises');

  await expect(page.getByRole('heading', { name: 'Exercises' })).toBeVisible();
  const rows = page.getByRole('listitem');
  await expect(rows).toHaveCount(185);
  const bench = rows.filter({ has: page.getByText('Barbell Bench Press', { exact: true }) });
  await expect(bench).toContainText('2.5');
  await expect(bench).toContainText('6–10');
  await expect(page.getByText('playwright@example.test')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'SYNCED' })).toBeVisible();
});

test('the library is filed under muscle groups and searched by name or alias', async ({ page }) => {
  await page.goto('/exercises');

  const chest = page.getByRole('region', { name: 'Chest' });
  await expect(chest.getByRole('heading', { level: 3 })).toContainText('Chest');
  await expect(chest.getByText('Barbell Bench Press', { exact: true })).toBeVisible();
  await expect(chest.getByText('Barbell Back Squat', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 3 })).toHaveText([
    /^Chest/,
    /^Back/,
    /^Shoulders/,
    /^Biceps/,
    /^Triceps/,
    /^Forearms/,
    /^Quads/,
    /^Hamstrings/,
    /^Glutes/,
    /^Calves/,
    /^Core/,
  ]);

  // "RDL" is in no name: the naming rule keeps abbreviations out, so the alias has to match.
  await page.getByRole('searchbox', { name: 'Search' }).fill('rdl');
  await expect(page.getByRole('heading', { name: '4 matching' })).toBeVisible();
  const rows = page.getByRole('listitem');
  await expect(rows).toHaveCount(4);
  await expect(rows.filter({ hasText: 'Barbell Romanian Deadlift' })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'Barbell Romanian Deadlift' })).not.toContainText('RDL');
  await expect(page.getByRole('heading', { level: 3 })).toHaveText([/^Hamstrings/]);

  await page.getByRole('searchbox', { name: 'Search' }).fill('zzz');
  await expect(page.getByText('Nothing matches.')).toBeVisible();
  await expect(rows).toHaveCount(0);
});

test('a custom exercise is filed under the muscle group chosen for it', async ({ page }) => {
  await page.goto('/exercises/new');
  await page.getByRole('textbox', { name: 'Name' }).fill('Cable Y-Raise');
  await page.getByRole('combobox', { name: 'Equipment' }).selectOption('cable');
  await page.getByRole('combobox', { name: 'Muscle group' }).selectOption('shoulders');
  await page.getByRole('button', { name: 'Create exercise' }).click();

  await expect(page).toHaveURL('/exercises');
  const shoulders = page.getByRole('region', { name: 'Shoulders' });
  const row = shoulders.getByRole('listitem').filter({ hasText: 'Cable Y-Raise' });
  await expect(row).toContainText('Yours');

  // Tidy up: the run shares one user, and other tests count the library.
  await row.getByRole('link').click();
  await page.getByRole('button', { name: 'Delete exercise' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page).toHaveURL('/exercises');
  await expect(page.getByRole('listitem')).toHaveCount(185);
});

test('sign-out ends the session and wipes the device', async ({ page }) => {
  await page.goto('/exercises');
  await expect(page.getByRole('listitem')).toHaveCount(185);
  // The persister writes at most once a second.
  await expect
    .poll(() => deviceKeys(page))
    .toEqual(expect.arrayContaining(['signed-in-user', cacheKey(userId)]));

  await page.getByRole('button', { name: 'Sign out' }).click();

  await expect(page).toHaveURL('/sign-in');
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  expect(await deviceKeys(page)).toEqual([]);

  // The session is gone on the server too: the library now sends the browser to sign in.
  await page.goto('/exercises');
  await expect(page).toHaveURL('/sign-in?next=%2Fexercises');
  expect((await page.request.get('/api/me')).status()).toBe(401);
});

test('the installed shell opens offline with the last loaded library', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName === 'webkit',
    'Playwright’s WebKit fails to reload a service-worker page offline',
  );
  await page.goto('/exercises');
  await expect(page.getByRole('listitem')).toHaveCount(185);
  // The service worker controls the page, and the library has reached IndexedDB (the persister
  // writes at most once a second).
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await expect.poll(() => savedCache(page, userId)).toContain('Barbell Bench Press');

  await context.setOffline(true);
  await page.reload();

  await expect(page.getByRole('heading', { name: 'Exercises' })).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(185);
  await context.setOffline(false);
});

test('a refused sign-in shows the gate’s reason', async ({ context, page }) => {
  // The gate refused, so there is no session. With one, /sign-in sends the user on.
  await context.clearCookies();
  await page.goto('/sign-in?error=not_invited');
  await expect(page.getByRole('alert')).toContainText('This Google account hasn’t been invited.');
});
