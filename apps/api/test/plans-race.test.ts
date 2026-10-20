import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { localDateIn } from '../src/db/training';
import { goalPhase } from '../src/db/schema';
import { sender } from './account-fixture';
import { useTestApp } from './harness';

// A generation waiting on another for the user's plan lock (S16). A rolled-back test transaction
// would run them one after the other on one connection, so this file commits, on several
// connections, and deletes its users after each test.
const t = useTestApp({ committed: true });

const per100 = (energyKcal: number, proteinG: number, carbG: number, fatG: number) => ({
  basis: { kind: 'per_100g', grams: 100 },
  energyKcal,
  proteinG,
  carbG,
  fatG,
  fiberG: 0,
});

describe('two generations at once', () => {
  it('makes the waiting generation read the inputs as they are once it holds the lock', async () => {
    const { cookie, user } = await t.createSignedInUser(`race-${randomUUID()}@example.test`);
    const send = sender(t, cookie);
    const today = localDateIn('Asia/Tokyo')(new Date());
    expect(
      (
        await send('PATCH', '/api/me/profile', {
          timezone: 'Asia/Tokyo',
          heightCm: 176,
          sex: 'male',
          birthDate: '1995-03-08',
          trainingWeekdays: [1, 2, 3, 4, 5, 6, 7],
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await send('POST', '/api/weigh-ins', {
          id: randomUUID(),
          measuredAt: new Date(Date.now() - 60_000).toISOString(),
          weightKg: 82.4,
        })
      ).status,
    ).toBe(201);
    for (const food of [
      { name: 'Chicken breast', state: 'raw', ...per100(105, 23.3, 0.1, 1.9) },
      { name: 'Rice, cooked', state: 'cooked', ...per100(156, 2.5, 37.1, 0.3) },
      { name: 'Olive oil', state: 'raw', ...per100(894, 0, 0, 100) },
    ]) {
      const res = await send('POST', '/api/foods', { id: randomUUID(), source: 'manual', ...food });
      expect(res.status).toBe(201);
    }
    const phaseId = randomUUID();
    expect(
      (
        await send('POST', '/api/goal-phases', {
          id: phaseId,
          type: 'cut',
          startedOn: today,
          targetRatePctPerWeek: 0.5,
          proteinGPerKg: 2.2,
          fatPctCalories: 25,
          calorieTargetKcal: 2350,
          calorieBasis: 'manual',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await send('PUT', '/api/day-routines/training', {
          wakeTime: '06:30',
          workStart: null,
          workEnd: null,
          trainingTime: '18:30',
          bedTime: '23:00',
          slots: [
            { time: '07:00', label: 'Breakfast' },
            { time: '12:00', label: 'Lunch' },
            { time: '16:30', label: 'Before training' },
            { time: '19:45', label: 'After training' },
          ],
        })
      ).status,
    ).toBe(200);

    // Another generation holds the lock; this one starts, then the phase changes while it waits.
    const released = Promise.withResolvers<void>();
    const lockTaken = Promise.withResolvers<void>();
    const holder = t.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext('plan_day'), hashtext(${user.id}))`,
      );
      lockTaken.resolve();
      await released.promise;
    });
    await lockTaken.promise;
    const generating = send('POST', '/api/plan-days/generate', { from: today, to: today });
    await expect
      .poll(async () => {
        const { rows } = await t.db.execute<{ waiting: number }>(
          sql`SELECT count(*)::int AS waiting FROM pg_locks
              WHERE locktype = 'advisory' AND NOT granted
                AND objid::bigint = (hashtext(${user.id})::bigint & 4294967295)`,
        );
        return rows[0]?.waiting;
      })
      .toBe(1);
    await t.db
      .update(goalPhase)
      .set({ calorieTargetKcal: 2000, calorieTargetSetAt: new Date() })
      .where(eq(goalPhase.id, phaseId));
    released.resolve();
    await holder;

    const res = await generating;
    expect(res.status).toBe(200);
    const body: { days: { date: string; targets: { energyKcal: number } }[] } = await res.json();
    expect(body.days.find((day) => day.date === today)?.targets.energyKcal).toBe(2000);
  });
});
