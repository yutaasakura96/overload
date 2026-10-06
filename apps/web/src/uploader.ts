import type { SyncBatch } from '@overload/api-contract';
import { api, isUnauthenticated } from './api';
import {
  confirmedAccountData,
  currentAccount,
  onAccountChange,
  queryClient,
  refreshLastTime,
} from './query';
import type { StoreRecord } from './set-store';
import { applySyncResults, markSynced, sentRowOf, useWorkoutStore } from './workout';

// The uploader (docs/03 §8.1): sends the set store's pending rows whenever the app is open and has
// signal. It does not depend on Background Sync. A retry is harmless, since the server applies a row
// only when the phone's `clientUpdatedAt` is newer than its own (docs/07 §3.4). One upload runs at a
// time in this tab; one tab at a time, by Web Locks, is slice 4's.

/** The server's limit on one request (docs/07 §3.4). A larger queue goes in several. */
const BATCH_ROWS = 500;
/** How often a waiting queue is tried again while the app stays open. */
const RETRY_MS = 30 * 1000;

const tables = ['workouts', 'workoutExercises', 'sets'] as const;

/** A record as the batch carries it: the whole current row, or its deletion. */
const sent = (record: StoreRecord) =>
  record.deletedAt === undefined ? record.row : { id: record.id, deletedAt: record.deletedAt };

function batchOf(records: StoreRecord[]): SyncBatch {
  return {
    workouts: records.filter((r) => r.table === 'workouts').map(sent),
    workoutExercises: records.filter((r) => r.table === 'workoutExercises').map(sent),
    sets: records.filter((r) => r.table === 'sets').map(sent),
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- each array holds its own table's rows
  } as SyncBatch;
}

/** Sends pending rows, parents first, until none is left or the server cannot be reached. */
async function uploadPending(): Promise<void> {
  for (;;) {
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
        await uploadPending();
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
