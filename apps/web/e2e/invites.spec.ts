import { expect, test } from '@playwright/test';
import { apiFixture } from './fixture';

type Cookies = Parameters<import('@playwright/test').BrowserContext['addCookies']>[0];

// S9 end to end (docs/09 F6): the admin adds, revokes and restores an invite, and a member is
// shown the not-found screen at the same address. Both projects run at once, so each invites its
// own email and removes it afterwards.
const adminId = process.env.E2E_ADMIN_ID ?? '';
const memberId = process.env.E2E_USER_ID ?? '';

const signIn = async (context: import('@playwright/test').BrowserContext, userId: string) => {
  if (userId === '') throw new Error('global setup did not create the test users');
  const cookies: Cookies = JSON.parse(apiFixture('cookies', userId, 'localhost'));
  await context.addCookies(cookies);
};

test('the admin invites an email, revokes it and restores it', async ({
  context,
  page,
}, testInfo) => {
  const email = `invitee-${testInfo.project.name}-${Date.now()}@example.test`;
  await signIn(context, adminId);
  try {
    await page.goto('/');
    await page.getByRole('link', { name: 'Invites' }).click();
    await expect(page.getByRole('heading', { name: 'Invites', level: 1 })).toBeVisible();

    await page.getByRole('textbox', { name: 'Google email' }).fill(email.toUpperCase());
    await page.getByRole('textbox', { name: 'Note' }).fill('gym friend');
    await page.getByRole('button', { name: 'Add invite' }).click();
    await expect(page.getByText(`${email} can sign in now.`)).toBeVisible();
    const row = page.getByRole('listitem').filter({ hasText: email });
    await expect(row).toContainText('gym friend');

    await page.getByRole('textbox', { name: 'Google email' }).fill(email);
    await page.getByRole('button', { name: 'Add invite' }).click();
    await expect(page.getByRole('textbox', { name: 'Google email' })).toHaveAccessibleDescription(
      /Already invited/,
    );

    await row.getByRole('button', { name: `Revoke ${email}` }).click();
    await expect(row.getByRole('group')).toContainText(`Revoke ${email}?`);
    await row.getByRole('button', { name: 'Revoke' }).click();
    await expect(row).toContainText('Revoked');
    await expect(row.getByRole('button', { name: 'Restore' })).toBeFocused();

    await row.getByRole('button', { name: 'Restore' }).click();
    await expect(row.getByRole('button', { name: 'Revoke' })).toBeFocused();
    await expect(row).not.toContainText('Revoked');
  } finally {
    apiFixture('uninvite', email);
  }
});

test('a member opening the invite list gets the not-found screen', async ({ context, page }) => {
  await signIn(context, memberId);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Invites' })).toHaveCount(0);

  await page.goto('/admin/invites');
  await expect(page.getByRole('heading', { name: 'Not found', level: 1 })).toBeVisible();
  await expect(page.getByText('@example.test')).toHaveCount(0);
});
