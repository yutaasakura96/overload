import { expect, test, type Request } from '@playwright/test';
import { E2E_EMAIL, apiFixture } from './fixture';
import { SENTRY_DSN_HOST } from '../playwright.config';

type Cookies = Parameters<import('@playwright/test').BrowserContext['addCookies']>[0];

// docs/03 §7: a browser error reaches Sentry with no user, cookie, query string or on-screen value.
// The build under test has a DSN on a host that cannot resolve (playwright.config.ts); its envelopes
// are caught here, so this reads exactly what would leave the phone.
const userId = process.env.E2E_USER_ID ?? '';

test('a browser error reaches Sentry scrubbed', async ({ context, page }) => {
  if (userId === '') throw new Error('global setup did not create the test user');
  const cookies: Cookies = JSON.parse(apiFixture('cookies', userId, 'localhost'));
  await context.addCookies(cookies);
  const envelopes: Request[] = [];
  await page.route(`https://${SENTRY_DSN_HOST}/**`, async (route) => {
    envelopes.push(route.request());
    await route.fulfill({ status: 200, body: '{}' });
  });

  await page.goto('/exercises');
  await expect(page.getByText(E2E_EMAIL)).toBeVisible();
  // A request whose query holds something typed, then an uncaught error.
  const typed = ['typed', 'search', 'term'].join('-');
  await page.evaluate(async (term) => {
    await fetch(`/api/exercises?q=${term}`);
    setTimeout(() => {
      throw new Error('sentry e2e probe');
    });
  }, typed);

  await expect.poll(() => envelopes.length).toBeGreaterThan(0);
  const sent = envelopes.map((request) => request.postData() ?? '').join('\n');
  expect(sent).toContain('sentry e2e probe');
  expect(sent).toContain('"environment":"development"');
  // The request is kept as a breadcrumb, without its query.
  expect(sent).toContain('/api/exercises');
  expect(sent).not.toContain(typed);
  expect(sent).not.toContain(E2E_EMAIL);
  for (const cookie of cookies) expect(sent).not.toContain(cookie.value);
});
