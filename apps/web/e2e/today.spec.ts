import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { apiFixture } from './fixture';

type Cookies = Parameters<BrowserContext['addCookies']>[0];

// Today's line under each routine (docs/10 §3): when it was last done, read from History in one
// call, or that it has not been. A user of its own; the workouts are put there through the sync batch.
const EMAIL = 'today-last-done@example.test';
const DAY_MS = 24 * 60 * 60 * 1000;
let userId = '';

test.beforeAll(() => {
  const created: { userId: string } = JSON.parse(apiFixture('user', EMAIL));
  ({ userId } = created);
});

test.afterAll(() => {
  apiFixture('delete', EMAIL);
});

test.beforeEach(async ({ context, page }) => {
  const cookies: Cookies = JSON.parse(apiFixture('cookies', userId, 'localhost'));
  await context.addCookies(cookies);
  const profile = await page.request.patch('/api/me/profile', {
    data: { timezone: 'Asia/Tokyo', weightUnit: 'kg' },
  });
  expect(profile.ok()).toBe(true);
});

/** `Mon 5 Oct`, as Today prints a day in the profile's time zone. */
function dayOf(instant: number) {
  const parts = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Tokyo',
  }).formatToParts(new Date(instant));
  const part = (type: string) => parts.find((each) => each.type === type)?.value;
  return `${part('weekday')} ${part('day')} ${part('month')}`;
}

async function routine(page: Page, name: string, exerciseId: string) {
  const id = randomUUID();
  const made = await page.request.post('/api/routines', {
    data: {
      id,
      name,
      exercises: [{ id: randomUUID(), exerciseId, targetSets: 2, repLow: 6, repHigh: 10 }],
    },
  });
  expect(made.ok()).toBe(true);
  return id;
}

/** One finished workout of one set, started `daysAgo` days ago from `routineId`. */
function finished(name: string, routineId: string, exerciseId: string, daysAgo: number) {
  const startedAt = new Date(Date.now() - daysAgo * DAY_MS).toISOString();
  const endedAt = new Date(Date.parse(startedAt) + 50 * 60 * 1000).toISOString();
  const workoutId = randomUUID();
  const workoutExerciseId = randomUUID();
  return {
    workout: {
      id: workoutId,
      routineId,
      name,
      startedAt,
      endedAt,
      note: null,
      clientUpdatedAt: endedAt,
    },
    exercise: {
      id: workoutExerciseId,
      workoutId,
      exerciseId,
      routineExerciseId: null,
      position: 0,
      targetSets: 1,
      repLow: 6,
      repHigh: 10,
      incrementKg: 2.5,
      clientUpdatedAt: startedAt,
    },
    set: {
      id: randomUUID(),
      workoutExerciseId,
      position: 0,
      weightKg: 60,
      reps: 8,
      rir: null,
      rpe: null,
      isWarmup: false,
      performedAt: startedAt,
      clientUpdatedAt: startedAt,
    },
  };
}

test('each routine says when it was last done, or that it has not been, even past the first page of History', async ({
  page,
}) => {
  const library = await page.request.get('/api/exercises');
  const { items }: { items: { id: string; name: string }[] } = await library.json();
  const bench = items.find((item) => item.name === 'Barbell Bench Press')?.id;
  if (bench === undefined) throw new Error('no bench press');

  const push = await routine(page, 'Push A', bench);
  const pull = await routine(page, 'Pull A', bench);
  const legs = await routine(page, 'Legs A', bench);
  await routine(page, 'Arms A', bench);

  // Push A: 5 days ago. Pull A: 40 days ago, behind 35 newer Legs A workouts, so on the second page
  // of History (30 a page). Arms A never.
  const made = [
    finished('Push A', push, bench, 5),
    ...Array.from({ length: 35 }, (_, index) => finished('Legs A', legs, bench, 1 + index / 10)),
    finished('Pull A', pull, bench, 40),
  ];
  const synced = await page.request.post('/api/workouts/sync', {
    data: {
      workouts: made.map((each) => each.workout),
      workoutExercises: made.map((each) => each.exercise),
      sets: made.map((each) => each.set),
    },
  });
  expect(synced.ok()).toBe(true);

  // History's list pages and the last-done call, as Today asks for them.
  const asked: string[] = [];
  page.on('request', (request) => {
    const { pathname, search } = new URL(request.url());
    if (pathname.startsWith('/api/workouts') && request.method() === 'GET') {
      asked.push(pathname + search);
    }
  });

  await page.goto('/');
  const row = (name: string) =>
    page.getByRole('button', { name: new RegExp(`^${name}.*Start this workout`) });
  await expect(row('Push A')).toContainText(
    `Last done ${dayOf(Date.now() - 5 * DAY_MS)}, 5 days ago`,
  );
  await expect(row('Legs A')).toContainText(/Last done .+, yesterday|Last done .+, today/);
  await expect(row('Pull A')).toContainText(
    `Last done ${dayOf(Date.now() - 40 * DAY_MS)}, 6 weeks ago`,
  );
  await expect(row('Arms A')).toContainText('Not done yet');
  await expect(page.getByText('Not done yet')).toHaveCount(1);
  // One call says it all: Today never pages through History to find a routine.
  expect(asked.filter((path) => path.includes('cursor='))).toEqual([]);
  expect(asked.filter((path) => path === '/api/workouts/last-done')).toHaveLength(1);
});
