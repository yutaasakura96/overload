import {
  ACCOUNT_HEADER,
  type BalanceView,
  type DayType,
  type DayRoutine,
  type GoalPhaseType,
  type Me,
  type Span,
  type StrengthSpan,
} from '@overload/api-contract';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import {
  QueryClient,
  infiniteQueryOptions,
  queryOptions,
  type FetchStatus,
} from '@tanstack/react-query';
import {
  persistQueryClientRestore,
  persistQueryClientSubscribe,
  type PersistedClient,
  type Persister,
} from '@tanstack/react-query-persist-client';
import { useState, useSyncExternalStore } from 'react';
import { api, ApiError, isUnauthenticated, unwrap } from './api';
import { deviceStore } from './device-store';
import { dropCandidate } from './food';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long cached data is kept to render offline with its age (docs/03 §6), in memory and in
 * IndexedDB alike. It must stay under setTimeout's 2^31 − 1 ms (about 24.8 days): above it the
 * garbage-collection timer fires at once and every restored query is dropped on launch.
 */
export const CACHE_MAX_AGE_MS = 7 * DAY_MS;

/** How long an account check with a saved copy waits before opening offline on that copy. */
const ACCOUNT_CHECK_MS = 3000;

class AccountCheckFailed extends Error {
  constructor(cause: unknown) {
    super('Account check failed', { cause });
    this.name = 'AccountCheckFailed';
  }
}

// A 401 means the session has ended; retrying cannot change that (docs/08 §5).
const retries = (failureCount: number, error: unknown) =>
  !isUnauthenticated(error) && !(error instanceof AccountCheckFailed) && failureCount < 2;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { gcTime: CACHE_MAX_AGE_MS, staleTime: 60 * 1000, retry: retries },
  },
});

// Each account's copy of the cache is saved under its own key, and only one account's copy is ever
// open: the one /api/me confirms, or offline the last one it confirmed on this device (docs/08 §5).
// The account gate keeps cached data with its confirmed owner; see docs/08 §5 and §7 for limits.

type Account = {
  /** Whose copy the cache holds: the remembered user from launch, then whoever /api/me confirms. */
  userId: string | undefined;
  /**
   * `checking` until /api/me answers this launch; `confirmed` once it names `userId`;
   * `unconfirmed` when it failed and the saved copy opens as offline.
   */
  status: 'checking' | 'confirmed' | 'unconfirmed';
};

let account: Account = { userId: undefined, status: 'checking' };
let accountGeneration = 0;
let accountClosed = false;
let pendingRemember: Promise<unknown> | undefined;
const listeners = new Set<() => void>();

function setAccount(next: Account) {
  account = next;
  for (const listener of listeners) listener();
}

function subscribeAccount(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function useAccount(): Account {
  return useSyncExternalStore(subscribeAccount, () => account);
}

/** The account as it stands, and a way to hear it change, for code outside React (the uploader). */
export const currentAccount = () => account;
export const onAccountChange = subscribeAccount;

const ME_KEY = ['me'];
const ownerOf = (client: PersistedClient) => {
  const me = client.clientState.queries.find((query) => query.queryKey[0] === 'me');
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- meQuery caches a Me
  return (me?.state.data as Me | undefined)?.user.id;
};

/** The persister for one account's copy. It reads and writes that account's data only. */
function accountPersister(userId: string, generation = accountGeneration): Persister {
  const persister = createAsyncStoragePersister({
    storage: {
      ...deviceStore.queryCache,
      // Checked when the throttled write lands, so nothing is written once the account is closed.
      setItem: async (key, value) => {
        if (
          generation === accountGeneration &&
          account.status === 'confirmed' &&
          account.userId === userId
        ) {
          await deviceStore.queryCache.setItem(key, value);
        }
      },
    },
    key: `user:${userId}`,
  });
  return {
    ...persister,
    persistClient: (client) =>
      ownerOf(client) === userId ? persister.persistClient(client) : undefined,
    restoreClient: async () => {
      if (deviceStore.wipePending()) return undefined;
      const client = await persister.restoreClient();
      return !deviceStore.wipePending() &&
        generation === accountGeneration &&
        client !== undefined &&
        ownerOf(client) === userId
        ? client
        : undefined;
    },
  };
}

let stopPersisting: (() => void) | undefined;

/**
 * The saved copy can predate the last write, since the persister saves at most once a second, so
 * each launch asks again for what it restored once the account is confirmed.
 */
async function restore(userId: string, generation = accountGeneration) {
  await persistQueryClientRestore({
    queryClient,
    persister: accountPersister(userId, generation),
    maxAge: CACHE_MAX_AGE_MS,
  }).catch(() => undefined);
  await queryClient.invalidateQueries({
    predicate: (query) => query.queryKey[0] !== 'me',
    refetchType: 'none',
  });
}

// Other tabs of the app on this device: when one of them changes account or signs out, this tab
// drops what it holds and opens again as the new account.
const tabs = typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel('overload');
// oxlint-disable-next-line unicorn/require-post-message-target-origin -- a BroadcastChannel, not a window
const announceTo = (userId: string | null) => tabs?.postMessage({ userId });
tabs?.addEventListener('message', (event: MessageEvent<{ userId: string | null }>) => {
  if (event.data.userId === account.userId) return;
  const previousRemember = closeAccount();
  queryClient.clear();
  if (event.data.userId !== null) {
    window.location.reload();
    return;
  }
  void Promise.resolve(previousRemember)
    .catch(() => undefined)
    .then(async () => {
      await deviceStore.wipe().catch(() => undefined);
      window.location.reload();
    });
});

/** Stops saving and forgets whose copy is open. */
export function closeAccount() {
  dropCandidate();
  accountClosed = true;
  accountGeneration += 1;
  stopPersisting?.();
  stopPersisting = undefined;
  setAccount({ userId: undefined, status: 'checking' });
  return pendingRemember;
}

export function announceSignOut() {
  announceTo(null);
}

const SIGNING_IN = 'overload:signing-in';

/** Marks a sign-in in progress, so the launch it returns to does not open the previous copy. */
export function markSigningIn() {
  try {
    sessionStorage.setItem(SIGNING_IN, '1');
  } catch {
    // Private mode can refuse it; that launch then treats the saved copy as usual.
  }
}

export function takeSigningIn() {
  try {
    const marked = sessionStorage.getItem(SIGNING_IN) !== null;
    sessionStorage.removeItem(SIGNING_IN);
    return marked;
  } catch {
    return false;
  }
}

/**
 * Before the first render: loads the remembered user's saved copy, which renders only once /api/me
 * confirms them or fails (see App). A launch back from sign-in loads nothing, since the account may
 * have changed.
 */
export async function openCache() {
  if (deviceStore.wipePending()) {
    await deviceStore.wipe().catch(() => undefined);
    if (deviceStore.wipePending()) return;
  }
  // Discard the old shared copy; it may contain data from more than one account (docs/06, 2026-09-27).
  await deviceStore.queryCache.removeItem('overload').catch(() => undefined);
  const remembered = await deviceStore.signedInUser().catch(() => undefined);
  if (takeSigningIn() || remembered === undefined) return;
  setAccount({ userId: remembered.id, status: 'checking' });
  await restore(remembered.id);
}

/** /api/me named this user: open their copy, dropping any other account's data from memory first. */
async function confirm(me: Me, generation: number) {
  if (generation !== accountGeneration) throw new AccountCheckFailed('Account closed');
  const { id } = me.user;
  const switched = account.userId !== id;
  if (switched) {
    dropCandidate();
    stopPersisting?.();
    stopPersisting = undefined;
    setAccount({ userId: id, status: 'confirmed' });
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'me' });
    queryClient.setQueryData(ME_KEY, me);
    await restore(id, generation);
  } else if (account.status !== 'confirmed') {
    setAccount({ userId: id, status: 'confirmed' });
  }
  if (generation !== accountGeneration) throw new AccountCheckFailed('Account closed');
  stopPersisting ??= persistQueryClientSubscribe({ queryClient, persister: accountPersister(id) });
  const remembering = deviceStore.rememberUser(me.user);
  pendingRemember = remembering;
  try {
    await remembering;
  } finally {
    if (pendingRemember === remembering) pendingRemember = undefined;
  }
  if (generation !== accountGeneration) throw new AccountCheckFailed('Account closed');
  if (switched) announceTo(id);
}

export const meQuery = queryOptions({
  queryKey: ME_KEY,
  // Asked at every launch, focus and reconnect, however fresh: it is the account check. Nothing
  // renders until the first one answers or fails; a later one runs behind the open account's screen.
  // `always`, since staleness is read off the device's clock: a saved copy stamped later than the
  // clock now says (the clock was set back) never goes stale, and the launch would wait on a check
  // that is never made.
  staleTime: 0,
  refetchOnMount: 'always',
  refetchOnWindowFocus: 'always',
  refetchOnReconnect: 'always',
  queryFn: async () => {
    if (accountClosed) throw new AccountCheckFailed('Account closed');
    const generation = ++accountGeneration;
    stopPersisting?.();
    stopPersisting = undefined;
    if (account.status === 'confirmed') setAccount({ ...account, status: 'checking' });
    // With a saved copy to fall back on, the check waits 3 s for one answer, then opens offline.
    const bounded = account.userId !== undefined && queryClient.getQueryData(ME_KEY) !== undefined;
    let me: Me;
    try {
      me = unwrap(
        await api.GET('/api/me', bounded ? { signal: AbortSignal.timeout(ACCOUNT_CHECK_MS) } : {}),
      );
    } catch (error) {
      if (generation !== accountGeneration) throw new AccountCheckFailed('Account closed');
      if (!bounded || error instanceof ApiError) throw error;
      setAccount({ ...account, status: 'unconfirmed' });
      throw new AccountCheckFailed(error);
    }
    await confirm(me, generation);
    return me;
  },
});

/**
 * Runs one account's request: only under a confirmed account, and its answer is dropped if the
 * account changed while it was in flight (docs/08 §5).
 */
export async function forAccount<T>(request: () => Promise<T>): Promise<T> {
  const generation = accountGeneration;
  if (account.status !== 'confirmed') throw new AccountCheckFailed('Account unconfirmed');
  const result = await request();
  if (generation !== accountGeneration || account.status !== 'confirmed') {
    throw new AccountCheckFailed('Account changed');
  }
  return result;
}

/**
 * One account's answer from a member route, kept only when it is the confirmed account's: the API
 * names whose session answered, so an answer made under another account's cookie (a retry after the
 * cookie changed) never reaches this account's copy. It is refused and not retried; the next /api/me
 * check, at focus or reconnect, opens the account the cookie now holds (docs/08 §5).
 */
export async function confirmedAccountData<T>(
  request: () => Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<NonNullable<T>> {
  const { userId } = account;
  if (userId === undefined) throw new AccountCheckFailed('Account unconfirmed');
  const result = await forAccount(request);
  const data = unwrap(result);
  if (result.response.headers.get(ACCOUNT_HEADER) === userId) return data;
  throw new AccountCheckFailed('Answered for another account');
}

/** One account's data: enable it only once /api/me has confirmed the account (`useAccount`). */
export const exercisesQuery = queryOptions({
  queryKey: ['exercises'],
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  queryFn: async ({ signal }) =>
    (await confirmedAccountData(() => api.GET('/api/exercises', { signal }))).items,
});

/**
 * The library with the caller's hidden exercises included: a routine may still name one, and the
 * library lists them to show again.
 */
export const allExercisesQuery = queryOptions({
  queryKey: ['exercises', 'all'],
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  queryFn: async ({ signal }) =>
    (
      await confirmedAccountData(() =>
        api.GET('/api/exercises', { params: { query: { includeHidden: 'true' } }, signal }),
      )
    ).items,
});

export const routinesQuery = queryOptions({
  queryKey: ['routines'],
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  queryFn: async ({ signal }) =>
    (await confirmedAccountData(() => api.GET('/api/routines', { signal }))).items,
});

/**
 * Last time and today's suggestion for every exercise the user has logged, in one call so the gym
 * screen has them with no signal (docs/07 §3). Asked again after every acknowledged sync batch.
 * Enable it only once the profile exists: without one the API answers `setup_incomplete`.
 */
export const lastTimeQuery = queryOptions({
  queryKey: ['last-time'],
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  queryFn: async ({ signal }) =>
    (await confirmedAccountData(() => api.GET('/api/training/last-time', { signal }))).exercises,
});

/**
 * Last time as the open workout reads it: from the workout before it, never its own synced sets.
 * Asked again after a weigh-in, which moves the bodyweight counted on it (issue #69). Read in the
 * zone the workout started in, so a profile change while it is open moves nothing (issue #60).
 */
export const openLastTimeQuery = (workoutId: string, timeZone: string) =>
  queryOptions({
    queryKey: ['last-time', workoutId, timeZone],
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) =>
      (
        await confirmedAccountData(() =>
          api.GET('/api/training/last-time', {
            params: { query: { exclude: workoutId, timezone: timeZone } },
            signal,
          }),
        )
      ).exercises,
  });

/**
 * One exercise's chart over a span (S7, docs/07 §3). Enable it only once the profile exists:
 * without one the API answers `setup_incomplete`.
 */
export const progressQuery = (exerciseId: string, span: Span) =>
  queryOptions({
    queryKey: ['progress', exerciseId, span],
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) =>
      confirmedAccountData(() =>
        api.GET('/api/exercises/{id}/progress', {
          params: { path: { id: exerciseId }, query: { span } },
          signal,
        }),
      ),
  });

/**
 * The strength overview over a span (docs/07 §3): every lift's points, trend and status. Enable it
 * only once the profile exists: without one the API answers `setup_incomplete`.
 */
export const strengthQuery = (span: StrengthSpan) =>
  queryOptions({
    queryKey: ['strength', span],
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) =>
      confirmedAccountData(() =>
        api.GET('/api/training/strength', { params: { query: { span } }, signal }),
      ),
  });

/**
 * Muscle balance over a view (docs/07 §3): every muscle group's sets a week, its status and its
 * sources. Enable it only once the profile exists: without one the API answers `setup_incomplete`.
 */
export const balanceQuery = (view: BalanceView) =>
  queryOptions({
    queryKey: ['balance', view],
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) =>
      confirmedAccountData(() =>
        api.GET('/api/training/balance', { params: { query: { view } }, signal }),
      ),
  });

/**
 * Every weigh-in, with the daily weights and the trend (S11, docs/07 §5). Enable it only once the
 * profile exists: without one the API answers `setup_incomplete`.
 */
export const weighInsQuery = queryOptions({
  queryKey: ['weigh-ins'],
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  queryFn: async ({ signal }) => confirmedAccountData(() => api.GET('/api/weigh-ins', { signal })),
});

/**
 * The food list (S12, docs/07 §4), archived foods included: one food's page still opens for a food
 * past plans name. The list screen leaves archived ones out.
 */
export const foodsQuery = queryOptions({
  queryKey: ['foods'],
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  queryFn: async ({ signal }) =>
    (
      await confirmedAccountData(() =>
        api.GET('/api/foods', { params: { query: { includeArchived: 'true' } }, signal }),
      )
    ).items,
});

/** The rotation groups with their foods (S12). */
export const rotationGroupsQuery = queryOptions({
  queryKey: ['rotation-groups'],
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  queryFn: async ({ signal }) =>
    (await confirmedAccountData(() => api.GET('/api/rotation-groups', { signal }))).items,
});

/** Every goal phase, newest first; the open one has no end (S14, docs/07 §4). */
export const goalPhasesQuery = queryOptions({
  queryKey: ['plan', 'phases'],
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  queryFn: async ({ signal }) =>
    (await confirmedAccountData(() => api.GET('/api/goal-phases', { signal }))).items,
});

/**
 * A new phase's defaults, each with its source, and the provisional calories for a rate (S14).
 * Enable it only once the profile and a weigh-in exist: before, the API answers `setup_incomplete`.
 */
export const phaseDefaultsQuery = (type: GoalPhaseType, targetRatePctPerWeek?: number) =>
  queryOptions({
    queryKey: ['plan', 'defaults', type, targetRatePctPerWeek ?? null],
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) =>
      confirmedAccountData(() =>
        api.GET('/api/goal-phases/defaults', {
          params: {
            query: targetRatePctPerWeek === undefined ? { type } : { type, targetRatePctPerWeek },
          },
          signal,
        }),
      ),
  });

/** Both day types the user has set, with their meals (S15). */
export const dayRoutinesQuery = queryOptions({
  queryKey: ['plan', 'routines'],
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  queryFn: async ({ signal }) =>
    (await confirmedAccountData(() => api.GET('/api/day-routines', { signal }))).items,
});

/** The recommended meal count and times for a day as typed, so far unsaved (S15). */
export const mealRecommendationQuery = (
  dayType: DayType,
  day: { wakeTime: string; bedTime: string; trainingTime?: string; mealCount?: number },
) =>
  queryOptions({
    queryKey: ['plan', 'recommendation', dayType, day],
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) =>
      confirmedAccountData(() =>
        api.GET('/api/day-routines/{dayType}/recommendation', {
          params: { path: { dayType }, query: day },
          signal,
        }),
      ),
  });

/** The targets in force today and where they came from (docs/07 §4). */
export const currentTargetsQuery = queryOptions({
  queryKey: ['plan', 'targets'],
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  queryFn: async ({ signal }) =>
    confirmedAccountData(() => api.GET('/api/targets/current', { signal })),
});

/** The plan days of a range of local dates (S16). Read-only: dates without a plan are `missing`. */
export const planDaysQuery = (from: string, to: string) =>
  queryOptions({
    queryKey: ['plan', 'days', from, to],
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) =>
      confirmedAccountData(() =>
        api.GET('/api/plan-days', { params: { query: { from, to } }, signal }),
      ),
  });

/** Every batch, newest cook day first, each with its yield (S13). */
export const batchesQuery = queryOptions({
  queryKey: ['batches'],
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  queryFn: async ({ signal }) =>
    (await confirmedAccountData(() => api.GET('/api/batches', { signal }))).items,
});

/** A week's prep plan and grocery list, derived from its plan days (S17). */
export const prepPlanQuery = (weekStart: string) =>
  queryOptions({
    queryKey: ['plan', 'prep', weekStart],
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) =>
      confirmedAccountData(() =>
        api.GET('/api/prep-plan', { params: { query: { weekStart } }, signal }),
      ),
  });

/** The Monday of the week a local date is in. */
export const weekStartOf = (date: string) =>
  addLocalDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));

/**
 * Makes the plan from today to the end of next week again after its inputs changed: the food list,
 * a batch, the phase, the routine or the profile (docs/07 §4, Plan days), so the prep plan for the
 * coming week reads the same inputs as Today. Days with a confirmed meal are left by the server.
 * Until setup is complete the server answers `setup_incomplete`, which is nothing to report.
 */
export async function regeneratePlan(): Promise<void> {
  const profile = queryClient.getQueryData<Me>(ME_KEY)?.profile;
  if (profile == null) return;
  const from = activePlanDay(
    profile.timezone,
    profile.trainingWeekdays,
    queryClient.getQueryData<DayRoutine[]>(dayRoutinesQuery.queryKey) ?? [],
  );
  try {
    await forAccount(async () =>
      unwrap(
        await api.POST('/api/plan-days/generate', {
          body: { from, to: addLocalDays(weekStartOf(from), 13) },
        }),
      ),
    );
  } catch (error) {
    if (!(error instanceof ApiError && error.code === 'setup_incomplete')) throw error;
  } finally {
    await queryClient.invalidateQueries({ queryKey: ['plan'] });
  }
}

/** Today's local date in `timeZone`, as the plan reads it. */
export const planToday = (timeZone: string, now = Date.now()) =>
  new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).format(new Date(now));

export function activePlanDay(
  timeZone: string,
  trainingWeekdays: number[],
  routines: Pick<DayRoutine, 'dayType' | 'wakeTime'>[],
  now = Date.now(),
) {
  const date = planToday(timeZone, now);
  const weekday = ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
  const dayType = trainingWeekdays.includes(weekday) ? 'training' : 'rest';
  const wake = routines.find((routine) => routine.dayType === dayType)?.wakeTime;
  if (wake === undefined) return date;
  const clock = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(new Date(now));
  return clock < wake ? addLocalDays(date, -1) : date;
}

export const addLocalDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** The MEXT table searched (S12): the same words answer the same, so a search is kept a while. */
export const referenceFoodsQuery = (q: string) =>
  queryOptions({
    queryKey: ['reference-foods', q],
    gcTime: 5 * 60 * 1000,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) =>
      (
        await confirmedAccountData(() =>
          api.GET('/api/reference-foods', { params: { query: { q } }, signal }),
        )
      ).items,
  });

/**
 * History (docs/07 §3): the finished workouts, newest first, a page at a time. A workout the
 * device still holds rows of is read from the set store over this (history.ts).
 */
export const workoutsQuery = infiniteQueryOptions({
  queryKey: ['workouts', 'list'],
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  initialPageParam: undefined as string | undefined,
  queryFn: async ({ pageParam, signal }) =>
    confirmedAccountData(() =>
      api.GET('/api/workouts', {
        params: { query: pageParam === undefined ? {} : { cursor: pageParam } },
        signal,
      }),
    ),
  getNextPageParam: (last) => last.nextCursor ?? undefined,
});

/**
 * When each routine was last done (docs/07 §3), in one call, so Today need not read History page by
 * page. Under `workouts`, so it is asked again with History.
 */
export const lastDoneQuery = queryOptions({
  queryKey: ['workouts', 'last-done'],
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  queryFn: async ({ signal }) =>
    (await confirmedAccountData(() => api.GET('/api/workouts/last-done', { signal }))).items,
});

/** The admin's invite list (S9). A member is never sent here: the screen opens for the admin only. */
export const invitesQuery = queryOptions({
  queryKey: ['invites'],
  queryFn: async ({ signal }) =>
    (await confirmedAccountData(() => api.GET('/api/admin/invites', { signal }))).items,
});

/** One workout whole, every row as the sync batch holds it (docs/07 §3). */
export const workoutQuery = (id: string) =>
  queryOptions({
    queryKey: ['workouts', 'one', id],
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    // A workout that is not the account's stays that way: asking again cannot change a 404.
    retry: (failureCount, error) =>
      !(error instanceof ApiError && error.status === 404) && retries(failureCount, error),
    queryFn: async ({ signal }) =>
      confirmedAccountData(() =>
        api.GET('/api/workouts/{id}', { params: { path: { id } }, signal }),
      ),
  });

/**
 * Whether an editor may open on this query's copy: not while a stale copy, such as the one restored
 * at launch, is being asked again, so its draft starts from the server's state. Offline (paused) or
 * after a failed ask it opens on the saved copy. Once open it stays open: its own saves refetch.
 */
export function useOpensEditor({
  isStale,
  fetchStatus,
}: {
  isStale: boolean;
  fetchStatus: FetchStatus;
}) {
  const [opened, setOpened] = useState(false);
  const opens = opened || !(isStale && fetchStatus === 'fetching');
  if (opens && !opened) setOpened(true);
  return opens;
}

/**
 * After a write: both exercise lists, since a setting or a new exercise changes each, and the
 * balance view, which reads an exercise's muscle groups.
 */
export const refreshExercises = () =>
  queryClient.invalidateQueries({
    predicate: (query) => query.queryKey[0] === 'exercises' || query.queryKey[0] === 'balance',
  });
export const refreshRoutines = () => queryClient.invalidateQueries({ queryKey: ['routines'] });
export const refreshInvites = () => queryClient.invalidateQueries({ queryKey: ['invites'] });
/**
 * After a weigh-in is typed or deleted: the daily weights and the trend move with it, and so does
 * the weight a bodyweight lift is counted at on a chart or the strength overview (issue #69).
 */
export const refreshWeighIns = () =>
  queryClient.invalidateQueries({
    predicate: (query) =>
      query.queryKey[0] === 'weigh-ins' ||
      // The phase's defaults and the targets are set at the trend weight.
      query.queryKey[0] === 'plan' ||
      query.queryKey[0] === 'progress' ||
      query.queryKey[0] === 'strength' ||
      query.queryKey[0] === 'last-time',
  });
/**
 * After a batch is recorded: the batches, the food list that names them, and the plan, made again
 * so days not yet confirmed use the new yield (S13).
 */
export const refreshBatches = async () => {
  await queryClient.invalidateQueries({
    predicate: (query) => query.queryKey[0] === 'batches' || query.queryKey[0] === 'foods',
  });
  await regeneratePlan();
};

/**
 * After a food or a group is saved, archived or deleted: both lists, since a food names its group
 * and a group its foods, and any search, which marks the foods already on the list. The week's plan
 * is made again from the list as it now is before the save is reported complete.
 */
export const refreshFoods = async () => {
  await queryClient.invalidateQueries({
    predicate: (query) =>
      query.queryKey[0] === 'foods' ||
      query.queryKey[0] === 'rotation-groups' ||
      query.queryKey[0] === 'reference-foods',
  });
  await regeneratePlan();
};
/**
 * After an acknowledged sync batch: a chart on screen is asked again, the rest when next opened.
 * The strength overview and the balance view read the same sets, so they go with them.
 */
export const refreshProgress = () =>
  queryClient.invalidateQueries({
    predicate: (query) =>
      query.queryKey[0] === 'progress' ||
      query.queryKey[0] === 'strength' ||
      query.queryKey[0] === 'balance',
  });
/** The same for History: the list, when each routine was last done, and each workout read whole. */
export const refreshHistory = () => queryClient.invalidateQueries({ queryKey: ['workouts'] });

/**
 * Asks for last time again whether or not a screen is reading it, since the next workout starts
 * from this copy (S2). An ask already on its way may have been answered before the change this one
 * follows, so it is dropped and made again. Without a profile there is nothing to ask
 * (`setup_incomplete`). It never rejects: a failed ask leaves the copy as it was.
 */
export async function refreshLastTime(): Promise<void> {
  if (queryClient.getQueryData<Me>(ME_KEY)?.profile == null) return;
  await queryClient.cancelQueries({ queryKey: lastTimeQuery.queryKey, exact: true });
  await queryClient.fetchQuery({ ...lastTimeQuery, staleTime: 0 }).catch(() => undefined);
}

/** The unit weights are shown and typed in (docs/06, 2026-09-23). Kilograms until a profile says. */
export const currentWeightUnit = () =>
  queryClient.getQueryData<Me>(ME_KEY)?.profile?.weightUnit ?? 'kg';

/**
 * After the profile is saved: /api/me carries it, so the cached answer takes the new one. The
 * weigh-ins' days and trend are counted in its time zone, so a changed zone refetches them.
 */
export function setProfile(profile: NonNullable<Me['profile']>) {
  const zoneChanged = queryClient.getQueryData<Me>(ME_KEY)?.profile?.timezone !== profile.timezone;
  queryClient.setQueryData<Me>(ME_KEY, (me) => (me === undefined ? me : { ...me, profile }));
  // Height, sex, birth date and training days move the defaults; the day boundary moves the plan.
  void queryClient.invalidateQueries({ queryKey: ['plan'] });
  if (zoneChanged) void refreshWeighIns();
}
