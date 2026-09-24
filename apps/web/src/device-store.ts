import { clear, createStore, del, get, set } from 'idb-keyval';
import type { Me } from '@overload/api-contract';

// What the device keeps in IndexedDB: the signed-in user and the persisted TanStack cache (docs/03
// §6, docs/08 §5). The sign-out wipe clears all of it (docs/08 §7). The set store is separate and
// arrives in slice 3, with its own rule: never dropped without the user's choice.
const store = createStore('overload', 'device');

const SIGNED_IN_USER = 'signed-in-user';
// Days left incomplete at the end-of-day check (docs/03 §6) will live here too from M2, and the
// wipe below already covers them.
const QUERY_CACHE = 'query-cache';

export type SignedInUser = Me['user'];

export const deviceStore = {
  /** The last confirmed signed-in user, so an offline launch can open as them (docs/08 §5). */
  rememberUser: (user: SignedInUser) => set(SIGNED_IN_USER, user, store),
  signedInUser: () => get<SignedInUser>(SIGNED_IN_USER, store),

  // The TanStack Query persister's storage (see query.ts).
  queryCache: {
    getItem: (key: string) => get<string>(`${QUERY_CACHE}:${key}`, store),
    setItem: (key: string, value: string) => set(`${QUERY_CACHE}:${key}`, value, store),
    removeItem: (key: string) => del(`${QUERY_CACHE}:${key}`, store),
  },

  /**
   * Removes everything this store holds: the signed-in user, the incomplete days and the persisted
   * query cache. Weight, food and health numbers must not stay readable after sign-out (docs/08 §7).
   */
  wipe: () => clear(store),
};
