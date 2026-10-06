import type { SetRow, Suggestion, WorkoutExerciseRow, WorkoutRow } from '@overload/api-contract';

// The set store (docs/03 §6, CONTEXT.md): the device's own IndexedDB database, one record per
// `workout`, `workout_exercise` or `set` row keyed by its id. A row is written here, with strict
// durability, the moment it is made or changed and before the screen shows it; it is deleted only
// after the server acknowledges it, and the open workout's rows stay, marked acknowledged, until the
// workout ends, so the workout can be rebuilt after iOS closes the app. It is its own database:
// the sign-out wipe of device-store.ts never touches it (docs/08 §7).

type RecordBase = {
  id: string;
  /** Whose row this is. Only the confirmed account's records are shown or uploaded. */
  userId: string;
  /** The workout the row belongs to, itself included, so a workout's records are found together. */
  workoutId: string;
  /**
   * `pending` until the server answers for this version of the row; `acknowledged` once it has
   * stored it; `refused` when it refused it, which keeps the record to edit or discard.
   */
  state: 'pending' | 'acknowledged' | 'refused';
  /** Set when the row was deleted on the device: it travels as `{ id, deletedAt }`. */
  deletedAt?: string;
};

export type WorkoutRecord = RecordBase & { table: 'workouts'; row: WorkoutRow };

/** One working set as last time logged it, copied when the workout starts. */
export type LastSet = { weightKg: number; reps: number };

export type WorkoutExerciseRecord = RecordBase & {
  table: 'workoutExercises';
  row: WorkoutExerciseRow;
  /**
   * Device-only, copied at start with the row's own defaults: the name and rest to show offline,
   * and last time and the suggestion as of the last sync (docs/09 F3 step 1).
   */
  local: {
    name: string;
    bodyweight: boolean;
    restSeconds: number;
    lastTime: LastSet[];
    suggestion: Suggestion | null;
  };
};

export type SetRecord = RecordBase & { table: 'sets'; row: SetRow };

export type StoreRecord = WorkoutRecord | WorkoutExerciseRecord | SetRecord;

const DATABASE = 'overload-sets';
const ROWS = 'rows';

let opening: Promise<IDBDatabase> | undefined;

/** Lets go of a connection that is no longer usable, so the next read or write opens another. */
function forget(connection: Promise<IDBDatabase>) {
  if (opening === connection) opening = undefined;
}

function open(): Promise<IDBDatabase> {
  if (opening !== undefined) return opening;
  const connection = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.addEventListener('upgradeneeded', () => {
      request.result.createObjectStore(ROWS, { keyPath: 'id' });
    });
    request.addEventListener('success', () => {
      const db = request.result;
      // The connection does not always last as long as the page. The browser closes it when the
      // device's storage is cleared or evicted, or under a backgrounded iOS web app (`close`), and
      // asks for it back when the database is deleted or upgraded from elsewhere (`versionchange`).
      db.addEventListener('close', () => forget(connection));
      db.addEventListener('versionchange', () => {
        db.close();
        forget(connection);
      });
      resolve(db);
    });
    request.addEventListener('error', () => reject(request.error ?? new Error('set store')));
  }).catch((error: unknown) => {
    forget(connection);
    throw error;
  });
  opening = connection;
  return connection;
}

/**
 * Runs `body` in a transaction on the rows. A connection the browser closed without saying so
 * refuses to start one (`InvalidStateError`): nothing was read or written, so it is let go and the
 * transaction started once more on a new one. `body` makes its requests before it returns.
 */
async function inTransaction<T>(
  mode: IDBTransactionMode,
  body: (transaction: IDBTransaction) => Promise<T>,
  options?: IDBTransactionOptions,
): Promise<T> {
  const connection = open();
  const db = await connection;
  let transaction;
  try {
    transaction = db.transaction(ROWS, mode, options);
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== 'InvalidStateError') throw error;
    forget(connection);
    transaction = (await open()).transaction(ROWS, mode, options);
  }
  return body(transaction);
}

export const setStore = {
  /** Every record on the device belonging to this user. */
  all(userId: string): Promise<StoreRecord[]> {
    return inTransaction(
      'readonly',
      (transaction) =>
        new Promise((resolve, reject) => {
          const request = transaction.objectStore(ROWS).getAll();
          request.addEventListener('success', () => {
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only this module writes the store
            const records = request.result as StoreRecord[];
            resolve(records.filter((record) => record.userId === userId));
          });
          request.addEventListener('error', () => reject(request.error ?? new Error('set store')));
        }),
    );
  },

  /**
   * Writes and removes records in one transaction, flushed to disk before it resolves
   * (`durability: "strict"`), so a set is on the device before the screen says so (docs/03 §8.1).
   */
  write(change: { put?: StoreRecord[]; remove?: string[] }): Promise<void> {
    return inTransaction(
      'readwrite',
      (transaction) =>
        new Promise<void>((resolve, reject) => {
          const rows = transaction.objectStore(ROWS);
          for (const record of change.put ?? []) rows.put(record);
          for (const id of change.remove ?? []) rows.delete(id);
          transaction.addEventListener('complete', () => resolve());
          transaction.addEventListener('error', () =>
            reject(transaction.error ?? new Error('set store')),
          );
          transaction.addEventListener('abort', () =>
            reject(transaction.error ?? new Error('set store')),
          );
        }),
      { durability: 'strict' },
    );
  },
};
