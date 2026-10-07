import type { SyncBatch } from '@overload/api-contract';
import { api, isUnauthenticated } from './api';
import {
  confirmedAccountData,
  currentAccount,
  onAccountChange,
  queryClient,
  refreshLastTime,
} from './query';
import { onChangeElsewhere, type StoreRecord } from './set-store';
import {
  applySyncResults,
  markSynced,
  refreshWorkouts,
  sentRowOf,
  useWorkoutStore,
} from './workout';

// The uploader (docs/03 §8.1): sends the set store's pending rows whenever the app is open and has
// signal. It does not depend on Background Sync. A retry is harmless, since the server applies a row
// only when the phone's `clientUpdatedAt` is newer than its own (docs/07 §3.4). One upload runs at a
// time in this tab, and one tab at a time under a Web Lock.

/** The server's limit on one request (docs/07 §3.4). A larger queue goes in several. */
const BATCH_ROWS = 500;
/** How often a waiting queue is tried again while the app stays open. */
const RETRY_MS = 30 * 1000;
/** The lock every tab of this origin uploads under. */
const UPLOAD_LOCK = 'overload-upload';
/** How long a tab waits for it before uploading anyway. */
const LOCK_WAIT_MS = 10 * 1000;

const tables = ['workouts', 'workoutExercises', 'sets'] as const;

/** A record as the batch carries it: the whole current row, or its deletion. */
const sent = (record: StoreRecord) =>
  record.deletedAt === undefined ? record.row : { id: record.id, deletedAt: record.deletedAt };

function batchOf(records: StoreRecord[]): SyncBatch {
  return {
    workouts: records.filter((r) => r.table === 'workouts').map(sent),
    workoutExercises: records.filter((r) => r.table === 'workoutExercises').map(sent),
    sets: records.filter((r) => r.table === 'sets').map(sent),
  };
}

/**
 * Runs an upload while this tab holds the origin's upload lock, so one tab uploads at a time
 * (docs/03 §8.1). The lock saves requests, nothing more: the server stores a row once whoever
 * sends it, and a tombstone keeps a deleted one from coming back. So where the browser has no Web
 * Locks, refuses the request, or another tab holds the lock too long (a tab the browser froze
 * mid-request never lets go), the upload goes ahead without it.
 */
async function underUploadLock(upload: () => Promise<void>): Promise<void> {
  // Present in every browser this app supports, Safari 15.4 on; absent on an insecure origin.
  const locks: LockManager | undefined = navigator.locks;
  if (locks === undefined) return upload();
  const waiting = new AbortController();
  const timer = setTimeout(() => waiting.abort(), LOCK_WAIT_MS);
  let granted = false;
  try {
    await locks.request(UPLOAD_LOCK, { signal: waiting.signal }, async () => {
      granted = true;
      clearTimeout(timer);
      await upload();
    });
  } catch (error) {
    // The upload's own failure is the caller's to hear; a lock that never came is not a failure.
    if (granted) throw error;
    await upload();
  } finally {
    clearTimeout(timer);
  }
}

/** Sends pending rows, parents first, until none is left or the server cannot be reached. */
async function uploadPending(): Promise<void> {
  for (;;) {
    // What another tab uploaded while this one waited is not sent again: the set store says what
    // is still pending. A store that cannot be read leaves this tab's own view, which still holds.
    await refreshWorkouts().catch(() => undefined);
    const account = currentAccount();
    const { records, userId } = useWorkoutStore.getState();
    // Only the confirmed account's rows, under its own session (docs/08 §5).
    if (account.status !== 'confirmed' || account.userId !== userId) return;
    const pending = tables.flatMap((table) =>
      records.filter((record) => record.table === table && record.state === 'pending'),
    );
    if (pending.length === 0) return;
    const chunk = pending.slice(0, BATCH_ROWS);
    let results;
    try {
      const body = batchOf(chunk);
      ({ results } = await confirmedAccountData(() => api.POST('/api/workouts/sync', { body })));
    } catch (error) {
      // No signal, or the service is down: every row stays pending (docs/03 §7). A 401 applied
      // nothing either; asking /api/me again opens the sign-in prompt (docs/09 F4).
      if (isUnauthenticated(error)) void queryClient.invalidateQueries({ queryKey: ['me'] });
      return;
    }
    await applySyncResults(chunk.map(sentRowOf), results);
    markSynced();
    void refreshLastTime();
    if (pending.length <= BATCH_ROWS) return;
  }
}

let running: Promise<void> | undefined;
let again = false;

/**
 * Uploads what is pending. Resolves when this and any upload asked for meanwhile have finished, and
 * rejects when the set store could not take an answer: those rows stay pending for the next upload.
 */
export function requestUpload(): Promise<void> {
  if (running !== undefined) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        await underUploadLock(uploadPending);
      } while (again);
    } finally {
      running = undefined;
    }
  })();
  return running;
}

const hasPending = () =>
  useWorkoutStore.getState().records.some((record) => record.state === 'pending');

/** An upload nobody waits for: what one could not write to the device, the next one sends again. */
const uploadUnwatched = () => void requestUpload().catch(() => undefined);

const tryUpload = () => {
  if (hasPending()) uploadUnwatched();
};

/**
 * After a launch with no signal the account is unconfirmed, and nothing uploads under it (docs/08
 * §5). With rows waiting, the account check is asked again; its answer is what starts the upload.
 */
const retry = () => {
  if (!hasPending()) return;
  if (currentAccount().status === 'unconfirmed') {
    void queryClient.refetchQueries({ queryKey: ['me'] });
    return;
  }
  uploadUnwatched();
};

/** Starts uploading: on every change to the records, on reconnect, on return, and on a timer. */
export function startUploader() {
  // Another tab changed this account's records: they are read again, and what that tab left
  // pending is this one's to upload too, should it be closed first.
  onChangeElsewhere((userId) => {
    if (userId === useWorkoutStore.getState().userId) void refreshWorkouts().catch(() => undefined);
  });
  useWorkoutStore.subscribe((state, previous) => {
    if (state.records !== previous.records) tryUpload();
  });
  onAccountChange(tryUpload);
  window.addEventListener('online', retry);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tryUpload();
  });
  setInterval(retry, RETRY_MS);
}
