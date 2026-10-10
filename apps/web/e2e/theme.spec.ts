import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type BrowserContext } from '@playwright/test';
import { apiFixture } from './fixture';

type Cookies = Parameters<BrowserContext['addCookies']>[0];

// The light theme beside the dark one (docs/05 §1.7): the tokens themselves, then the choice in the
// profile section, which is the device's and is in place before the first paint.
const css = readFileSync(fileURLToPath(new URL('../src/styles.css', import.meta.url)), 'utf8');
const DARK_GROUND = 'rgb(11, 13, 15)';
const LIGHT_GROUND = 'rgb(244, 246, 248)';

const colour = /#[0-9a-f]{3,8}\b|\b(?:rgb|hsl|oklch|oklab|lab|lch|color)a?\(/gi;

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  const end = css.indexOf('}', start);
  if (start === -1 || end === -1) throw new Error(`${selector} is missing from styles.css`);
  return css.slice(start, end);
}

function tokens(body: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const [, name, value] of body.matchAll(/(--[a-z-]+):\s*([^;]+);/g)) {
    if (name !== undefined && value !== undefined && value.match(colour)) found.set(name, value);
  }
  return found;
}

const BLOCKS = [':root', ":root[data-theme='light']"] as const;
const dark = tokens(block(BLOCKS[0]));
const light = tokens(block(BLOCKS[1]));

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((at) => {
    const channel = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast of two tokens in one theme. */
function contrast(theme: Map<string, string>, a: string, b: string): number {
  const [low = 0, high = 0] = [a, b]
    .map((name) => luminance(theme.get(`--${name}`) ?? ''))
    .toSorted((x, y) => x - y);
  return (high + 0.05) / (low + 0.05);
}

// docs/05 §1.5: what each tone is allowed to sit on, and the ratio it owes there.
const TEXT = ['text-primary', 'text-secondary', 'text-tertiary'];
const SURFACES = ['ground', 'raised', 'active', 'accent', 'done', 'flag', 'error'];
const PAIRS: readonly (readonly [tone: string, surface: string, ratio: number])[] = [
  ...TEXT.flatMap((tone) => SURFACES.map((surface) => [tone, surface, 4.5] as const)),
  ...['ground', 'raised', 'active', 'flag', 'error'].map(
    (surface) => ['text-quaternary', surface, 4.5] as const,
  ),
  ['text-placeholder', 'ground', 3],
  ['text-placeholder', 'active', 3],
  ...['accent', 'accent-pressed'].flatMap((tone) =>
    ['ground', 'raised', 'active', 'accent'].map((surface) => [tone, surface, 4.5] as const),
  ),
  ['done', 'ground', 4.5],
  ['done', 'done', 4.5],
  ['flag', 'ground', 4.5],
  ['flag', 'flag', 4.5],
  ['flag-dim', 'ground', 4.5],
  ['flag-dim', 'flag', 4.5],
  ['error', 'ground', 4.5],
  ['error', 'error', 4.5],
  ['error', 'flag', 4.5],
  ['line-control', 'ground', 3],
  ['line-control', 'active', 3],
];

test.describe('the tokens', () => {
  test('the light theme gives every themed colour token a value, and adds none', () => {
    // surface/status-bar is the one colour that is the same in both themes.
    const themed = [...dark.keys()].filter((name) => name !== '--surface-status-bar');
    expect([...light.keys()]).toEqual(themed);
  });

  test('no colour is written outside the two token blocks', () => {
    const outside = BLOCKS.reduce((rest, selector) => rest.replace(block(selector), ''), css);
    expect(outside.match(colour)).toBeNull();
  });

  for (const [name, theme] of [
    ['dark', dark],
    ['light', light],
  ] as const) {
    test(`text and controls meet WCAG AA on their surfaces in the ${name} theme`, () => {
      const failing = PAIRS.filter(
        ([tone, surface, ratio]) => contrast(theme, tone, `surface-${surface}`) < ratio,
      ).map(
        ([tone, surface, ratio]) =>
          `${tone} on surface-${surface}: ${contrast(theme, tone, `surface-${surface}`).toFixed(2)} < ${ratio}`,
      );
      expect(failing).toEqual([]);
    });
  }
});

const ground = (page: import('@playwright/test').Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const barColour = (page: import('@playwright/test').Page) =>
  page.locator('meta[name="theme-color"]').getAttribute('content');

test.describe('on a device set to light', () => {
  test.use({ colorScheme: 'light' });

  test('the app opens light without a choice', async ({ page }) => {
    await page.goto('/sign-in');
    await expect(page.getByRole('button', { name: /google/i })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await ground(page)).toBe(LIGHT_GROUND);
    expect(await barColour(page)).toBe('#F4F6F8');
  });
});

test.describe('on a device set to dark', () => {
  test.use({ colorScheme: 'dark' });

  const userId = process.env.E2E_USER_ID ?? '';

  test('the app opens dark without a choice', async ({ page }) => {
    await page.goto('/sign-in');
    await expect(page.getByRole('button', { name: /google/i })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await ground(page)).toBe(DARK_GROUND);
    expect(await barColour(page)).toBe('#0B0D0F');
  });

  test('a theme chosen in the profile section applies at once, is remembered, and is in place before the first paint', async ({
    context,
    page,
  }) => {
    if (userId === '') throw new Error('global setup did not create the test user');
    const cookies: Cookies = JSON.parse(apiFixture('cookies', userId, 'localhost'));
    await context.addCookies(cookies);
    // What <html> says when <body> is first parsed: after the script in <head>, before the app's.
    await page.addInitScript(() => {
      new MutationObserver((_, observer) => {
        if (document.body === null) return;
        sessionStorage.setItem('theme-at-body', document.documentElement.dataset.theme ?? 'none');
        observer.disconnect();
      }).observe(document, { childList: true, subtree: true });
    });
    const atBody = () => page.evaluate(() => sessionStorage.getItem('theme-at-body'));

    await page.goto('/');
    const theme = page.getByRole('group', { name: 'Theme' });
    await expect(theme.getByRole('radio', { name: 'System' })).toBeChecked();
    expect(await atBody()).toBe('dark');

    await theme.getByRole('radio', { name: 'Light' }).check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await ground(page)).toBe(LIGHT_GROUND);
    expect(await barColour(page)).toBe('#F4F6F8');

    await page.reload();
    await expect(theme.getByRole('radio', { name: 'Light' })).toBeChecked();
    expect(await atBody()).toBe('light');
    expect(await ground(page)).toBe(LIGHT_GROUND);

    // Back to the device's setting, which is then followed as it changes.
    await theme.getByRole('radio', { name: 'System' }).check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await ground(page)).toBe(DARK_GROUND);
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('a remembered choice wins over the device, and the sign-in screen follows it', async ({
    context,
    page,
  }) => {
    // The choice is the device's, not an account's: nobody is signed in here.
    await context.addInitScript(() => localStorage.setItem('overload:theme', 'light'));
    await page.goto('/sign-in');
    await expect(page.getByRole('button', { name: /google/i })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await ground(page)).toBe(LIGHT_GROUND);
  });
});
