import type { Me } from '@overload/api-contract';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient, queryOptions } from '@tanstack/react-query';
import {
  persistQueryClientRestore,
  persistQueryClientSubscribe,
  type PersistedClient,
  type Persister,
} from '@tanstack/react-query-persist-client';
import { useSyncExternalStore } from 'react';
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

function restore(userId: string, generation = accountGeneration) {
  return persistQueryClientRestore({
    queryClient,
    persister: accountPersister(userId, generation),
    maxAge: CACHE_MAX_AGE_MS,
  }).catch(() => undefined);
}

// Other tabs of the app on this device: when one of them changes account or signs out, this tab
// drops what it holds and opens again as the new account.
const tabs = typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel('overload');
// oxlint-disable-next-line unicorn/require-post-message-target-origin -- a BroadcastChannel, not a window
const announceTo = (userId: string | null) => tabs?.postMessage({ userId });
tabs?.addEventListener('message', (event: MessageEvent<{ userId: string | null }>) => {
  if (event.data.userId === account.userId) return;
  const pendingRemember = closeAccount();
  queryClient.clear();
  if (event.data.userId !== null) {
    window.location.reload();
    return;
  }
  void Promise.resolve(pendingRemember)
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
  // The copy shared by every account before copies were kept per account (docs/08 §7).
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
  // Asked at every launch, focus and reconnect, however fresh: it is the account check, and nothing
  // renders until it answers or fails.
  staleTime: 0,
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

/** One account's data: enable it only once /api/me has confirmed the account (`useAccount`). */
export const exercisesQuery = queryOptions({
  queryKey: ['exercises'],
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  queryFn: async ({ signal }) => {
    const generation = accountGeneration;
    if (account.status !== 'confirmed') throw new AccountCheckFailed('Account unconfirmed');
    const items = unwrap(await api.GET('/api/exercises', { signal })).items;
    if (generation !== accountGeneration || account.status !== 'confirmed') {
      throw new AccountCheckFailed('Account changed');
    }
    return items;
  },
});
