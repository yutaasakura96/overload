import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient, queryOptions } from '@tanstack/react-query';
import { api, isUnauthenticated, unwrap } from './api';
import { deviceStore } from './device-store';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long cached data is kept to render offline with its age (docs/03 §6), in memory and in
 * IndexedDB alike. It must stay under setTimeout's 2^31 − 1 ms (about 24.8 days): above it the
 * garbage-collection timer fires at once and every restored query is dropped on launch.
 */
export const CACHE_MAX_AGE_MS = 7 * DAY_MS;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: CACHE_MAX_AGE_MS,
      staleTime: 60 * 1000,
      // A 401 means the session has ended; retrying cannot change that (docs/08 §5).
      retry: (failureCount, error) => !isUnauthenticated(error) && failureCount < 2,
    },
  },
});

export const persister = createAsyncStoragePersister({
  storage: deviceStore.queryCache,
  key: 'overload',
});

export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: async () => {
    const me = unwrap(await api.GET('/api/me'));
    await deviceStore.rememberUser(me.user);
    return me;
  },
});

export const exercisesQuery = queryOptions({
  queryKey: ['exercises'],
  queryFn: async () => unwrap(await api.GET('/api/exercises')).items,
});
