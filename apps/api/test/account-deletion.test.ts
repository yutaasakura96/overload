import { sql, type SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { fillAccount, sender } from './account-fixture';
import { ADMIN_EMAIL, useTestApp } from './harness';

// Account deletion (S10, docs/08 §6) through Better Auth's `POST /api/auth/delete-user`: refused on
// a stale session and for the admin, and otherwise no row of the user's left anywhere but
// `audit_event`. The deferred foreign keys are checked at commit, which a rolled-back test never
// reaches, so `SET CONSTRAINTS ALL IMMEDIATE` fires them before the assertions (docs/11 §1).
const t = useTestApp();

const DAY_MS = 24 * 60 * 60 * 1000;

const deleteUser = (cookie: string) => sender(t, cookie)('POST', '/api/auth/delete-user', {});

/** Every row naming the user, by table, in each table with a user id column. */
async function rowsNaming(userId: string) {
  const { rows: columns } = await t.db.execute<{ table_name: string; column_name: string }>(sql`
    SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND (column_name = 'user_id' OR column_name LIKE '%\\_user\\_id')
  `);
  const found: Record<string, number> = {};
  for (const { table_name: table, column_name: column } of columns) {
    const n = await count(
      sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE ${sql.identifier(column)} = ${userId}`,
    );
    if (n > 0) found[`${table}.${column}`] = n;
  }
  return found;
}

async function count(query: SQL) {
  const { rows } = await t.db.execute<{ n: number }>(query);
  return rows[0]?.n ?? 0;
}

describe('POST /api/auth/delete-user', () => {
  it('deletes every row of the account, custom exercise in a routine and a workout included', async () => {
    const email = 'leaving@example.test';
    await t.invite(email);
    const { cookie, user } = await t.createSignedInUser(email);
    const made = await fillAccount(t, cookie);
    expect(Object.keys(await rowsNaming(user.id)).length).toBeGreaterThan(5);

    const res = await deleteUser(cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message: 'User deleted' });
    // The deferred references to the custom exercise are checked here, as a commit would.
    await t.db.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);

    expect(await rowsNaming(user.id)).toEqual({ 'audit_event.actor_user_id': 1 });
    expect(
      await count(sql`
        SELECT count(*)::int AS n FROM audit_event
         WHERE actor_user_id = ${user.id} AND action = 'account_deleted' AND target_id = ${user.id}
      `),
    ).toBe(1);
    expect(await count(sql`SELECT count(*)::int AS n FROM "user" WHERE id = ${user.id}`)).toBe(0);
    expect(await count(sql`SELECT count(*)::int AS n FROM invite WHERE email = ${email}`)).toBe(0);
    // The children carry no user id of their own.
    expect(
      await count(sql`SELECT count(*)::int AS n FROM exercise WHERE id = ${made.customId}`),
    ).toBe(0);
    expect(
      await count(sql`
        SELECT count(*)::int AS n FROM routine_exercise
         WHERE routine_id = ${made.routineId} OR exercise_id = ${made.customId}
      `),
    ).toBe(0);
    expect(
      await count(sql`
        SELECT count(*)::int AS n FROM workout_exercise
         WHERE workout_id IN (${made.finished.workout.id}, ${made.open.workout.id})
            OR exercise_id = ${made.customId}
      `),
    ).toBe(0);
    expect(
      await count(sql`
        SELECT count(*)::int AS n FROM "set" WHERE id IN (${sql.join(
          [...made.finished.sets, ...made.open.sets].map((each) => sql`${each.id}`),
          sql`, `,
        )})
      `),
    ).toBe(0);

    // The session is gone with it.
    expect((await t.app.request('/api/me', { headers: { cookie } })).status).toBe(401);
  });

  it('leaves another user’s rows alone', async () => {
    const leaving = await t.createSignedInUser('gone@example.test');
    const staying = await t.createSignedInUser('stays@example.test');
    await fillAccount(t, staying.cookie);
    const before = await rowsNaming(staying.user.id);

    expect((await deleteUser(leaving.cookie)).status).toBe(200);
    await t.db.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);

    expect(await rowsNaming(staying.user.id)).toEqual(before);
    expect((await t.app.request('/api/me', { headers: { cookie: staying.cookie } })).status).toBe(
      200,
    );
  });

  it('refuses a session older than a day, and deletes nothing', async () => {
    const { cookie, user } = await t.createSignedInUser('stale@example.test');
    await fillAccount(t, cookie);
    const before = await rowsNaming(user.id);
    const stale = new Date(Date.now() - 2 * DAY_MS).toISOString();
    await t.db.execute(sql`UPDATE session SET created_at = ${stale} WHERE user_id = ${user.id}`);

    const res = await deleteUser(cookie);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('SESSION_EXPIRED');
    expect(await rowsNaming(user.id)).toEqual(before);
  });

  it('refuses the admin while ADMIN_EMAIL names them, in Better Auth’s format', async () => {
    await t.invite(ADMIN_EMAIL);
    const { cookie, user } = await t.createSignedInUser(ADMIN_EMAIL);
    const before = await rowsNaming(user.id);

    const res = await deleteUser(cookie);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      code: 'admin_account',
      message: 'The admin account cannot be deleted while ADMIN_EMAIL names it.',
    });
    expect(await rowsNaming(user.id)).toEqual(before);
    expect(
      await count(sql`SELECT count(*)::int AS n FROM invite WHERE email = ${ADMIN_EMAIL}`),
    ).toBe(1);
  });

  it('answers 401 without a session', async () => {
    expect((await deleteUser('')).status).toBe(401);
  });
});
