import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { WEB_ORIGIN } from '../playwright.config';
import { apiFixture } from './fixture';

type Cookies = Parameters<BrowserContext['addCookies']>[0];

// Weight, a section of Progress (docs/10 §6, issue #76): type a weight, see it on the section with
// its time, a day's second reading stored but not in the trend, the trend from the third day, and
// deleting a typed weigh-in. A user of its own, in Tokyo, with earlier weigh-ins sent to the API.
const EMAIL = 'weight@example.test';
let userId = '';

test.beforeAll(() => {
  const created: { userId: string } = JSON.parse(apiFixture('user', EMAIL));
  ({ userId } = created);
});

test.afterAll(() => {
  apiFixture('delete', EMAIL);
});

test.beforeEach(async ({ context, page }) => {
  const cookies: Cookies = JSON.parse(apiFixture('cookies', userId, 'localhost'));
  await context.addCookies(cookies);
  const profile = await page.request.patch('/api/me/profile', {
    data: { timezone: 'Asia/Tokyo', weightUnit: 'kg' },
  });
  expect(profile.ok()).toBe(true);
  // Each test starts with no weigh-ins.
  const { weighIns }: { weighIns: { id: string }[] } = await (
    await page.request.get('/api/weigh-ins')
  ).json();
  for (const each of weighIns) {
    // Hono's csrf() reads the Origin a browser would send (docs/08 §2).
    const deleted = await page.request.delete(`/api/weigh-ins/${each.id}`, {
      headers: { Origin: WEB_ORIGIN },
    });
    expect(deleted.status()).toBe(204);
  }
});

const DAY_MS = 24 * 60 * 60 * 1000;

/** A local `YYYY-MM-DD` in Tokyo, `daysAgo` days before today. */
const tokyoDate = (daysAgo: number) =>
  new Date(Date.now() + 9 * 60 * 60 * 1000 - daysAgo * DAY_MS).toISOString().slice(0, 10);

/** A typed weigh-in at 07:00 Tokyo, `daysAgo` days back, sent to the API. */
async function weighIn(page: Page, daysAgo: number, weightKg: number) {
  const res = await page.request.post('/api/weigh-ins', {
    data: {
      id: crypto.randomUUID(),
      measuredAt: new Date(`${tokyoDate(daysAgo)}T07:00:00+09:00`).toISOString(),
      weightKg,
    },
  });
  expect(res.status()).toBe(201);
}

const recent = (page: Page) => page.getByRole('region', { name: 'Recent weigh-ins' });

test('types a weight, sees it on the section, then deletes it', async ({ page }) => {
  await page.goto('/progress');
  await page
    .getByRole('navigation', { name: 'Progress' })
    .getByRole('link', { name: 'Weight' })
    .click();
  await expect(page).toHaveURL('/progress/weight');
  await expect(page.getByRole('heading', { name: 'No weigh-ins yet' })).toBeVisible();

  await page.getByRole('button', { name: 'Type a weight' }).click();
  await expect(page).toHaveURL('/progress/weight/new');
  await page.getByRole('textbox', { name: 'Weight' }).fill('400');
  await page.getByRole('button', { name: 'Save weigh-in' }).click();
  await expect(page.getByText('A weight between 20 and 300 kg.')).toBeVisible();

  await page.getByRole('textbox', { name: 'Weight' }).fill('82.4');
  // Yesterday, so 07:40 has passed whenever the test runs.
  await page.getByLabel('Date', { exact: true }).fill(tokyoDate(1));
  await page.getByLabel('Time', { exact: true }).fill('07:40');
  await expect(
    page.getByText('Before 10:00, so it counts as this morning’s weigh-in'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Save weigh-in' }).click();

  await expect(page).toHaveURL('/progress/weight');
  await expect(page.getByText('Weigh-in saved.')).toBeVisible();
  await expect(page.getByText('Latest weigh-in')).toBeVisible();
  await expect(
    page.getByText('The trend starts from your third day of weigh-ins. 2 to go.'),
  ).toBeVisible();
  const row = recent(page).getByRole('listitem');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('07:40');
  await expect(row).toContainText('82.4');

  await row.getByRole('button', { name: /Delete/ }).click();
  await expect(page.getByText('Weigh-in deleted.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No weigh-ins yet' })).toBeVisible();

  await expect(recent(page).getByRole('listitem')).toHaveCount(0);
});

// A page the service worker controls fetches through it, where WebKit shows a route nothing.
test.describe('with no service worker', () => {
  test.use({ serviceWorkers: 'block' });

  test('keeps the id for an uncertain retry and links to a saved reading after editing', async ({
    page,
  }) => {
    await page.goto('/progress/weight/new');
    await page.getByRole('textbox', { name: 'Weight' }).fill('82.4');
    await page.getByLabel('Date', { exact: true }).fill(tokyoDate(1));
    await page.getByLabel('Time', { exact: true }).fill('07:40');

    const sentIds: string[] = [];
    await page.route('**/api/weigh-ins', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const body: { id: string } = route.request().postDataJSON();
      if (sentIds.length === 2) {
        sentIds.push(body.id);
        await route.continue();
        return;
      }
      const response = await route.fetch();
      expect(response.status()).toBe(sentIds.length === 0 ? 201 : 200);
      sentIds.push(body.id);
      await route.abort();
    });

    const save = page.getByRole('button', { name: 'Save weigh-in' });
    await save.click();
    await expect(page.getByText('Couldn’t reach Overload.')).toBeVisible();
    await save.click();
    await expect.poll(() => sentIds.length).toBe(2);
    await expect(save).toBeEnabled();
    expect(sentIds[1]).toBe(sentIds[0]);

    await page.getByRole('textbox', { name: 'Weight' }).fill('82.5');
    const refused = page.waitForResponse(
      (response) =>
        response.url().includes('/api/weigh-ins') && response.request().method() === 'POST',
    );
    await save.click();
    expect((await refused).status()).toBe(409);
    expect(sentIds[2]).not.toBe(sentIds[0]);
    await expect(page.getByText('A weigh-in for that time is already saved.')).toBeVisible();
    const weightList = page.getByRole('link', { name: 'View weight list' });
    await expect(weightList).toHaveAttribute('href', '/progress/weight');
    const response = await page.request.get('/api/weigh-ins');
    expect(response.ok()).toBe(true);
    const { weighIns }: { weighIns: { id: string; weightKg: number }[] } = await response.json();
    expect(weighIns).toEqual([expect.objectContaining({ id: sentIds[0], weightKg: 82.4 })]);
    await weightList.click();
    await expect(page).toHaveURL('/progress/weight');
    await expect(recent(page).getByRole('listitem')).toContainText('82.4');
  });
});

test('marks a second reading of the day as stored, and draws the trend from the third day', async ({
  page,
}) => {
  await weighIn(page, 2, 83.0);
  await weighIn(page, 1, 82.8);
  await weighIn(page, 0, 82.6);

  await page.goto('/progress/weight/new');
  await page.getByRole('textbox', { name: 'Weight' }).fill('83.4');
  await page.getByLabel('Date', { exact: true }).fill(tokyoDate(1));
  await page.getByLabel('Time', { exact: true }).fill('19:30');
  await expect(page.getByText('After 10:00. It counts for the day only if')).toBeVisible();
  await page.getByRole('button', { name: 'Save weigh-in' }).click();

  await expect(page).toHaveURL('/progress/weight');
  await expect(page.locator('.whead__label')).toHaveText('Trend');
  await expect(page.getByText('Trend', { exact: true }).last()).toBeVisible();
  await expect(recent(page).getByRole('listitem').filter({ hasText: '19:30' })).toContainText(
    'stored, not in trend',
  );
});

test('shows weights in pounds when the profile says so', async ({ page }) => {
  await weighIn(page, 0, 82.4);
  const profile = await page.request.patch('/api/me/profile', { data: { weightUnit: 'lb' } });
  expect(profile.ok()).toBe(true);
  await page.goto('/progress/weight');
  // 82.4 kg is 181.66 lb, to the tenth.
  await expect(recent(page).getByRole('listitem')).toContainText('181.7');
  await expect(recent(page).getByRole('listitem')).toContainText('lb');
});
