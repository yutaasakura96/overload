import type { WorkoutDetail, WorkoutList, WorkoutSummary } from '@overload/api-contract';
import type { InfiniteData } from '@tanstack/react-query';
import { queryClient, workoutQuery, workoutsQuery } from './query';
import type { SetRecord, StoreRecord, WorkoutRecord } from './set-store';
import { exercisesOf, setsOf } from './workout';

// History as the device sees it (docs/03 §6). The server's answer is the history; a workout the
// set store still holds rows of is read from those rows over it: one just finished whose upload is
// on its way, or a past one with a set changed here and not yet acknowledged. So an edit, a delete
// and a finish show at once, with or without signal, and stay through a reload.

/** A workout the device has ended, or one put back to be changed: history, not the one in progress. */
const isPast = (record: StoreRecord): record is WorkoutRecord =>
  record.table === 'workouts' && record.row.endedAt !== null;

/** Whether the device has deleted this workout and the server has not yet answered. */
export const removedOnDevice = (records: StoreRecord[], workoutId: string) =>
  records.some(
    (record) =>
      record.table === 'workouts' && record.id === workoutId && record.deletedAt !== undefined,
  );

/** One workout whole from the device's rows, or `undefined` when it holds none of it. */
export function workoutOnDevice(
  records: StoreRecord[],
  workoutId: string,
): WorkoutDetail | undefined {
  const workout = records.find(
    (record): record is WorkoutRecord => record.table === 'workouts' && record.id === workoutId,
  );
  if (workout === undefined || workout.deletedAt !== undefined) return undefined;
  return {
    ...workout.row,
    exercises: exercisesOf(records, workoutId).map((exercise) => ({
      ...exercise.row,
      name: exercise.local.name,
      sets: setsOf(records, exercise.id).map((set) => set.row),
    })),
  };
}

/** The sets of a workout that are not warm-ups: the only ones counted (S6). */
export const workingSets = (sets: SetRecord['row'][]) => sets.filter((set) => !set.isWarmup);

/**
 * The list's line for a workout the device holds, in the server's own terms (docs/07 §3): its
 * working sets counted, and each exercise's top set, the heaviest with the most reps done at it.
 * The server says the same of the same rows once they are uploaded.
 */
function summaryOf(workout: WorkoutDetail, endedAt: string): WorkoutSummary {
  return {
    id: workout.id,
    name: workout.name,
    startedAt: workout.startedAt,
    endedAt,
    workingSets: workout.exercises.reduce((sum, each) => sum + workingSets(each.sets).length, 0),
    exercises: workout.exercises.flatMap((exercise) => {
      const working = workingSets(exercise.sets);
      if (working.length === 0) return [];
      const topSetKg = Math.max(...working.map((set) => set.weightKg));
      const topSetReps = Math.max(
        ...working.filter((set) => set.weightKg === topSetKg).map((set) => set.reps),
      );
      return [{ name: exercise.name, topSetKg, topSetReps }];
    }),
  };
}

const newestFirst = (a: WorkoutSummary, b: WorkoutSummary) =>
  a.startedAt === b.startedAt ? (a.id < b.id ? 1 : -1) : a.startedAt < b.startedAt ? 1 : -1;

/**
 * The server's list with the device's rows laid over it. A workout the device deleted is left out;
 * one it holds is listed as its rows have it, in the place its start gives it. One the server has
 * not been told has ended, a finish still to upload, is counted on top of the server's total.
 */
export function historyOnDevice(
  server: { items: WorkoutSummary[]; total: number; more: boolean },
  records: StoreRecord[],
): { items: WorkoutSummary[]; total: number } {
  let { items, total } = server;
  for (const workout of records.filter(isPast)) {
    const listed = items.some((item) => item.id === workout.id);
    const view = workoutOnDevice(records, workout.id);
    if (view === undefined || workout.row.endedAt === null) {
      items = items.filter((item) => item.id !== workout.id);
      if (listed) total -= 1;
      continue;
    }
    const summary = summaryOf(view, workout.row.endedAt);
    if (listed) {
      items = items.map((item) => (item.id === workout.id ? summary : item));
      continue;
    }
    const unsent = workout.state !== 'acknowledged';
    const oldest = items.at(-1);
    // One older than every page loaded has its place on a page still to come.
    if (server.more && oldest !== undefined && newestFirst(oldest, summary) < 0) continue;
    if (unsent) total += 1;
    items = [...items, summary];
  }
  return { items: items.toSorted(newestFirst), total };
}

type Pages = InfiniteData<WorkoutList, string | undefined>;

/**
 * Writes what the device holds of its past workouts into the cached history, before an upload's
 * answer lets those rows go: the screens read the cache from then on, and it must already say what
 * the rows said. The server is asked again afterwards (`refreshHistory`), and its answer replaces
 * this.
 */
export function keepHistory(records: StoreRecord[]) {
  for (const workout of records.filter(isPast)) {
    const view = workoutOnDevice(records, workout.id);
    const { queryKey } = workoutQuery(workout.id);
    if (view === undefined) queryClient.removeQueries({ queryKey });
    else queryClient.setQueryData(queryKey, view);
  }
  queryClient.setQueryData<Pages>(workoutsQuery.queryKey, (cached) => {
    const [first, ...rest] = cached?.pages ?? [];
    if (cached === undefined || first === undefined) return cached;
    const more = cached.pages.at(-1)?.nextCursor != null;
    const server = { items: cached.pages.flatMap((page) => page.items), total: first.total, more };
    const { items, total } = historyOnDevice(server, records);
    // The first page takes what is new, and each page keeps the rest of its own.
    const ids = new Set(server.items.map((item) => item.id));
    const kept = new Map(items.map((item) => [item.id, item]));
    const fresh = items.filter((item) => !ids.has(item.id));
    const pageOf = (page: WorkoutList, added: WorkoutSummary[]): WorkoutList => ({
      ...page,
      total,
      items: [...added, ...page.items.flatMap((item) => kept.get(item.id) ?? [])],
    });
    return { ...cached, pages: [pageOf(first, fresh), ...rest.map((page) => pageOf(page, []))] };
  });
}
