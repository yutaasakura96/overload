import { expect, test, type BrowserContext } from '@playwright/test';
import { WEB_ORIGIN } from '../playwright.config';
import { apiFixture } from './fixture';

type Cookies = Parameters<BrowserContext['addCookies']>[0];

// The food list (S12, docs/10 §8.6, issue #78): add a food from the MEXT table and one typed by
// hand from a package's values, each checked before it is saved, and group two foods as
// alternatives. A user of its own, with an empty list at the start of each test.
const EMAIL = 'foods@example.test';
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
  const groups: { items: { id: string }[] } = await (
    await page.request.get('/api/rotation-groups')
  ).json();
  for (const group of groups.items) {
    const res = await page.request.delete(`/api/rotation-groups/${group.id}`, {
      headers: { Origin: WEB_ORIGIN },
    });
    expect(res.status()).toBe(204);
  }
  const foods: { items: { id: string }[] } = await (await page.request.get('/api/foods')).json();
  for (const food of foods.items) {
    // Archived, they are off the list and no longer count as duplicates.
    const res = await page.request.delete(`/api/foods/${food.id}`, {
      headers: { Origin: WEB_ORIGIN },
    });
    expect(res.status()).toBe(204);
  }
});

test('adds a food from the MEXT table, checked before saving', async ({ page }) => {
  await page.goto('/food');
  await expect(page.getByRole('heading', { name: 'No foods yet' })).toBeVisible();
  await page.getByRole('button', { name: 'Add a food' }).click();

  await page.getByRole('searchbox', { name: 'Search the MEXT food table' }).fill('chicken breast');
  const pick = page.getByRole('button', { name: /meat without skin, raw.*MEXT 11220/ });
  await expect(pick).toBeVisible();
  await expect(pick).toContainText('105 kcal · 23.3 g protein per 100 g');
  await pick.click();

  await expect(page.getByRole('heading', { name: 'Check before saving' })).toBeVisible();
  await expect(page.getByText('MEXT FOOD TABLE · 11220')).toBeVisible();
  await expect(page.getByRole('textbox', { name: /^Calories/ })).toHaveValue('105');
  await expect(page.getByRole('textbox', { name: /^Protein/ })).toHaveValue('23.3');
  await page.getByRole('textbox', { name: 'Name' }).fill('Chicken breast, skinless');
  await page.getByRole('textbox', { name: /^A cooked batch keeps for/ }).fill('4');
  await page.getByRole('button', { name: 'Save to my foods' }).click();

  await expect(page.getByText('Saved to your foods, per 100 g.')).toBeVisible();
  const row = page.getByRole('link', { name: /Chicken breast, skinless/ });
  await expect(row).toContainText('105 kcal · 23.3 g protein · per 100 g raw');
  await expect(row).toContainText('Batch-cooked · keeps 4 days');

  // The same MEXT food again says it is on the list, and saving it makes nothing new.
  await page.getByRole('button', { name: 'Add a food' }).click();
  await page.getByRole('searchbox', { name: 'Search the MEXT food table' }).fill('むね 皮なし 生');
  await page.getByRole('button', { name: /MEXT 11220 · on your list/ }).click();
  await expect(page.getByText('Already on your list')).toBeVisible();
  await page.getByRole('button', { name: 'Save to my foods' }).click();
  await expect(page.getByText('Nothing was saved: it is on your list already.')).toBeVisible();
});

test('drops a food candidate when the account changes in the same tab', async ({
  context,
  page,
}) => {
  const email = 'other-foods@example.test';
  const other: { userId: string } = JSON.parse(apiFixture('user', email));
  try {
    await page.goto('/food');
    await page.getByRole('button', { name: 'Add a food' }).click();
    await page
      .getByRole('searchbox', { name: 'Search the MEXT food table' })
      .fill('chicken breast');
    await page.getByRole('button', { name: /meat without skin, raw.*MEXT 11220/ }).click();
    await expect(page.getByRole('textbox', { name: 'Name' })).not.toBeEmpty();
    await page.goBack();
    await page.goBack();

    const cookies: Cookies = JSON.parse(apiFixture('cookies', other.userId, 'localhost'));
    await context.addCookies(cookies);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.getByText(email)).toBeVisible();
    await page.goForward();
    await page.goForward();

    await expect(page.getByText('TYPED BY HAND')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Name' })).toBeEmpty();
    await expect(page.getByRole('textbox', { name: /^Protein/ })).toBeEmpty();
  } finally {
    apiFixture('delete', email);
  }
});

test('adds a food by hand from its package values, saved per 100 g', async ({ page }) => {
  await page.goto('/food/new');
  await page.getByRole('button', { name: /Enter it by hand/ }).click();
  await expect(page.getByText('TYPED BY HAND')).toBeVisible();

  await page.getByRole('textbox', { name: 'Name' }).fill('サラダチキン プレーン');
  await page.getByText('Per package', { exact: true }).click();
  await page.getByRole('textbox', { name: /^That amount weighs/ }).fill('110');
  await page.getByRole('textbox', { name: /^Calories/ }).fill('121');
  await page.getByRole('textbox', { name: /^Protein/ }).fill('26.4');
  await page.getByRole('textbox', { name: /^Carbs/ }).fill('0.3');
  await page.getByRole('textbox', { name: /^Fat/ }).fill('1.5');
  // The converted values show before saving.
  const preview = page.getByRole('region', { name: 'Per 100 g, as it will be saved' });
  await expect(preview).toContainText('110');
  await expect(preview).toContainText('24');
  await page.getByText('Cooked', { exact: true }).click();
  await page.getByRole('button', { name: 'Save to my foods' }).click();

  await expect(page.getByText('Saved to your foods, per 100 g.')).toBeVisible();
  await page.getByRole('link', { name: /サラダチキン プレーン/ }).click();
  await expect(page.getByRole('heading', { name: 'Per 100 g, cooked' })).toBeVisible();
  const values = page.getByRole('region', { name: 'Per 100 g, cooked' });
  await expect(values).toContainText('Calories110 kcal');
  await expect(values).toContainText('Protein24 g');
  await expect(values).toContainText('Fat1.4 g');
});

test('refuses a package without its weight, on the device', async ({ page }) => {
  await page.goto('/food/new/check');
  await page.getByRole('textbox', { name: 'Name' }).fill('Protein bar');
  await page.getByText('Per serving', { exact: true }).click();
  for (const [field, value] of [
    ['Calories', '190'],
    ['Protein', '15'],
    ['Carbs', '20'],
    ['Fat', '7'],
  ] as const) {
    await page.getByRole('textbox', { name: new RegExp(`^${field}`) }).fill(value);
  }
  await page.getByRole('button', { name: 'Save to my foods' }).click();
  await expect(page.getByText('Give the weight of the piece, serving or package')).toBeVisible();
  await expect(page.getByRole('textbox', { name: /^That amount weighs/ })).toBeFocused();
});

test('adds a label food whose package weight was not printed', async ({ page }) => {
  await page.route('**/api/label-reads', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        candidate: {
          name: 'Label protein bar',
          brand: null,
          state: 'raw',
          basis: { kind: 'per_package', grams: null },
          energyKcal: 120,
          proteinG: 0.015,
          carbG: 10,
          fatG: 2,
          fiberG: null,
        },
        per100g: null,
        model: 'stub',
      }),
    });
  });
  await page.goto('/food/new/label');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'label.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==',
      'base64',
    ),
  });

  await expect(page.getByRole('heading', { name: 'Check before saving' })).toBeVisible();
  await expect(page.getByText('Per package', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: /^Protein/ })).toHaveValue('0.015');
  await page.getByRole('button', { name: 'Save to my foods' }).click();
  await expect(page.getByText('Give the weight of the piece, serving or package')).toBeVisible();
  await page.getByRole('textbox', { name: /^That amount weighs/ }).fill('15');
  const preview = page.getByRole('region', { name: 'Per 100 g, as it will be saved' });
  await expect(preview).toContainText('Protein0.1 g');
  await page.getByRole('button', { name: 'Save to my foods' }).click();

  await expect(page.getByText('Saved to your foods, per 100 g.')).toBeVisible();
  await page.getByRole('link', { name: /Label protein bar/ }).click();
  const values = page.getByRole('region', { name: 'Per 100 g, raw' });
  await expect(values).toContainText('Calories800 kcal');
  await expect(values).toContainText('Protein0.1 g');
});

test('weighs 100 ml of a label food before converting its values', async ({ page }) => {
  await page.route('**/api/label-reads', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        candidate: {
          name: 'Dense drink',
          brand: null,
          state: 'raw',
          basis: { kind: 'per_100ml', grams: null },
          energyKcal: 100,
          proteinG: 11,
          carbG: 10,
          fatG: 2,
          fiberG: null,
        },
        per100g: null,
        model: 'stub',
      }),
    });
  });
  await page.goto('/food/new/label');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'label.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==',
      'base64',
    ),
  });

  await expect(page.getByRole('heading', { name: 'Check before saving' })).toBeVisible();
  await expect(page.getByText('Per 100 ml', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: /^That amount weighs/ }).fill('110');
  await page.getByRole('button', { name: 'Save to my foods' }).click();
  await expect(page.getByText('Saved to your foods, per 100 g.')).toBeVisible();
  const foods: { items: { name: string; energyKcal: number; proteinG: number }[] } = await (
    await page.request.get('/api/foods')
  ).json();
  expect(foods.items.find((food) => food.name === 'Dense drink')).toMatchObject({
    energyKcal: 90.91,
    proteinG: 10,
  });
});

test('groups two foods as alternatives', async ({ page }) => {
  for (const name of ['Okra', 'Broccoli']) {
    const res = await page.request.post('/api/foods', {
      headers: { Origin: WEB_ORIGIN },
      data: {
        id: crypto.randomUUID(),
        name,
        state: 'raw',
        basis: { kind: 'per_100g', grams: null },
        energyKcal: 30,
        proteinG: 3,
        carbG: 3,
        fatG: 0.3,
        fiberG: 4,
        source: 'manual',
      },
    });
    expect(res.status()).toBe(201);
  }
  await page.goto('/food');
  await page.getByRole('link', { name: /Rotation groups/ }).click();
  await page.getByRole('button', { name: 'New group' }).click();
  await page.getByRole('textbox', { name: 'Group name' }).fill('Green vegetable');
  await page.getByRole('button', { name: 'Make the group' }).click();

  const group = page.getByRole('region', { name: /Green vegetable · / });
  await expect(group.getByRole('heading')).toHaveText('Green vegetable · 0');
  for (const name of ['Okra', 'Broccoli']) {
    await group.getByRole('button', { name: '+ Add a food to green vegetable' }).click();
    await group.getByRole('combobox', { name: 'Add a food to green vegetable' }).selectOption(name);
    await group.getByRole('button', { name: 'Add to green vegetable' }).click();
  }
  await expect(group.getByRole('heading')).toHaveText('Green vegetable · 2');
  await expect(group.getByRole('listitem')).toHaveText([/^Broccoli/, /^Okra/]);

  // Each food carries its group on the list.
  await page.getByRole('button', { name: 'Back to your foods' }).click();
  await expect(page.getByRole('link', { name: /Okra/ })).toContainText('Green vegetable');
  await expect(page.getByRole('link', { name: /Broccoli/ })).toContainText('Green vegetable');
});

test('retries a group create after its response is lost', async ({ page }) => {
  const ids: string[] = [];
  await page.route('**/api/rotation-groups', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    const body: { id: string } = route.request().postDataJSON();
    ids.push(body.id);
    if (ids.length === 1) {
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort('failed');
      return;
    }
    await route.continue();
  });

  await page.goto('/food/groups');
  await page.getByRole('button', { name: 'New group' }).click();
  await page.getByRole('textbox', { name: 'Group name' }).fill('Leafy greens');
  const make = page.getByRole('button', { name: 'Make the group' });
  await make.click();
  await expect(
    page.getByText(
      'Couldn’t reach Overload. The group is still here; save again when you have signal.',
    ),
  ).toBeVisible();
  await make.click();

  await expect(page.getByRole('region', { name: /Leafy greens · 0/ })).toBeVisible();
  expect(ids).toHaveLength(2);
  expect(ids[1]).toBe(ids[0]);
  const saved: { items: { name: string }[] } = await (
    await page.request.get('/api/rotation-groups')
  ).json();
  expect(saved.items.filter((group) => group.name === 'Leafy greens')).toHaveLength(1);
});
