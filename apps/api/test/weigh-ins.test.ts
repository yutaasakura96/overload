import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { bodyMeasurement } from '../src/db/schema';
import { sender } from './account-fixture';
import { useTestApp } from './harness';

// S11's routes (docs/07 §5, issue #76): a typed weigh-in, safe to retry; the read with its daily
// weights and trend in the profile's time zone; deleting a typed one but not one from Apple Health;
// and every route's cross-user case (docs/08 §10).
const t = useTestApp();

type WeighIn = {
  id: string;
  measuredAt: string;
  weightKg: number;
  bodyFatPct: number | null;
  source: string;
};
type Day = {
  date: string;
  weighInId: string;
  weightKg: number;
  morning: boolean;
  trendKg: number | null;
};
type Section = {
  weighIns: WeighIn[];
  days: Day[];
  trendAvailable: boolean;
  weekChangeKg: number | null;
};

async function member(email: string, timezone: string | null = 'Asia/Tokyo') {
  const { cookie, user } = await t.createSignedInUser(email);
  const send = sender(t, cookie);
  // No profile is the setup_incomplete case; every other member has one in this time zone.
  const saved =
    timezone === null ? 200 : (await send('PATCH', '/api/me/profile', { timezone })).status;
  expect(saved).toBe(200);
  return { cookie, user, send };
}

const typed = (measuredAt: string, weightKg: number, bodyFatPct?: number | null) => ({
  id: randomUUID(),
  measuredAt,
  weightKg,
  ...(bodyFatPct === undefined ? {} : { bodyFatPct }),
});

async function section(send: ReturnType<typeof sender>, query = '') {
  const res = await send('GET', `/api/weigh-ins${query}`);
  expect(res.status).toBe(200);
  const body: Section = await res.json();
  return body;
}

describe('POST /api/weigh-ins', () => {
  it('saves a typed weigh-in under the device’s id, and a repeat returns the stored row', async () => {
    const { send, user } = await member('typed@example.test');
    const body = typed('2026-10-15T22:40:00.000Z', 82.4, 18.5);

    const first = await send('POST', '/api/weigh-ins', body);
    expect(first.status).toBe(201);
    const created: WeighIn = await first.json();
    expect(created).toEqual({ ...body, source: 'manual' });

    const again = await send('POST', '/api/weigh-ins', body);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(created);

    const rows = await t.db
      .select()
      .from(bodyMeasurement)
      .where(eq(bodyMeasurement.userId, user.id));
    expect(rows).toHaveLength(1);
  });

  it('defaults body fat to none', async () => {
    const { send } = await member('nofat@example.test');
    const res = await send('POST', '/api/weigh-ins', typed('2026-10-15T22:40:00.000Z', 82.4));
    expect(res.status).toBe(201);
    expect((await res.json()).bodyFatPct).toBeNull();
  });

  it('refuses the same id with other content as a conflict', async () => {
    const { send } = await member('reuse@example.test');
    const body = typed('2026-10-15T22:40:00.000Z', 82.4);
    expect((await send('POST', '/api/weigh-ins', body)).status).toBe(201);
    const res = await send('POST', '/api/weigh-ins', { ...body, weightKg: 82.6 });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('id_conflict');
  });

  it('refuses a second typed weigh-in at the same instant', async () => {
    const { send } = await member('twice@example.test');
    expect(
      (await send('POST', '/api/weigh-ins', typed('2026-10-15T22:40:00.000Z', 82.4))).status,
    ).toBe(201);
    const res = await send('POST', '/api/weigh-ins', typed('2026-10-15T22:40:00.000Z', 82.6));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('weigh_in_exists');
  });

  it.each([
    ['too light', { weightKg: 19.99 }, 'weightKg'],
    ['too heavy', { weightKg: 300.01 }, 'weightKg'],
    ['past the hundredth', { weightKg: 82.123 }, 'weightKg'],
    ['body fat out of range', { bodyFatPct: 80 }, 'bodyFatPct'],
    ['no instant', { measuredAt: 'yesterday' }, 'measuredAt'],
    ['no id', { id: 'nope' }, 'id'],
  ])('refuses a weigh-in %s, naming the field and not the value', async (_name, change, path) => {
    const { send } = await member(`bad-${path}-${String(Object.values(change)[0])}@example.test`);
    const res = await send('POST', '/api/weigh-ins', {
      ...typed('2026-10-15T22:40:00.000Z', 82.4),
      ...change,
    });
    expect(res.status).toBe(422);
    const problem = await res.json();
    expect(problem.code).toBe('validation_failed');
    expect(problem.errors.map((e: { path: string }) => e.path)).toEqual([path]);
    // The request id is random hex, so it is left out of the search.
    const { requestId: _requestId, ...told } = problem;
    expect(JSON.stringify(told)).not.toContain(String(Object.values(change)[0]));
  });

  it('answers 401 without a session', async () => {
    const res = await t.app.request('/api/weigh-ins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
      body: JSON.stringify(typed('2026-10-15T22:40:00.000Z', 82.4)),
    });
    expect(res.status).toBe(401);
  });

  it('refuses another user’s id as a conflict and leaves their row as it was', async () => {
    const owner = await member('owner-w@example.test');
    const body = typed('2026-10-15T22:40:00.000Z', 82.4);
    expect((await owner.send('POST', '/api/weigh-ins', body)).status).toBe(201);

    const other = await member('other-w@example.test');
    const res = await other.send('POST', '/api/weigh-ins', { ...body, weightKg: 60 });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('id_conflict');
    expect((await section(owner.send)).weighIns).toEqual([
      { ...body, bodyFatPct: null, source: 'manual' },
    ]);
    expect((await section(other.send)).weighIns).toEqual([]);
  });
});

describe('GET /api/weigh-ins', () => {
  it('derives the day’s weight in the profile’s time zone, flagging a day with no morning reading', async () => {
    const { send } = await member('days@example.test');
    const morning = typed('2026-10-14T22:10:00.000Z', 82.4); // 07:10 on the 15th in Tokyo
    const later = typed('2026-10-15T01:30:00.000Z', 83.0); // 10:30 on the 15th
    const afternoon = typed('2026-10-16T06:00:00.000Z', 82.9); // 15:00 on the 16th
    for (const body of [later, morning, afternoon]) {
      expect((await send('POST', '/api/weigh-ins', body)).status).toBe(201);
    }

    const read = await section(send, '?from=2026-10-15&to=2026-10-16');
    expect(read.weighIns.map((w) => w.id)).toEqual([afternoon.id, later.id, morning.id]);
    expect(read.days).toEqual([
      {
        date: '2026-10-16',
        weighInId: afternoon.id,
        weightKg: 82.9,
        morning: false,
        trendKg: null,
      },
      { date: '2026-10-15', weighInId: morning.id, weightKg: 82.4, morning: true, trendKg: null },
    ]);
    expect(read.trendAvailable).toBe(false);
    expect(read.weekChangeKg).toBeNull();

    // The same instants in New York fall on other days and other hours.
    expect((await send('PATCH', '/api/me/profile', { timezone: 'America/New_York' })).status).toBe(
      200,
    );
    const elsewhere = await section(send, '?from=2026-10-14&to=2026-10-16');
    expect(elsewhere.days.map((d) => [d.date, d.morning])).toEqual([
      ['2026-10-16', true],
      ['2026-10-14', false],
    ]);
  });

  it('trends from the third weighed day', async () => {
    const { send } = await member('trend@example.test');
    for (const [day, kg] of [
      ['01', 80],
      ['02', 90],
      ['03', 90],
    ] as const) {
      const res = await send('POST', '/api/weigh-ins', typed(`2026-10-${day}T22:00:00.000Z`, kg));
      expect(res.status).toBe(201);
    }
    const read = await section(send, '?to=2026-10-04');
    expect(read.trendAvailable).toBe(true);
    expect(read.days.map((d) => d.trendKg)).toEqual([81.9, 81, 80]);
  });

  it('answers setup_incomplete without a profile', async () => {
    const { send } = await member('noprofile@example.test', null);
    const res = await send('GET', '/api/weigh-ins');
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual(
      expect.objectContaining({ code: 'setup_incomplete', missing: ['profile'] }),
    );
  });

  it.each(['?from=2026-10-5', '?to=tomorrow', '?from=2026-10-10&to=2026-10-09'])(
    'refuses %s as a bad request',
    async (query) => {
      const { send } = await member('range@example.test');
      const res = await send('GET', `/api/weigh-ins${query}`);
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('bad_request');
    },
  );

  it('answers 401 without a session', async () => {
    expect((await t.app.request('/api/weigh-ins')).status).toBe(401);
  });

  it('carries none of another user’s weigh-ins', async () => {
    const owner = await member('mine-w@example.test');
    expect(
      (await owner.send('POST', '/api/weigh-ins', typed('2026-10-15T22:40:00.000Z', 82.4))).status,
    ).toBe(201);
    const other = await member('theirs-w@example.test');
    expect(await section(other.send)).toEqual({
      weighIns: [],
      days: [],
      trendAvailable: false,
      weekChangeKg: null,
    });
  });
});

describe('DELETE /api/weigh-ins/{id}', () => {
  it('deletes a typed weigh-in, and again answers 204', async () => {
    const { send } = await member('delete-w@example.test');
    const body = typed('2026-10-15T22:40:00.000Z', 82.4);
    expect((await send('POST', '/api/weigh-ins', body)).status).toBe(201);

    expect((await send('DELETE', `/api/weigh-ins/${body.id}`)).status).toBe(204);
    expect((await section(send)).weighIns).toEqual([]);
    expect((await send('DELETE', `/api/weigh-ins/${body.id}`)).status).toBe(204);
  });

  it('refuses one from Apple Health with managed_by_apple_health and keeps it', async () => {
    const { send, user } = await member('health-w@example.test');
    const [row] = await t.db
      .insert(bodyMeasurement)
      .values({
        userId: user.id,
        measuredAt: new Date('2026-10-15T22:41:00.000Z'),
        weightKg: 71.6,
        source: 'apple_health',
      })
      .returning({ id: bodyMeasurement.id });
    if (row === undefined) throw new Error('insert returned no row');

    const res = await send('DELETE', `/api/weigh-ins/${row.id}`);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('managed_by_apple_health');
    expect((await section(send)).weighIns).toEqual([
      expect.objectContaining({ id: row.id, source: 'apple_health' }),
    ]);
  });

  it('answers 204 for another user’s weigh-in and leaves it in place', async () => {
    const owner = await member('keep-w@example.test');
    const body = typed('2026-10-15T22:40:00.000Z', 82.4);
    expect((await owner.send('POST', '/api/weigh-ins', body)).status).toBe(201);

    const other = await member('try-w@example.test');
    expect((await other.send('DELETE', `/api/weigh-ins/${body.id}`)).status).toBe(204);
    expect((await section(owner.send)).weighIns.map((w) => w.id)).toEqual([body.id]);
  });

  it('answers 400 for a malformed id and 401 without a session', async () => {
    const { send } = await member('malformed-w@example.test');
    expect((await send('DELETE', '/api/weigh-ins/nope')).status).toBe(400);
    expect(
      (
        await t.app.request(`/api/weigh-ins/${randomUUID()}`, {
          method: 'DELETE',
          headers: { Origin: 'http://localhost:5173' },
        })
      ).status,
    ).toBe(401);
  });
});
