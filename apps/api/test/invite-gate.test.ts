import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { invite, rateLimit, user } from '../src/db/schema';
import { ADMIN_EMAIL, useTestApp } from './harness';

// docs/08 §1 and §10: the gate's three refusals, each with its own error, plus the admin
// bootstrap on an empty database (§3). Sign-in goes through Better Auth's real Google ID-token
// path; only Google's own network calls are stubbed.
const t = useTestApp();

const google = (email: string, emailVerified = true) => ({
  sub: `google-${email}`,
  email,
  emailVerified,
});

async function userCount(email: string) {
  return t.db.$count(user, eq(user.email, email));
}

describe('the invite gate', () => {
  it('refuses an email with no invite as not_invited, and creates no user', async () => {
    const res = await t.signInWithGoogle(google('stranger@example.test'));

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'not_invited' });
    expect(await userCount('stranger@example.test')).toBe(0);
  });

  it('refuses a revoked invite as access_revoked', async () => {
    await t.invite('kenji@example.test', { revoked: true });

    const res = await t.signInWithGoogle(google('kenji@example.test'));

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'access_revoked' });
    expect(await userCount('kenji@example.test')).toBe(0);
  });

  it('refuses an unverified Google email as email_unverified, even when invited', async () => {
    await t.invite('unverified@example.test');

    const res = await t.signInWithGoogle(google('unverified@example.test', false));

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'email_unverified' });
    expect(await userCount('unverified@example.test')).toBe(0);
  });

  it('admits an invited email, matching it case-insensitively', async () => {
    await t.invite('mika@example.test');

    const res = await t.signInWithGoogle(google('Mika@Example.test'));

    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('better-auth.session_token=');
  });

  it('refuses a returning user whose invite was revoked since, on their next sign-in', async () => {
    await t.invite('later@example.test');
    expect((await t.signInWithGoogle(google('later@example.test'))).status).toBe(200);

    await t.db
      .update(invite)
      .set({ revokedAt: new Date() })
      .where(eq(invite.email, 'later@example.test'));
    const res = await t.signInWithGoogle(google('later@example.test'));

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'access_revoked' });
  });
});

describe('Better Auth on the snake_case schema', () => {
  // The SQL names come from the Drizzle columns in src/db/auth-schema.ts, which the adapter reaches
  // by their JavaScript keys (docs/06, 2026-09-25). If a column were named in camelCase, or a field
  // were missing, Better Auth would write a column that does not exist and this sign-in would fail.
  it('signs in and writes every row it needs to the snake_case columns', async () => {
    await t.invite('columns@example.test');

    const res = await t.signInWithGoogle(google('columns@example.test'));
    expect(res.status).toBe(200);

    // Raw SQL, so the snake_case names are checked as written, not through the Drizzle columns.
    const users = await t.db.execute<{ id: string; email_verified: boolean }>(
      sql`select id, email_verified, created_at from "user" where email = 'columns@example.test'`,
    );
    const signedIn = users.rows[0];
    expect(signedIn?.email_verified).toBe(true);

    const sessions = await t.db.execute<{ expires_at: Date }>(
      sql`select expires_at, user_agent from session where user_id = ${signedIn?.id}`,
    );
    expect(sessions.rows).toHaveLength(1);
    expect(new Date(sessions.rows[0]!.expires_at).getTime()).toBeGreaterThan(Date.now());

    const accounts = await t.db.execute(
      sql`select provider_id, account_id from account where user_id = ${signedIn?.id}`,
    );
    expect(accounts.rows).toEqual([
      { provider_id: 'google', account_id: 'google-columns@example.test' },
    ]);

    // The rate limiter stores to the database (docs/08 §2): the sign-in left a row in rate_limit.
    expect(await t.db.$count(rateLimit)).toBeGreaterThan(0);
  });

  it('left no camelCase column in Better Auth’s tables', async () => {
    const { rows } = await t.db.execute(sql`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public'
        and table_name in ('user', 'session', 'account', 'verification', 'rate_limit')
        and column_name <> lower(column_name)
    `);
    expect(rows).toEqual([]);
  });
});

describe('the admin bootstrap', () => {
  it('lets ADMIN_EMAIL in on an empty database and writes their invite row once', async () => {
    expect(await t.db.$count(invite)).toBe(0);

    const first = await t.signInWithGoogle(google('Admin@Example.test'));
    expect(first.status).toBe(200);

    const [admin] = await t.db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, ADMIN_EMAIL));
    const invites = await t.db.select().from(invite);
    expect(invites).toHaveLength(1);
    expect(invites[0]).toMatchObject({
      email: ADMIN_EMAIL,
      invitedByUserId: admin?.id,
      revokedAt: null,
    });

    // A second sign-in passes the gate on the row itself and writes nothing new.
    const second = await t.signInWithGoogle(google(ADMIN_EMAIL));
    expect(second.status).toBe(200);
    expect(await t.db.$count(invite)).toBe(1);

    const me = await t.app.request('/api/me', {
      headers: { cookie: second.headers.get('set-cookie')?.split(';')[0] ?? '' },
    });
    expect(await me.json()).toMatchObject({ isAdmin: true });
  });

  it('still refuses everyone else on an empty database', async () => {
    const res = await t.signInWithGoogle(google('someone@example.test'));
    expect(res.status).toBe(403);
    expect(await t.db.$count(invite)).toBe(0);
  });
});
