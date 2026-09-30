import { describe, expect, it } from 'vitest';
import { userProfile } from '../src/db/schema';
import { WEB_ORIGIN, useTestApp } from './harness';

// docs/08 §2 and §10 as scheduled for slice 1 (docs/11 §2): 401 with no session, the cookie and
// the bearer token each accepted only in their own place, and sign-out ending both.
const t = useTestApp();

const memberRoutes = ['/api/me', '/api/exercises'];

describe('a request with no session', () => {
  it.each(memberRoutes)('%s answers 401 unauthenticated as a problem detail', async (path) => {
    const res = await t.app.request(path);

    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const requestId = res.headers.get('x-request-id');
    expect(requestId).toMatch(/^req_/);
    expect(await res.json()).toEqual({
      type: 'urn:overload:problem:unauthenticated',
      title: 'Not signed in',
      status: 401,
      code: 'unauthenticated',
      requestId,
    });
  });

  it('gets 401, not 404, on a path that does not exist, so nothing is revealed', async () => {
    expect((await t.app.request('/api/nothing-here')).status).toBe(401);
  });
});

describe('cookie and bearer', () => {
  it.each(memberRoutes)('%s accepts the session cookie', async (path) => {
    const { cookie } = await t.createSignedInUser('cookie@example.test');
    expect((await t.app.request(path, { headers: { cookie } })).status).toBe(200);
  });

  it.each(memberRoutes)('%s accepts the bearer token from set-auth-token', async (path) => {
    await t.invite('bearer@example.test');
    const signIn = await t.signInWithGoogle({
      sub: 'google-bearer',
      email: 'bearer@example.test',
      emailVerified: true,
    });
    const token = signIn.headers.get('set-auth-token');
    expect(token).toBeTruthy();

    const res = await t.app.request(path, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
  });

  it('refuses the bearer token sent as the cookie: the cookie must carry its signature', async () => {
    const { token } = await t.createSignedInUser('swap1@example.test');

    const res = await t.app.request('/api/me', {
      headers: { cookie: `better-auth.session_token=${token}` },
    });
    expect(res.status).toBe(401);
  });

  it('refuses the Cookie header sent as a bearer token', async () => {
    const { cookie } = await t.createSignedInUser('swap2@example.test');

    const res = await t.app.request('/api/me', { headers: { Authorization: `Bearer ${cookie}` } });
    expect(res.status).toBe(401);
  });

  it('refuses a token signed with another secret', async () => {
    const { token } = await t.createSignedInUser('forged@example.test');

    const res = await t.app.request('/api/me', {
      headers: { Authorization: `Bearer ${token}.bm90LXRoZS1zaWduYXR1cmU` },
    });
    expect(res.status).toBe(401);
  });
});

describe('sign-out', () => {
  it('ends the session for its cookie and its bearer token alike', async () => {
    const { cookie, token } = await t.createSignedInUser('leaving@example.test');
    expect((await t.app.request('/api/me', { headers: { cookie } })).status).toBe(200);

    const signOut = await t.app.request('/api/auth/sign-out', {
      method: 'POST',
      headers: { cookie, Origin: WEB_ORIGIN },
    });
    expect(signOut.status).toBe(200);

    expect((await t.app.request('/api/me', { headers: { cookie } })).status).toBe(401);
    const bearer = await t.app.request('/api/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(bearer.status).toBe(401);
  });
});

describe('GET /api/me', () => {
  it('returns the caller, not the admin, and no profile until one is set up', async () => {
    const { user, cookie } = await t.createSignedInUser('member@example.test');

    const res = await t.app.request('/api/me', { headers: { cookie } });

    expect(await res.json()).toEqual({
      user: { id: user.id, name: user.name, email: 'member@example.test', image: null },
      isAdmin: false,
      profile: null,
    });
  });

  it('returns the profile with numbers as numbers and the birth date as a local date', async () => {
    const { user, cookie } = await t.createSignedInUser('profiled@example.test');
    await t.db.insert(userProfile).values({
      userId: user.id,
      heightCm: 172.5,
      sex: 'female',
      birthDate: '1990-01-01',
      trainingWeekdays: [1, 3, 5],
    });

    const res = await t.app.request('/api/me', { headers: { cookie } });

    expect(await res.json()).toMatchObject({
      profile: {
        timezone: 'Asia/Tokyo',
        heightCm: 172.5,
        sex: 'female',
        birthDate: '1990-01-01',
        trainingWeekdays: [1, 3, 5],
      },
    });
  });
});
