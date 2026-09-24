import { expect, test, type Page } from '@playwright/test';
import { apiFixture } from './fixture';

type Cookies = Parameters<import('@playwright/test').BrowserContext['addCookies']>[0];

// Signed in through Better Auth's testUtils() cookie helper, not Google (docs/11 §1).
test.beforeEach(async ({ context }) => {
  const userId = process.env.E2E_USER_ID;
  if (userId === undefined) throw new Error('global setup did not create the test user');
  const cookies: Cookies = JSON.parse(apiFixture('cookies', userId, 'localhost'));
  await context.addCookies(cookies);
});

/** Everything in the app's own IndexedDB store (device-store.ts), as key → value. */
function deviceStore(page: Page) {
  return page.evaluate(
    () =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const open = indexedDB.open('overload');
        open.addEventListener('error', () => reject(open.error));
        open.addEventListener('success', () => {
          const store = open.result.transaction('device', 'readonly').objectStore('device');
          const keys = store.getAllKeys();
          const values = store.getAll();
          values.addEventListener('error', () => reject(values.error));
          values.addEventListener('success', () => {
            resolve(
              Object.fromEntries(
                keys.result.map((key, i) => [
                  typeof key === 'string' ? key : JSON.stringify(key),
                  values.result[i],
                ]),
              ),
            );
            open.result.close();
          });
        });
      }),
  );
}

const deviceKeys = async (page: Page) => Object.keys(await deviceStore(page));
const persistedCache = async (page: Page) => {
  const value = (await deviceStore(page))['query-cache:overload'];
  return typeof value === 'string' ? value : '';
};

test('a signed-in user sees the seeded exercise library', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Exercises' })).toBeVisible();
  const rows = page.getByRole('listitem');
  await expect(rows).toHaveCount(50);
  const bench = rows.filter({ has: page.getByText('Barbell Bench Press', { exact: true }) });
  await expect(bench).toContainText('2.5');
  await expect(bench).toContainText('6–10');
  await expect(page.getByText('playwright@example.test')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'SYNCED' })).toBeVisible();
});

test('sign-out ends the session and wipes the device', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('listitem')).toHaveCount(50);
  // The persister writes at most once a second.
  await expect
    .poll(() => deviceKeys(page))
    .toEqual(expect.arrayContaining(['signed-in-user', 'query-cache:overload']));

  await page.getByRole('button', { name: 'Sign out' }).click();

  await expect(page).toHaveURL('/sign-in');
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  expect(await deviceKeys(page)).toEqual([]);

  // The session is gone on the server too: the library now sends the browser to sign in.
  await page.goto('/');
  await expect(page).toHaveURL('/sign-in?next=%2F');
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
  await page.goto('/');
  await expect(page.getByRole('listitem')).toHaveCount(50);
  // The service worker controls the page, and the library has reached IndexedDB (the persister
  // writes at most once a second).
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await expect.poll(() => persistedCache(page)).toContain('Barbell Bench Press');

  await context.setOffline(true);
  await page.reload();

  await expect(page.getByRole('heading', { name: 'Exercises' })).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(50);
  await context.setOffline(false);
});

test('a refused sign-in shows the gate’s reason', async ({ context, page }) => {
  // The gate refused, so there is no session. With one, /sign-in sends the user on.
  await context.clearCookies();
  await page.goto('/sign-in?error=not_invited');
  await expect(page.getByRole('alert')).toContainText('This Google account hasn’t been invited.');
});
