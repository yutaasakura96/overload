import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { auditEvent, invite, routine, session } from '../src/db/schema';
import { InviteList } from '../src/routes/schemas';
import { ADMIN_EMAIL, WEB_ORIGIN, useTestApp } from './harness';

// Invite administration (S9): docs/07 §2, docs/08 §8, and docs/11 §2's slice 6 row. The ingest
// token half of revoke and its two tests arrive with `ingest_token` in M3 (docs/06, 2026-10-15).
const t = useTestApp();

const KENJI = 'kenji@example.test';

const google = (email: string) => ({ sub: `google-${email}`, email, emailVerified: true });

/** A signed-in admin, as the gate's bootstrap leaves them: a user and their own invite row. */
async function signInAdmin() {
  const admin = await t.createSignedInUser(ADMIN_EMAIL);
  await t.invite(ADMIN_EMAIL);
  return admin;
}

/** An invited member signed in through Google twice: once for a cookie, once for a bearer token. */
async function signInMember(email: string) {
  await t.invite(email);
  const first = await t.signInWithGoogle(google(email));
  const second = await t.signInWithGoogle(google(email));
  const cookie = (first.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const token = second.headers.get('set-auth-token') ?? '';
  expect(cookie).toContain('better-auth.session_token=');
  expect(token).not.toBe('');
  return { cookie, token };
}

const send = (cookie: string, method: 'GET' | 'POST', path: string, body?: unknown) =>
  t.app.request(path, {
    method,
    headers: { cookie, 'Content-Type': 'application/json', Origin: WEB_ORIGIN },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const idOf = async (email: string) => {
  const [row] = await t.db.select({ id: invite.id }).from(invite).where(eq(invite.email, email));
  if (row === undefined) throw new Error(`no invite for ${email}`);
  return row.id;
};

describe('who may call the admin routes', () => {
  const routes = [
    ['GET', '/api/admin/invites'],
    ['POST', '/api/admin/invites'],
    ['POST', '/api/admin/invites/0192f3b7-2d0a-7c55-8e1b-5a9f0c3d2e71/revoke'],
    ['POST', '/api/admin/invites/0192f3b7-2d0a-7c55-8e1b-5a9f0c3d2e71/restore'],
  ] as const;

  it.each(routes)('a member calling %s %s gets 404, not 403', async (method, path) => {
    const member = await t.createSignedInUser('member@example.test');

    const res = await send(member.cookie, method, path, method === 'POST' ? {} : undefined);

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'not_found' });
  });

  it('a member with a bearer token gets 404 too', async () => {
    const member = await t.createSignedInUser('member@example.test');

    const res = await t.app.request('/api/admin/invites', {
      headers: { Authorization: `Bearer ${member.token}` },
    });
    expect(res.status).toBe(404);
  });

  it.each(routes)('a visitor calling %s %s gets 401', async (method, path) => {
    const res = await t.app.request(path, { method, headers: { Origin: WEB_ORIGIN } });
    expect(res.status).toBe(401);
  });

  it('the admin is matched on ADMIN_EMAIL whatever its case', async () => {
    const admin = await t.createSignedInUser('Admin@Example.test');

    expect((await send(admin.cookie, 'GET', '/api/admin/invites')).status).toBe(200);
  });
});

describe('listing and adding invites', () => {
  it('lists every invite newest first, with no member data', async () => {
    const admin = await signInAdmin();
    await send(admin.cookie, 'POST', '/api/admin/invites', {
      id: '0192f3b7-2d0a-7c55-8e1b-5a9f0c3d2e71',
      email: 'first@example.test',
    });
    await send(admin.cookie, 'POST', '/api/admin/invites', {
      id: '0192f3b7-2d0a-7c55-8e1b-5a9f0c3d2e72',
      email: 'second@example.test',
      note: 'gym friend',
    });

    const res = await send(admin.cookie, 'GET', '/api/admin/invites');

    expect(res.status).toBe(200);
    const { items } = InviteList.parse(await res.json());
    // Inside one test transaction every row has the same `created_at`, so the ids, made a moment
    // apart, decide the order.
    expect(items.map((item) => item.email).filter((email) => email !== ADMIN_EMAIL)).toEqual([
      'second@example.test',
      'first@example.test',
    ]);
    expect(items).toHaveLength(3);
    expect(Object.keys(items[0] ?? {}).toSorted()).toEqual(
      ['email', 'id', 'invitedAt', 'note', 'revokedAt'].toSorted(),
    );
  });

  it('invites an email lowercased, and the person can then sign in', async () => {
    const admin = await signInAdmin();

    const res = await send(admin.cookie, 'POST', '/api/admin/invites', {
      id: '0192f3b7-2d0a-7c55-8e1b-5a9f0c3d2e71',
      email: 'Kenji@Example.test',
      note: 'gym friend',
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      id: '0192f3b7-2d0a-7c55-8e1b-5a9f0c3d2e71',
      email: KENJI,
      note: 'gym friend',
      revokedAt: null,
    });
    expect((await t.signInWithGoogle(google(KENJI))).status).toBe(200);
  });

  it('answers a repeat of the same invite with the stored one', async () => {
    const admin = await signInAdmin();
    const body = { id: '0192f3b7-2d0a-7c55-8e1b-5a9f0c3d2e71', email: KENJI, note: null };

    const first = await send(admin.cookie, 'POST', '/api/admin/invites', body);
    const again = await send(admin.cookie, 'POST', '/api/admin/invites', body);

    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(await first.json());
  });

  it('refuses an email that already has an invite, revoked or not, as invite_exists', async () => {
    const admin = await signInAdmin();
    await t.invite(KENJI, { revoked: true });

    const res = await send(admin.cookie, 'POST', '/api/admin/invites', {
      id: '0192f3b7-2d0a-7c55-8e1b-5a9f0c3d2e71',
      email: 'KENJI@example.test',
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'invite_exists' });
  });

  it('refuses the same id with another email as id_conflict', async () => {
    const admin = await signInAdmin();
    const id = '0192f3b7-2d0a-7c55-8e1b-5a9f0c3d2e71';
    await send(admin.cookie, 'POST', '/api/admin/invites', { id, email: KENJI });

    const res = await send(admin.cookie, 'POST', '/api/admin/invites', {
      id,
      email: 'other@example.test',
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'id_conflict' });
  });

  it('refuses something that is not an email as validation_failed on email', async () => {
    const admin = await signInAdmin();

    const res = await send(admin.cookie, 'POST', '/api/admin/invites', {
      id: '0192f3b7-2d0a-7c55-8e1b-5a9f0c3d2e71',
      email: 'not an email',
    });

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ errors: [{ path: 'email' }] });
  });
});

describe('revoke', () => {
  it('ends the cookie and the bearer session at once, and keeps the data', async () => {
    const admin = await signInAdmin();
    const member = await signInMember(KENJI);
    const made = await send(member.cookie, 'POST', '/api/routines', {
      id: '0192f3b7-2d0a-7c55-8e1b-5a9f0c3d2e99',
      name: 'Push A',
    });
    expect(made.status).toBe(201);
    expect((await send(member.cookie, 'GET', '/api/me')).status).toBe(200);

    const res = await send(admin.cookie, 'POST', `/api/admin/invites/${await idOf(KENJI)}/revoke`);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      email: KENJI,
      revokedAt: expect.any(String),
    });
    expect((await send(member.cookie, 'GET', '/api/me')).status).toBe(401);
    const bearer = await t.app.request('/api/me', {
      headers: { Authorization: `Bearer ${member.token}` },
    });
    expect(bearer.status).toBe(401);
    // Their data stays; only their access went.
    expect(await t.db.$count(routine)).toBeGreaterThanOrEqual(1);
    expect(await t.db.$count(routine, eq(routine.name, 'Push A'))).toBe(1);
  });

  it('refuses their next sign-in as access_revoked', async () => {
    const admin = await signInAdmin();
    await signInMember(KENJI);

    await send(admin.cookie, 'POST', `/api/admin/invites/${await idOf(KENJI)}/revoke`);

    const res = await t.signInWithGoogle(google(KENJI));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'access_revoked' });
  });

  it('refuses a session minted after revoke on member and admin routes', async () => {
    const admin = await signInAdmin();
    await t.invite(KENJI);
    await send(admin.cookie, 'POST', `/api/admin/invites/${await idOf(KENJI)}/revoke`);
    const member = await t.createSignedInUser('Kenji@Example.test');

    for (const path of ['/api/me', '/api/admin/invites']) {
      const cookie = await send(member.cookie, 'GET', path);
      expect(cookie.status).toBe(401);
      expect(await cookie.json()).toMatchObject({ code: 'unauthenticated' });

      const bearer = await t.app.request(path, {
        headers: { Authorization: `Bearer ${member.token}` },
      });
      expect(bearer.status).toBe(401);
      expect(await bearer.json()).toMatchObject({ code: 'unauthenticated' });
    }
  });

  it('leaves the admin’s and other members’ sessions alone', async () => {
    const admin = await signInAdmin();
    await signInMember(KENJI);
    // A third Google sign-in in a row would meet Better Auth's rate limit.
    await t.invite('mika@example.test');
    const other = await t.createSignedInUser('mika@example.test');

    await send(admin.cookie, 'POST', `/api/admin/invites/${await idOf(KENJI)}/revoke`);

    expect((await send(admin.cookie, 'GET', '/api/me')).status).toBe(200);
    expect((await send(other.cookie, 'GET', '/api/me')).status).toBe(200);
  });

  it('revokes an invite whose person never signed in', async () => {
    const admin = await signInAdmin();
    await t.invite(KENJI);

    const res = await send(admin.cookie, 'POST', `/api/admin/invites/${await idOf(KENJI)}/revoke`);

    expect(res.status).toBe(200);
    expect((await t.signInWithGoogle(google(KENJI))).status).toBe(403);
  });

  it('returns a revoked invite unchanged when revoked again', async () => {
    const admin = await signInAdmin();
    await t.invite(KENJI);
    const path = `/api/admin/invites/${await idOf(KENJI)}/revoke`;

    const first = await (await send(admin.cookie, 'POST', path)).json();
    const again = await send(admin.cookie, 'POST', path);

    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(first);
  });

  it('refuses the admin’s own invite as admin_account, and the admin stays signed in', async () => {
    const admin = await signInAdmin();

    const res = await send(
      admin.cookie,
      'POST',
      `/api/admin/invites/${await idOf(ADMIN_EMAIL)}/revoke`,
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'admin_account' });
    expect((await send(admin.cookie, 'GET', '/api/me')).status).toBe(200);
    const [row] = await t.db.select().from(invite).where(eq(invite.email, ADMIN_EMAIL));
    expect(row?.revokedAt).toBeNull();
  });

  it('answers 404 for an invite that does not exist', async () => {
    const admin = await signInAdmin();

    const res = await send(
      admin.cookie,
      'POST',
      '/api/admin/invites/0192f3b7-2d0a-7c55-8e1b-5a9f0c3d2e71/revoke',
    );
    expect(res.status).toBe(404);
  });
});

describe('restore', () => {
  it('lets the member sign in again, to every row they left', async () => {
    const admin = await signInAdmin();
    const member = await signInMember(KENJI);
    await send(member.cookie, 'POST', '/api/routines', {
      id: '0192f3b7-2d0a-7c55-8e1b-5a9f0c3d2e99',
      name: 'Push A',
    });
    const id = await idOf(KENJI);
    await send(admin.cookie, 'POST', `/api/admin/invites/${id}/revoke`);

    const res = await send(admin.cookie, 'POST', `/api/admin/invites/${id}/restore`);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ email: KENJI, revokedAt: null });
    const signIn = await t.signInWithGoogle(google(KENJI));
    expect(signIn.status).toBe(200);
    const cookie = (signIn.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const routines = await send(cookie, 'GET', '/api/routines');
    expect(await routines.json()).toMatchObject({ items: [{ name: 'Push A' }] });
  });

  it('does not bring back a session the revoke ended', async () => {
    const admin = await signInAdmin();
    const member = await signInMember(KENJI);
    const id = await idOf(KENJI);
    await send(admin.cookie, 'POST', `/api/admin/invites/${id}/revoke`);

    await send(admin.cookie, 'POST', `/api/admin/invites/${id}/restore`);

    expect((await send(member.cookie, 'GET', '/api/me')).status).toBe(401);
    expect(await t.db.$count(session)).toBe(1);
  });

  it('returns an invite that is not revoked unchanged', async () => {
    const admin = await signInAdmin();
    await t.invite(KENJI);

    const res = await send(admin.cookie, 'POST', `/api/admin/invites/${await idOf(KENJI)}/restore`);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ email: KENJI, revokedAt: null });
  });

  it('answers 404 for an invite that does not exist', async () => {
    const admin = await signInAdmin();

    const res = await send(
      admin.cookie,
      'POST',
      '/api/admin/invites/0192f3b7-2d0a-7c55-8e1b-5a9f0c3d2e71/restore',
    );
    expect(res.status).toBe(404);
  });
});

describe('the audit trail', () => {
  it('records invite, revoke and restore by the admin, with ids and never the email', async () => {
    const admin = await signInAdmin();
    await send(admin.cookie, 'POST', '/api/admin/invites', {
      id: '0192f3b7-2d0a-7c55-8e1b-5a9f0c3d2e71',
      email: KENJI,
    });
    expect((await t.signInWithGoogle(google(KENJI))).status).toBe(200);
    const id = await idOf(KENJI);
    await send(admin.cookie, 'POST', `/api/admin/invites/${id}/revoke`);
    await send(admin.cookie, 'POST', `/api/admin/invites/${id}/revoke`);
    await send(admin.cookie, 'POST', `/api/admin/invites/${id}/restore`);

    const rows = await t.db
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.actorUserId, admin.user.id))
      .orderBy(auditEvent.occurredAt, auditEvent.id);

    expect(rows.map((row) => [row.action, row.targetType])).toEqual([
      ['invite_created', 'invite'],
      ['access_revoked', 'user'],
      ['access_restored', 'user'],
    ]);
    expect(rows[0]?.targetId).toBe(id);
    expect(rows[1]?.targetId).toEqual(expect.any(String));
    expect(JSON.stringify(rows)).not.toContain('kenji');
  });
});
