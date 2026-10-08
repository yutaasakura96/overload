import { expect, test } from '@playwright/test';
import { savedCache } from './device-store';
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

test('the picker files exercises under muscle groups and finds one by an alias', async ({
  page,
}) => {
  await page.goto('/routines/new');
  await page.getByRole('button', { name: 'Add exercises' }).click();

  const chest = page.getByRole('region', { name: 'Chest' });
  await expect(
    chest.getByRole('checkbox', { name: 'Barbell Bench Press', exact: true }),
  ).toBeVisible();

  await page.getByRole('searchbox', { name: 'Search' }).fill('butterfly');
  await expect(page.getByRole('heading', { name: '1 matching' })).toBeVisible();
  const fly = page.getByRole('checkbox', { name: 'Machine Chest Fly', exact: true });
  await expect(fly).toHaveAccessibleDescription('Stack machine');
  await fly.check();
  await expect(page.getByRole('button', { name: 'Add 1 exercise' })).toBeEnabled();
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

  // A half-set rep range is refused on the missing end before any request, and the edit stays.
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/routines') && request.method() !== 'GET') {
      writes.push(request.method());
    }
  });
  await page.getByRole('textbox', { name: 'Reps low for Barbell Bench Press' }).fill('5');
  await page.getByRole('button', { name: 'Create routine' }).click();
  await expect(page.getByRole('alert').first()).toContainText('Refused');
  await expect(page.getByText('Set both ends of the range, or neither')).toBeVisible();
  await expect(
    page.getByRole('textbox', { name: 'Reps high for Barbell Bench Press' }),
  ).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue(name);
  expect(writes).toEqual([]);

  // Text that is not a number is refused on the device, never sent as "follow the exercise".
  const repsLow = page.getByRole('textbox', { name: 'Reps low for Barbell Bench Press' });
  const repsHigh = page.getByRole('textbox', { name: 'Reps high for Barbell Bench Press' });
  await repsLow.fill('1e999');
  await repsHigh.fill('8a');
  await page.getByRole('button', { name: 'Create routine' }).click();
  await expect(page.getByRole('alert').first()).toContainText('Refused');
  // The slot says each message once, under its fields, and marks both fields.
  await expect(page.getByText('Enter a number, in digits only')).toHaveCount(1);
  await expect(repsLow).toHaveAttribute('aria-invalid', 'true');
  await expect(repsHigh).toHaveAttribute('aria-invalid', 'true');

  await repsLow.fill('5');
  await repsHigh.fill('8');
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

  // The slots are saved before the name, so a refused name leaves only the name unsaved.
  await row.click();
  writes.length = 0;
  await page.getByRole('textbox', { name: 'Sets for Barbell Bench Press' }).fill('4');
  await page.getByRole('textbox', { name: 'Name' }).fill(' ');
  await page.getByRole('button', { name: 'Save routine' }).click();
  await expect(page.getByRole('alert').first()).toContainText(
    'The exercises were saved; the name was not.',
  );
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveAttribute('aria-invalid', 'true');
  expect(writes).toEqual(['PUT', 'PATCH']);
  await page.getByRole('button', { name: 'Back to routines' }).click();
  await expect(row).toContainText('2 EXERCISES · 7 SETS', { ignoreCase: true });

  await row.click();
  await page.getByRole('button', { name: 'Delete routine' }).click();
  await expect(page.getByRole('button', { name: 'Keep' })).toBeFocused();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page).toHaveURL('/routines');
  await expect(row).toHaveCount(0);
});

test.describe('a relaunch after a write', () => {
  // page.route cannot hold a request a service worker forwards (WebKit).
  test.use({ serviceWorkers: 'block' });

  test('lists the routine the saved copy is missing', async ({ page }) => {
    const name = `Legs ${Date.now()}`;
    await page.goto('/routines');
    // The device's copy holds the list from before the write.
    await expect.poll(() => savedCache(page, userId)).toContain('"queryKey":["routines"]');
    await page.getByRole('button', { name: /^(Create a routine|New routine)$/ }).click();
    await page.getByRole('textbox', { name: 'Name' }).fill(name);
    await page.getByRole('button', { name: 'Add exercises' }).click();
    await page.getByRole('searchbox', { name: 'Search' }).fill('bench');
    await page.getByRole('checkbox', { name: 'Barbell Bench Press', exact: true }).check();
    await page.getByRole('button', { name: 'Add 1 exercise' }).click();

    // The answer to the create is lost, so the device keeps its list from before the write, as when
    // the app closes before the throttled save of the cache lands.
    const created = Promise.withResolvers<void>();
    await page.route('**/api/routines', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fetch();
      await route.abort();
      created.resolve();
    });
    await page.getByRole('button', { name: 'Create routine' }).click();
    await created.promise;
    await page.unrouteAll();

    await page.goto('/routines');
    const row = page.getByRole('link', { name: new RegExp(name) });
    await expect(row).toContainText('1 EXERCISE', { ignoreCase: true });

    await row.click();
    await page.getByRole('button', { name: 'Delete routine' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(row).toHaveCount(0);
  });

  test('opens the editor on the renamed routine, not the saved copy', async ({ page }) => {
    const name = `Pull ${Date.now()}`;
    const renamed = `${name} renamed`;
    await page.goto('/routines/new');
    await page.getByRole('textbox', { name: 'Name' }).fill(name);
    await page.getByRole('button', { name: 'Add exercises' }).click();
    await page.getByRole('searchbox', { name: 'Search' }).fill('bench');
    await page.getByRole('checkbox', { name: 'Barbell Bench Press', exact: true }).check();
    await page.getByRole('button', { name: 'Add 1 exercise' }).click();
    await page.getByRole('button', { name: 'Create routine' }).click();
    await expect(page).toHaveURL('/routines');
    await expect.poll(() => savedCache(page, userId)).toContain(name);
    const row = page.getByRole('link', { name: new RegExp(name) });
    const path = await row.getAttribute('href');
    if (path === null) throw new Error('the routine row has no link');

    // The rename lands but its answer is lost, so the device keeps the old name, as when another
    // device renames the routine.
    await row.click();
    const patched = Promise.withResolvers<void>();
    await page.route(`**/api${path}`, async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      await route.fetch();
      await route.abort();
      patched.resolve();
    });
    await page.getByRole('textbox', { name: 'Name' }).fill(renamed);
    await page.getByRole('button', { name: 'Save routine' }).click();
    await patched.promise;
    await page.unrouteAll();
    expect(await savedCache(page, userId)).not.toContain(renamed);

    // On relaunch the editor waits for the list it restored to be asked again.
    const listed = Promise.withResolvers<void>();
    await page.route('**/api/routines', async (route) => {
      await listed.promise;
      await route.continue();
    });
    await page.goto(path);
    await expect(page.getByRole('heading', { name: 'Routine', level: 1 })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Name' })).toHaveCount(0);
    listed.resolve();
    await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue(renamed);
    await page.unrouteAll();

    await page.getByRole('button', { name: 'Delete routine' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page).toHaveURL('/routines');
    await expect(page.getByRole('link', { name: new RegExp(name) })).toHaveCount(0);
  });
});
