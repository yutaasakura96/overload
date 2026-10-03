import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { cacheKey, deviceKeys, putDeviceValue, savedCache } from './device-store';
import { apiFixture } from './fixture';

type Cookies = Parameters<BrowserContext['addCookies']>[0];

// The saved query cache is kept per account, and only the account /api/me confirms is loaded, or
// offline the last one it confirmed on this device. Weight, food and health numbers must never be
// readable by a different account in the same browser (docs/08 §5, §7). The cookie is replaced
// without a sign-out here, as session expiry followed by another account's sign-in leaves it, or as
// `pnpm dev:session` does when handed a different identity.

const EMAIL_A = 'per-account-a@example.test';
const EMAIL_B = 'per-account-b@example.test';
/** A library row renamed in one account's responses, standing in for that account's own data. */
const OWN_A = 'Only A’s exercise';
const OWN_B = 'Only B’s exercise';

// page.route cannot hold a request a service worker forwards (WebKit); the cache under test lives in
// IndexedDB, not in the worker.
test.use({ serviceWorkers: 'block' });

let userA = '';
let userB = '';

function createUser(email: string) {
  const created: { userId: string } = JSON.parse(apiFixture('user', email));
  return created.userId;
}

test.beforeEach(() => {
  userA = createUser(EMAIL_A);
  userB = createUser(EMAIL_B);
});

test.afterAll(() => {
  apiFixture('delete', EMAIL_A);
  apiFixture('delete', EMAIL_B);
});

async function useCookie(context: BrowserContext, userId: string) {
  await context.clearCookies();
  const cookies: Cookies = JSON.parse(apiFixture('cookies', userId, 'localhost'));
  await context.addCookies(cookies);
}

/** Renames the first library row in every /api/exercises answer on this page. */
async function markLibrary(page: Page, name: string) {
  await page.route('**/api/exercises', async (route) => {
    const response = await route.fetch();
    const { items }: { items: { name: string }[] } = await response.json();
    const [first, ...rest] = items;
    await route.fulfill({ response, json: { items: [{ ...first, name }, ...rest] } });
  });
}

/** Signs in as the user, with their marked library, and waits until it is saved on the device. */
async function openAs(page: Page, context: BrowserContext, userId: string, email: string) {
  const own = userId === userA ? OWN_A : OWN_B;
  await useCookie(context, userId);
  await markLibrary(page, own);
  await page.goto('/exercises');
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText(own)).toBeVisible();
  // The persister writes at most once a second.
  await expect.poll(() => savedCache(page, userId)).toContain(own);
  await page.unrouteAll({ behavior: 'wait' });
}

/** Moves the clock past the one-minute staleTime, so a confirmed launch would refetch the library. */
const staleCache = (context: BrowserContext) => context.clock.fastForward('01:01');

/** Counts the library requests the page makes from now on. */
function countLibraryRequests(page: Page) {
  const count = { requests: 0 };
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/exercises') count.requests += 1;
  });
  return count;
}

test('after A, B on the same device never sees A’s data, and each keeps their own copy', async ({
  page,
  context,
}) => {
  await openAs(page, context, userA, EMAIL_A);

  // B's cookie, and B's /api/me held: the launch must not render A's copy while it waits.
  await useCookie(context, userB);
  await markLibrary(page, OWN_B);
  const { promise: held, resolve: release } = Promise.withResolvers<void>();
  await page.route('**/api/me', async (route) => {
    await held;
    await route.continue();
  });
  const meAsked = page.waitForRequest('**/api/me');
  await page.goto('/exercises');
  await meAsked;
  await page.waitForTimeout(1000);
  await expect(page.getByText(EMAIL_A)).toHaveCount(0);
  await expect(page.getByText(OWN_A)).toHaveCount(0);
  release();

  await expect(page.getByText(EMAIL_B)).toBeVisible();
  await expect(page.getByText(OWN_B)).toBeVisible();
  await expect(page.getByText(OWN_A)).toHaveCount(0);
  await expect.poll(() => savedCache(page, userB)).toContain(OWN_B);
  expect(await savedCache(page, userB)).not.toContain(OWN_A);
  expect(await savedCache(page, userB)).not.toContain(EMAIL_A);
  // A's copy is A's alone, untouched by B's session.
  expect(await savedCache(page, userA)).toContain(OWN_A);
  expect(await savedCache(page, userA)).not.toContain(OWN_B);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('with no answer from /api/me, the launch opens only the last confirmed account’s copy', async ({
  page,
  context,
}) => {
  await context.clock.install();
  await openAs(page, context, userB, EMAIL_B);
  await openAs(page, context, userA, EMAIL_A);
  await staleCache(context);

  // A was confirmed last. The cookie is now B's, B's copy is on the device, and /api/me never
  // answers: past 3 s the launch opens offline as A, fetching nothing under B's cookie.
  await useCookie(context, userB);
  await markLibrary(page, OWN_B);
  await page.route('**/api/me', () => {});
  const library = countLibraryRequests(page);
  const started = Date.now();
  await page.goto('/exercises');
  await expect(page.getByText(EMAIL_A)).toBeVisible({ timeout: 10_000 });
  expect(Date.now() - started).toBeGreaterThan(2500);
  await expect(page.getByText(OWN_A)).toBeVisible();
  await expect(page.getByText(EMAIL_B)).toHaveCount(0);
  await expect(page.getByText(OWN_B)).toHaveCount(0);

  // Past the persister's one-second throttle: nothing of B's reached A's copy.
  await page.waitForTimeout(1500);
  expect(library.requests).toBe(0);
  expect(await savedCache(page, userA)).not.toContain(OWN_B);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('a network error at launch opens the saved copy; a later answer runs its queries', async ({
  page,
  context,
}) => {
  await context.clock.install();
  await openAs(page, context, userA, EMAIL_A);
  await staleCache(context);

  await page.route('**/api/me', (route) => route.abort('internetdisconnected'));
  const library = countLibraryRequests(page);
  await page.goto('/exercises');
  await expect(page.getByText(OWN_A)).toBeVisible();
  await page.waitForTimeout(1000);
  expect(library.requests).toBe(0);

  // Signal again: the next /api/me, on refocus, confirms A and the library refreshes.
  await page.unrouteAll({ behavior: 'wait' });
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => library.requests).toBeGreaterThan(0);
  await expect(page.getByRole('listitem')).toHaveCount(50);
});

test('a failed focus account check keeps the confirmed account’s library visible', async ({
  page,
  context,
}) => {
  await openAs(page, context, userA, EMAIL_A);
  const { promise: held, resolve: release } = Promise.withResolvers<void>();
  await page.route('**/api/me', async (route) => {
    await held;
    await route.abort('internetdisconnected');
  });
  const meAsked = page.waitForRequest('**/api/me');
  const meFailed = page.waitForEvent('requestfailed', {
    predicate: (request) => new URL(request.url()).pathname === '/api/me',
  });
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await meAsked;
  await expect(page.getByText(EMAIL_A)).toBeVisible();
  release();
  await meFailed;
  await expect(page.getByText(EMAIL_A)).toBeVisible();
  await expect(page.getByText(OWN_A)).toBeVisible();
});

test('a failed Google sign-in preserves the saved account for an offline reload', async ({
  page,
  context,
}) => {
  await openAs(page, context, userA, EMAIL_A);
  await context.clearCookies();
  await page.goto('/sign-in');
  await page.route('**/api/auth/sign-in/social', (route) => route.abort('internetdisconnected'));
  await page.getByRole('button', { name: 'Sign in with Google' }).click();
  await expect(
    page.getByText('Sign-in didn’t finish. Check your connection and try again.'),
  ).toBeVisible();
  await page.route('**/api/me', (route) => route.abort('internetdisconnected'));
  await page.goto('/exercises');
  await expect(page.getByText(EMAIL_A)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(OWN_A)).toBeVisible();
});

test('with no saved copy, a slow /api/me still signs in', async ({ page, context }) => {
  // A first sign-in, or one after sign-out: past the 3 s limit, as a cold server can be.
  await useCookie(context, userA);
  await page.route('**/api/me', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 4500));
    await route.continue();
  });
  await page.goto('/exercises');
  await expect(page.getByText(EMAIL_A)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('listitem')).toHaveCount(50);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('the copy shared by every account before this version is removed and never shown', async ({
  page,
  context,
}) => {
  await openAs(page, context, userA, EMAIL_A);
  // The old shared copy, here holding A's data under the old key.
  const legacy = (await savedCache(page, userA)).replace(OWN_A, 'From the shared copy');
  await putDeviceValue(page, 'query-cache:overload', legacy);

  await useCookie(context, userB);
  await page.goto('/exercises');
  await expect(page.getByText(EMAIL_B)).toBeVisible();
  await expect(page.getByText('From the shared copy')).toHaveCount(0);
  expect(await deviceKeys(page)).not.toContain('query-cache:overload');
});

test('a 401 keeps the account’s saved data for when they sign in again', async ({
  page,
  context,
}) => {
  await openAs(page, context, userA, EMAIL_A);

  await context.clearCookies();
  await page.goto('/exercises');
  await expect(page).toHaveURL('/sign-in?next=%2Fexercises');
  expect(await deviceKeys(page)).toEqual(
    expect.arrayContaining(['signed-in-user', cacheKey(userA)]),
  );
  expect(await savedCache(page, userA)).toContain(OWN_A);
});

test('sign-out wipes every account’s saved copy', async ({ page, context }) => {
  await openAs(page, context, userB, EMAIL_B);
  await openAs(page, context, userA, EMAIL_A);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL('/sign-in');
  // Past the persister's one-second throttle: no write lands after the wipe.
  await page.waitForTimeout(1500);
  expect(await deviceKeys(page)).toEqual([]);
});

test('a second tab drops the previous account once another tab switches', async ({ context }) => {
  const first = await context.newPage();
  await openAs(first, context, userA, EMAIL_A);

  // Tab 2 opens as B. Both tabs then save B's copy, so it carries no marker.
  await useCookie(context, userB);
  const second = await context.newPage();
  await second.goto('/exercises');
  await expect(second.getByText(EMAIL_B)).toBeVisible();

  // Tab 1, without any refetch of its own, reopens as B.
  await expect(first.getByText(EMAIL_B)).toBeVisible();
  await expect(first.getByText(EMAIL_A)).toHaveCount(0);
  await expect(first.getByText(OWN_A)).toHaveCount(0);
  await first.waitForTimeout(1500);
  expect(await savedCache(first, userB)).not.toContain(OWN_A);
});

test('a focus account check keeps the open account on screen until another identity answers', async ({
  page,
  context,
}) => {
  await context.clock.install();
  await openAs(page, context, userA, EMAIL_A);
  await staleCache(context);
  await useCookie(context, userB);
  await markLibrary(page, OWN_B);
  const library = countLibraryRequests(page);
  const { promise: held, resolve: release } = Promise.withResolvers<void>();
  await page.route('**/api/me', async (route) => {
    await held;
    await route.continue();
  });
  const meAsked = page.waitForRequest('**/api/me');
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await meAsked;
  await expect(page.getByText(EMAIL_A)).toBeVisible();
  await expect(page.getByText(OWN_A)).toBeVisible();
  await page.waitForTimeout(1500);
  expect(library.requests).toBe(0);
  expect(await savedCache(page, userA)).not.toContain(OWN_B);
  release();
  await expect(page.getByText(EMAIL_B)).toBeVisible();
  await expect(page.getByText(OWN_B)).toBeVisible();
  await expect(page.getByText(EMAIL_A)).toHaveCount(0);
  await expect(page.getByText(OWN_A)).toHaveCount(0);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('a failed server sign-out keeps the session, cache, and other tab open', async ({
  context,
}) => {
  const first = await context.newPage();
  await openAs(first, context, userA, EMAIL_A);
  const second = await context.newPage();
  await second.goto('/exercises');
  await expect(second.getByText(EMAIL_A)).toBeVisible();
  await first.route('**/api/auth/sign-out', (route) => route.abort('internetdisconnected'));
  await first.getByRole('button', { name: 'Sign out' }).click();
  await expect(first.getByText("Couldn't sign out. Try again.")).toBeVisible();
  await expect(first.getByText(EMAIL_A)).toBeVisible();
  await expect(second.getByText(EMAIL_A)).toBeVisible();
  expect(await savedCache(first, userA)).toContain(OWN_A);
  expect(await deviceKeys(first)).toEqual(
    expect.arrayContaining(['signed-in-user', cacheKey(userA)]),
  );
  expect((await first.request.get('/api/me')).status()).toBe(200);
});

test('a successful sign-out wipes before other tabs reopen', async ({ context }) => {
  const first = await context.newPage();
  await openAs(first, context, userA, EMAIL_A);
  const second = await context.newPage();
  await second.goto('/exercises');
  await expect(second.getByText(EMAIL_A)).toBeVisible();
  await second.evaluate(() => {
    // oxlint-disable-next-line typescript/unbound-method -- Proxy forwards the original store as thisArg
    IDBObjectStore.prototype.clear = new Proxy(IDBObjectStore.prototype.clear, {
      apply(target, thisArg, args) {
        sessionStorage.setItem('observed-second-wipe', '1');
        return Reflect.apply(target, thisArg, args);
      },
    });
  });
  await first.getByRole('button', { name: 'Sign out' }).click();
  await expect(first).toHaveURL('/sign-in');
  await expect(second).toHaveURL('/sign-in?next=%2Fexercises');
  await expect(second.getByText(EMAIL_A)).toHaveCount(0);
  await expect
    .poll(() => second.evaluate(() => sessionStorage.getItem('observed-second-wipe')))
    .toBe('1');
  expect(await deviceKeys(second)).toEqual([]);
});

test('a failed pending remember write cannot stop a confirmed sign-out', async ({ context }) => {
  const first = await context.newPage();
  await openAs(first, context, userA, EMAIL_A);
  const second = await context.newPage();
  await second.goto('/exercises');
  await expect(second.getByText(EMAIL_A)).toBeVisible();
  await first.bringToFront();

  await first.evaluate(async () => {
    const opened = indexedDB.open('overload');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      opened.addEventListener('success', () => resolve(opened.result));
      opened.addEventListener('error', () => reject(opened.error));
    });
    const transaction = db.transaction('device', 'readwrite');
    const store = transaction.objectStore('device');
    const keepBusy = () => {
      const request = store.get('remember-write-blocker');
      request.addEventListener('success', () => {
        if (document.documentElement.dataset.releaseRemember === '1') return;
        keepBusy();
      });
    };
    keepBusy();
    transaction.addEventListener('complete', () => db.close());

    // oxlint-disable-next-line typescript/unbound-method -- called with its own store via put.call
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      const request = put.call(this, value, key);
      if (key === 'signed-in-user') {
        document.documentElement.dataset.rememberAttempted = '1';
        const write = this.transaction;
        write.addEventListener('abort', () => {
          document.documentElement.dataset.rememberRejected = '1';
        });
        request.addEventListener('success', () => write.abort());
      }
      return request;
    };
  });

  const { promise: heldSignOut, resolve: releaseSignOut } = Promise.withResolvers<void>();
  await first.route('**/api/auth/sign-out', async (route) => {
    await heldSignOut;
    await route.continue();
  });
  const signOutAsked = first.waitForRequest('**/api/auth/sign-out');
  await first.getByRole('button', { name: 'Sign out' }).click();
  await signOutAsked;

  const meAsked = first.waitForRequest('**/api/me');
  await first.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await meAsked;
  await first.waitForFunction(() => document.documentElement.dataset.rememberAttempted === '1');
  const signOutAnswered = first.waitForResponse('**/api/auth/sign-out');
  releaseSignOut();
  await signOutAnswered;
  await first.evaluate(() => {
    document.documentElement.dataset.releaseRemember = '1';
  });

  await first.waitForFunction(() => document.documentElement.dataset.rememberRejected === '1');
  await expect(first).toHaveURL('/sign-in');
  await expect(second).toHaveURL('/sign-in?next=%2Fexercises');
  expect(await deviceKeys(second)).toEqual([]);
});

test('a failed wipe keeps the saved copy closed on an offline reload', async ({ context }) => {
  const first = await context.newPage();
  await openAs(first, context, userA, EMAIL_A);
  const second = await context.newPage();
  await second.goto('/exercises');
  await expect(second.getByText(EMAIL_A)).toBeVisible();
  await first.bringToFront();

  const errors: Error[] = [];
  first.on('pageerror', (error) => errors.push(error));
  await context.addInitScript(() => {
    IDBObjectStore.prototype.clear = () => {
      throw new DOMException('The wipe failed.', 'UnknownError');
    };
  });
  await first.evaluate(() => {
    IDBObjectStore.prototype.clear = () => {
      throw new DOMException('The wipe failed.', 'UnknownError');
    };
  });

  await first.getByRole('button', { name: 'Sign out' }).click();
  await expect(first).toHaveURL('/sign-in?wipe=failed');
  await expect(second).toHaveURL('/sign-in?next=%2Fexercises');
  await expect(second.getByText(EMAIL_A)).toHaveCount(0);
  expect(await savedCache(first, userA)).toBe('');
  await first.route('**/api/me', (route) => route.abort('internetdisconnected'));
  await first.goto('/exercises');
  await expect(
    first.getByText('Couldn’t reach Overload. Open the app again when you have signal.'),
  ).toBeVisible();
  await expect(first.getByText(EMAIL_A)).toHaveCount(0);
  await expect(first.getByText(OWN_A)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a pending wipe blocks the saved copy after an account check succeeds', async ({
  page,
  context,
}) => {
  await openAs(page, context, userA, EMAIL_A);
  await context.addInitScript(() => {
    IDBObjectStore.prototype.clear = () => {
      throw new DOMException('The wipe failed.', 'UnknownError');
    };
  });
  await page.evaluate(() => {
    IDBObjectStore.prototype.clear = () => {
      throw new DOMException('The wipe failed.', 'UnknownError');
    };
  });

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL('/sign-in?wipe=failed');
  expect(await savedCache(page, userA)).toContain(OWN_A);

  await useCookie(context, userA);
  const { promise: heldExercise, resolve: releaseExercise } = Promise.withResolvers<void>();
  const exerciseAsked = page.waitForRequest('**/api/exercises');
  const freshExercise = 'Fresh exercise after sign-in';
  await page.route('**/api/exercises', async (route) => {
    const response = await route.fetch();
    const { items }: { items: { name: string }[] } = await response.json();
    const [first, ...rest] = items;
    await heldExercise;
    await route.fulfill({
      response,
      json: { items: [{ ...first, name: freshExercise }, ...rest] },
    });
  });
  await page.goto('/exercises');
  await exerciseAsked;
  await expect(page.getByText(EMAIL_A)).toBeVisible();
  await expect(page.getByText(OWN_A)).toHaveCount(0);
  releaseExercise();
  await expect(page.getByText(freshExercise)).toBeVisible();
});

test('failed marker and wipe show a saved-data notice after sign-out', async ({
  page,
  context,
}) => {
  await openAs(page, context, userA, EMAIL_A);
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('The marker failed.', 'QuotaExceededError');
    };
    IDBObjectStore.prototype.clear = () => {
      throw new DOMException('The wipe failed.', 'UnknownError');
    };
  });

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL('/sign-in?wipe=failed');
  await expect(page.getByText("Saved data couldn't be cleared from this device.")).toBeVisible();
  expect(await savedCache(page, userA)).toContain(OWN_A);
});

test('an exercise answer already in flight cannot enter the previous account copy', async ({
  page,
  context,
}) => {
  await useCookie(context, userA);
  const { promise: heldExercise, resolve: releaseExercise } = Promise.withResolvers<void>();
  const exerciseAsked = page.waitForRequest('**/api/exercises');
  await page.route('**/api/exercises', async (route) => {
    const response = await route.fetch();
    const { items }: { items: { name: string }[] } = await response.json();
    const [first, ...rest] = items;
    await heldExercise;
    await route
      .fulfill({ response, json: { items: [{ ...first, name: OWN_B }, ...rest] } })
      .catch(() => undefined);
  });
  await page.goto('/exercises');
  await exerciseAsked;
  await expect(page.getByText(EMAIL_A)).toBeVisible();
  await expect.poll(() => savedCache(page, userA)).toContain(EMAIL_A);
  await useCookie(context, userB);
  const { promise: heldMe, resolve: releaseMe } = Promise.withResolvers<void>();
  await page.route('**/api/me', async (route) => {
    await heldMe;
    await route.continue();
  });
  const meAsked = page.waitForRequest('**/api/me');
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await meAsked;
  releaseExercise();
  await page.waitForTimeout(1500);
  expect(await savedCache(page, userA)).not.toContain(OWN_B);
  releaseMe();
  await expect(page.getByText(EMAIL_B)).toBeVisible();
  await expect(page.getByText(OWN_B)).toBeVisible();
});

test('a retry answered under another account’s cookie never enters the open account’s copy', async ({
  page,
  context,
}) => {
  await useCookie(context, userA);

  // A's launch is confirmed, then its library request fails once. Before the retry, the cookie becomes
  // B's with no reload and no account check in between, as `pnpm dev:session` can leave an open tab
  // (docs/08 §5).
  const { promise: switched, resolve: switchDone } = Promise.withResolvers<void>();
  let calls = 0;
  await page.route('**/api/exercises', async (route) => {
    calls += 1;
    if (calls === 1) {
      await switched;
      await route.fulfill({ status: 500, contentType: 'application/problem+json', body: '{}' });
      return;
    }
    const response = await route.fetch();
    const { items }: { items: { name: string }[] } = await response.json();
    const [first, ...rest] = items;
    await route.fulfill({ response, json: { items: [{ ...first, name: OWN_B }, ...rest] } });
  });
  let meRequests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/me') meRequests += 1;
  });
  const asked = page.waitForRequest('**/api/exercises');
  await page.goto('/exercises');
  await asked;
  await expect(page.getByText(EMAIL_A)).toBeVisible();
  await expect.poll(() => savedCache(page, userA)).toContain(EMAIL_A);
  await useCookie(context, userB);
  switchDone();

  // The retry answers as B: A's copy refuses it, shows as not updated, and nothing asks /api/me again.
  await expect(page.getByText('Not updated')).toBeVisible();
  await page.waitForTimeout(1500);
  expect(calls).toBe(2);
  expect(meRequests).toBe(1);
  await expect(page.getByText(EMAIL_A)).toBeVisible();
  await expect(page.getByText(OWN_B)).toHaveCount(0);
  expect(await savedCache(page, userA)).not.toContain(OWN_B);

  // The next account check, on focus, opens B's own copy.
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByText(EMAIL_B)).toBeVisible();
  await expect(page.getByText(OWN_B)).toBeVisible();
  await page.waitForTimeout(1500);
  expect(await savedCache(page, userA)).not.toContain(OWN_B);
  expect(await savedCache(page, userB)).toContain(OWN_B);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('an answer naming no account shows as not updated without looping through /api/me', async ({
  page,
  context,
}) => {
  await useCookie(context, userA);
  // A proxy that strips the header, or a web build live before its API.
  await page.route('**/api/exercises', async (route) => {
    const response = await route.fetch();
    const headers = Object.fromEntries(
      Object.entries(response.headers()).filter(([name]) => name !== 'overload-user'),
    );
    const { items }: { items: { name: string }[] } = await response.json();
    const [first, ...rest] = items;
    await route.fulfill({
      response,
      headers,
      json: { items: [{ ...first, name: OWN_A }, ...rest] },
    });
  });
  const requests = { me: 0, exercises: 0 };
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (pathname === '/api/me') requests.me += 1;
    if (pathname === '/api/exercises') requests.exercises += 1;
  });
  await page.goto('/exercises');
  await expect(page.getByText(EMAIL_A)).toBeVisible();
  await expect(page.getByText('Not updated')).toBeVisible();

  await page.waitForTimeout(2000);
  expect(requests).toEqual({ me: 1, exercises: 1 });
  await expect(page.getByText(EMAIL_A)).toBeVisible();
  await expect(page.getByText(OWN_A)).toHaveCount(0);
  expect(await savedCache(page, userA)).not.toContain(OWN_A);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});
