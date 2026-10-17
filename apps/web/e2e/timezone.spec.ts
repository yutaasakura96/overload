import { expect, test, type BrowserContext } from '@playwright/test';
import { apiFixture } from './fixture';

type Cookies = Parameters<BrowserContext['addCookies']>[0];

// The profile form's time zone list (docs/10 S0): preselected from the device, searchable, and
// only ever saving an IANA name. A user of its own, so no other spec's profile is touched.
const EMAIL = 'timezone@example.test';
let userId = '';

test.use({ timezoneId: 'Pacific/Auckland' });

test.beforeAll(() => {
  const created: { userId: string } = JSON.parse(apiFixture('user', EMAIL));
  ({ userId } = created);
});

test.afterAll(() => {
  apiFixture('delete', EMAIL);
});

test.beforeEach(async ({ context }) => {
  const cookies: Cookies = JSON.parse(apiFixture('cookies', userId, 'localhost'));
  await context.addCookies(cookies);
});

test('the time zone opens on the device’s, is searched by city, and saves the IANA name', async ({
  page,
}) => {
  await page.goto('/');
  const zone = page.getByRole('combobox', { name: 'Time zone' });
  await expect(zone).toHaveValue('Pacific/Auckland');

  await zone.fill('new york');
  const options = page.getByRole('option');
  await expect(options).toHaveCount(1);
  await expect(options.first()).toContainText('America/New_York');

  // Leaving without choosing puts the chosen zone back: free text is never the value.
  await page.getByRole('heading', { name: 'Set up your profile' }).click();
  await expect(zone).toHaveValue('Pacific/Auckland');

  // The keyboard alone: type, arrow to the option, Enter picks it and does not submit.
  await zone.fill('tokyo');
  await zone.press('Enter');
  await expect(zone).toHaveValue('Asia/Tokyo');
  await expect(page.getByText('Saved.')).toBeHidden();

  await page.getByRole('button', { name: 'Save and finish setup' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  const me: { profile: { timezone: string } } = await (await page.request.get('/api/me')).json();
  expect(me.profile.timezone).toBe('Asia/Tokyo');
});

test('a search with no match says so and keeps the saved zone', async ({ page }) => {
  // The first test saved Asia/Tokyo, which now wins over the device's zone.
  await page.goto('/');
  const zone = page.getByRole('combobox', { name: 'Time zone' });
  await expect(zone).toHaveValue('Asia/Tokyo');
  await zone.fill('zzzz');
  await expect(page.getByText('No time zone matches.')).toBeVisible();
  await zone.press('Escape');
  await expect(zone).toHaveValue('Asia/Tokyo');
});
