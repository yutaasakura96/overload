import { expect, test, type BrowserContext } from '@playwright/test';
import { apiFixture } from './fixture';

type Cookies = Parameters<BrowserContext['addCookies']>[0];

const DARK_GROUND = 'rgb(11, 13, 15)';
const LIGHT_GROUND = 'rgb(244, 246, 248)';

function luminance(rgb: string): number {
  const channels = rgb.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [];
  if (channels.length !== 3) throw new Error(`Expected a computed RGB colour, got ${rgb}`);
  const [r = 0, g = 0, b = 0] = channels.map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(theme: Record<string, string>, a: string, b: string): number {
  const [low = 0, high = 0] = [a, b].map((name) => luminance(theme[`--${name}`] ?? '')).sort((x, y) => x - y);
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

test('loaded colour tokens resolve in both themes and meet their contrast rules', async ({ page }) => {
  await page.goto('/sign-in');
  const { dark, light, darkNames, lightNames, outside } = await page.evaluate(() => {
    const descendants = (rules: CSSRuleList): CSSRule[] =>
      Array.from(rules).flatMap((rule) =>
        rule instanceof CSSGroupingRule ? [rule, ...descendants(rule.cssRules)] : [rule],
      );
    const rules = Array.from(document.styleSheets).flatMap((sheet) => descendants(sheet.cssRules));
    const styles = rules.filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule);
    const darkRule = styles.find((rule) => rule.selectorText === ':root');
    const lightRule = styles.find(
      (rule) => rule.selectorText.replaceAll('"', "'") === ":root[data-theme='light']",
    );
    if (darkRule === undefined || lightRule === undefined) throw new Error('Theme rules did not load');

    const names = (rule: CSSStyleRule) =>
      Array.from(rule.style).filter(
        (name) => name.startsWith('--') && CSS.supports('color', rule.style.getPropertyValue(name)),
      );
    const darkNames = names(darkRule);
    const lightNames = names(lightRule);
    const probe = document.createElement('span');
    document.body.append(probe);
    const values = (theme: 'dark' | 'light') => {
      document.documentElement.dataset.theme = theme;
      return Object.fromEntries(darkNames.map((name) => {
        probe.style.color = `var(${name})`;
        return [name, getComputedStyle(probe).color];
      }));
    };
    const dark = values('dark');
    const light = values('light');
    probe.remove();
    const literalColour = /#[0-9a-f]{3,8}\b|\b(?:rgb|hsl|oklch|oklab|lab|lch|color)a?\(/i;
    const nonColours = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer', 'currentcolor', 'transparent']);
    const outside = styles
      .filter((rule) => rule !== darkRule && rule !== lightRule)
      .flatMap((rule) => Array.from(rule.style).map((name) => [rule.selectorText, name, rule.style.getPropertyValue(name)]))
      .filter(([, name, value]) =>
        name !== undefined && value !== undefined &&
        (literalColour.test(value) ||
          (!value.includes('var(') && !nonColours.has(value.toLowerCase()) && CSS.supports('color', value))),
      );
    return { dark, light, darkNames, lightNames, outside };
  });

  expect(darkNames.length).toBeGreaterThan(0);
  expect(lightNames).toEqual(darkNames.filter((name) => name !== '--surface-status-bar'));
  for (const name of darkNames) {
    expect(dark[name], `${name} in dark`).toBeTruthy();
    expect(light[name], `${name} in light`).toBeTruthy();
    if (name !== '--surface-status-bar') expect(light[name], `${name} changes in light`).not.toBe(dark[name]);
  }
  expect(outside).toEqual([]);

  for (const [name, values] of [['dark', dark], ['light', light]] as const) {
    const failing = PAIRS.filter(
      ([tone, surface, ratio]) => contrast(values, tone, `surface-${surface}`) < ratio,
    ).map(
      ([tone, surface, ratio]) =>
        `${name}: ${tone} on surface-${surface}: ${contrast(values, tone, `surface-${surface}`).toFixed(2)} < ${ratio}`,
    );
    expect(failing).toEqual([]);
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
