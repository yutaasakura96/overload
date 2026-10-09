import { ACCOUNT_HEADER, type Me, type Span } from '@overload/api-contract';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient, queryOptions, type FetchStatus } from '@tanstack/react-query';
import {
  persistQueryClientRestore,
  persistQueryClientSubscribe,
  type PersistedClient,
  type Persister,
} from '@tanstack/react-query-persist-client';
import { useState, useSyncExternalStore } from 'react';
import { api, ApiError, isUnauthenticated, unwrap } from './api';
import { deviceStore } from './device-store';

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

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: CACHE_MAX_AGE_MS,
      staleTime: 60 * 1000,
      // A 401 means the session has ended; retrying cannot change that (docs/08 §5).
      retry: (failureCount, error) =>
        !isUnauthenticated(error) && !(error instanceof AccountCheckFailed) && failureCount < 2,
    },
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

/** After a write: both exercise lists, since a setting or a new exercise changes each. */
export const refreshExercises = () => queryClient.invalidateQueries({ queryKey: ['exercises'] });
export const refreshRoutines = () => queryClient.invalidateQueries({ queryKey: ['routines'] });
/** After an acknowledged sync batch: a chart on screen is asked again, the rest when next opened. */
export const refreshProgress = () => queryClient.invalidateQueries({ queryKey: ['progress'] });

/**
 * Asks for last time again whether or not a screen is reading it, since the next workout starts
 * from this copy (S2). Without a profile there is nothing to ask (`setup_incomplete`). It never
 * rejects: a failed ask leaves the copy as it was.
 */
export function refreshLastTime(): Promise<void> {
  if (queryClient.getQueryData<Me>(ME_KEY)?.profile == null) return Promise.resolve();
  return queryClient.fetchQuery({ ...lastTimeQuery, staleTime: 0 }).then(
    () => undefined,
    () => undefined,
  );
}

/** The unit weights are shown and typed in (docs/06, 2026-09-23). Kilograms until a profile says. */
export const currentWeightUnit = () =>
  queryClient.getQueryData<Me>(ME_KEY)?.profile?.weightUnit ?? 'kg';

/** After the profile is saved: /api/me carries it, so the cached answer takes the new one. */
export function setProfile(profile: NonNullable<Me['profile']>) {
  queryClient.setQueryData<Me>(ME_KEY, (me) => (me === undefined ? me : { ...me, profile }));
}
