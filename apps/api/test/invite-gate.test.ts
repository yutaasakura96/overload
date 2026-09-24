import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
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
  const row = await t.db
    .selectFrom('user')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('email', '=', email)
    .executeTakeFirstOrThrow();
  return Number(row.n);
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
      .updateTable('invite')
      .set({ revokedAt: new Date() })
      .where('email', '=', 'later@example.test')
      .execute();
    const res = await t.signInWithGoogle(google('later@example.test'));

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'access_revoked' });
  });
});

describe('Better Auth on the snake_case schema', () => {
  // `casing: 'snake'` is a no-op in Better Auth 1.7.5; the names come from snake-case-schema.ts
  // (docs/06, 2026-09-24). If a mapping were missing, Better Auth would write a camelCase column
  // that does not exist and this sign-in would fail.
  it('signs in and writes every row it needs to the snake_case columns', async () => {
    await t.invite('columns@example.test');

    const res = await t.signInWithGoogle(google('columns@example.test'));
    expect(res.status).toBe(200);

    const user = await t.db
      .selectFrom('user')
      .select(['id', 'emailVerified', 'createdAt'])
      .where('email', '=', 'columns@example.test')
      .executeTakeFirstOrThrow();
    expect(user.emailVerified).toBe(true);

    const session = await t.db
      .selectFrom('session')
      .select(['expiresAt', 'userAgent'])
      .where('userId', '=', user.id)
      .executeTakeFirstOrThrow();
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const account = await t.db
      .selectFrom('account')
      .select(['providerId', 'accountId'])
      .where('userId', '=', user.id)
      .executeTakeFirstOrThrow();
    expect(account).toEqual({ providerId: 'google', accountId: 'google-columns@example.test' });

    // The rate limiter stores to the database (docs/08 §2): the sign-in left a row in rate_limit.
    const limited = await sql<{ n: string }>`select count(*) as n from rate_limit`.execute(t.db);
    expect(Number(limited.rows[0]?.n)).toBeGreaterThan(0);
  });

  it('left no camelCase column in Better Auth’s tables', async () => {
    const { rows } = await sql<{ table_name: string; column_name: string }>`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public'
        and table_name in ('user', 'session', 'account', 'verification', 'rate_limit')
        and column_name <> lower(column_name)
    `.execute(t.db);
    expect(rows).toEqual([]);
  });
});

describe('the admin bootstrap', () => {
  it('lets ADMIN_EMAIL in on an empty database and writes their invite row once', async () => {
    const before = await t.db.selectFrom('invite').select('id').execute();
    expect(before).toEqual([]);

    const first = await t.signInWithGoogle(google('Admin@Example.test'));
    expect(first.status).toBe(200);

    const admin = await t.db
      .selectFrom('user')
      .select('id')
      .where('email', '=', ADMIN_EMAIL)
      .executeTakeFirstOrThrow();
    const invites = await t.db.selectFrom('invite').selectAll().execute();
    expect(invites).toHaveLength(1);
    expect(invites[0]).toMatchObject({
      email: ADMIN_EMAIL,
      invitedByUserId: admin.id,
      revokedAt: null,
    });

    // A second sign-in passes the gate on the row itself and writes nothing new.
    const second = await t.signInWithGoogle(google(ADMIN_EMAIL));
    expect(second.status).toBe(200);
    expect(await t.db.selectFrom('invite').select('id').execute()).toHaveLength(1);

    const me = await t.app.request('/api/me', {
      headers: { cookie: second.headers.get('set-cookie')?.split(';')[0] ?? '' },
    });
    expect(await me.json()).toMatchObject({ isAdmin: true });
  });

  it('still refuses everyone else on an empty database', async () => {
    const res = await t.signInWithGoogle(google('someone@example.test'));
    expect(res.status).toBe(403);
    expect(await t.db.selectFrom('invite').select('id').execute()).toEqual([]);
  });
});
