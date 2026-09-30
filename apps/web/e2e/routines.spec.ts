import { expect, test } from '@playwright/test';
import { apiFixture } from './fixture';

type Cookies = Parameters<import('@playwright/test').BrowserContext['addCookies']>[0];

// S4 end to end (docs/09 F2 step 2): a routine is made from the picker, edited and deleted. Each
// run cleans up after itself, as both projects share the one test user.
const userId = process.env.E2E_USER_ID ?? '';

test.beforeEach(async ({ context }) => {
  if (userId === '') throw new Error('global setup did not create the test user');
  const cookies: Cookies = JSON.parse(apiFixture('cookies', userId, 'localhost'));
  await context.addCookies(cookies);
});

test('a routine is created from the picker, reordered and deleted', async ({ page }) => {
  const name = `Push ${Date.now()}`;
  await page.goto('/routines');
  await expect(page.getByRole('heading', { name: 'Routines', level: 1 })).toBeVisible();

  await page.goto('/routines/new');
  await page.getByRole('textbox', { name: 'Name' }).fill(name);
  await page.getByRole('button', { name: 'Add exercises' }).click();

  await page.getByRole('searchbox', { name: 'Search' }).fill('bench');
  await page.getByRole('checkbox', { name: 'Barbell Bench Press', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Incline Dumbbell Bench Press', exact: true }).check();
  await page.getByRole('button', { name: 'Add 2 exercises' }).click();

  // Back in the editor, in the order they were ticked, with focus where the user left.
  await expect(page.getByRole('button', { name: 'Add exercises' })).toBeFocused();
  const slots = page.getByRole('list').getByRole('listitem');
  await expect(slots).toHaveCount(2);
  await expect(slots.nth(0)).toContainText('Barbell Bench Press');

  // A half-set rep range is refused by the server, and the edit stays.
  await page.getByRole('textbox', { name: 'Reps low for Barbell Bench Press' }).fill('5');
  await page.getByRole('button', { name: 'Create routine' }).click();
  await expect(page.getByRole('alert').first()).toContainText('Refused');
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue(name);

  await page.getByRole('textbox', { name: 'Reps high for Barbell Bench Press' }).fill('8');
  await page.getByRole('button', { name: 'Create routine' }).click();

  await expect(page).toHaveURL('/routines');
  const row = page.getByRole('link', { name: new RegExp(name) });
  await expect(row).toContainText('2 EXERCISES · 6 SETS', { ignoreCase: true });
  await expect(row).toContainText('Barbell Bench Press, Incline Dumbbell Bench Press');

  await row.click();
  await page.getByRole('button', { name: 'Move Incline Dumbbell Bench Press up' }).click();
  await page.getByRole('button', { name: 'Save routine' }).click();
  await expect(page).toHaveURL('/routines');
  await expect(row).toContainText('Incline Dumbbell Bench Press, Barbell Bench Press');

  await row.click();
  await page.getByRole('button', { name: 'Delete routine' }).click();
  await expect(page.getByRole('button', { name: 'Keep' })).toBeFocused();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page).toHaveURL('/routines');
  await expect(row).toHaveCount(0);
});
