import type {
  SetRow,
  Suggestion,
  SyncResult,
  WorkoutExerciseRow,
  WorkoutRow,
} from '@overload/api-contract';

// The set store (docs/03 §6, CONTEXT.md): the device's own IndexedDB database, one record per
// `workout`, `workout_exercise` or `set` row keyed by its id. A row is written here, with strict
// durability, the moment it is made or changed and before the screen shows it; it is deleted only
// after the server acknowledges it, and the open workout's rows stay, marked acknowledged, until the
// workout ends, so the workout can be rebuilt after iOS closes the app. It is its own database:
// the sign-out wipe of device-store.ts never touches it (docs/08 §7).

/** Why the server refused a row: its code, and the fields at fault when it named any. */
export type Refusal = {
  code: Extract<SyncResult, { status: 'refused' }>['problem']['code'];
  fields: string[];
};

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
  /** Kept with a refused row, so the screen can say why (docs/09 F4). */
  refusal?: Refusal;
  /** Set when the row was deleted on the device: it travels as `{ id, deletedAt }`. */
  deletedAt?: string;
};

export type WorkoutRecord = RecordBase & { table: 'workouts'; row: WorkoutRow };

/** One working set as last time logged it, copied when the workout starts. */
/** `rir` is absent from a copy kept before last time carried it. */
export type LastSet = { weightKg: number; reps: number; rir?: number | null };

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
// How often the database has been made anew under this page: the device's storage was cleared or
// evicted while the app was open. Nothing in the app does that.
let opened = false;
let remade = 0;

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
      if (opened) remade += 1;
    });
    request.addEventListener('success', () => {
      opened = true;
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

/** What one change writes and removes. */
export type Change = { put?: StoreRecord[]; remove?: string[] };

// Every tab of this origin holds the records in memory. A tab that changes them says whose they
// were, so the others read them again instead of working from what they last saw.
const channel =
  typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel('overload-sets');

/** Calls `listener` with the user whose records another tab has just changed. */
export function onChangeElsewhere(listener: (userId: string) => void) {
  channel?.addEventListener('message', (event) => {
    if (typeof event.data === 'string') listener(event.data);
  });
}

const failure = (error: unknown) => (error instanceof Error ? error : new Error('set store'));

export const setStore = {
  /** How often the store has been emptied under the open app, to tell a read after it from one before. */
  remade: () => remade,

  /** Every record on the device belonging to this user. */
  async all(userId: string): Promise<StoreRecord[]> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const request = db.transaction(ROWS, 'readonly').objectStore(ROWS).getAll();
      request.addEventListener('success', () => {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only this module writes the store
        const records = request.result as StoreRecord[];
        resolve(records.filter((record) => record.userId === userId));
      });
      request.addEventListener('error', () => reject(request.error ?? new Error('set store')));
    });
  },

  /**
   * Makes one change to this user's records and answers them as the change left them. The records
   * are read, and what `change` makes of them written, in one transaction flushed to disk before it
   * resolves (`durability: "strict"`), so a set is on the device before the screen says so (docs/03
   * §8.1). Reading inside the transaction is what keeps two tabs apart: a change is made from what
   * is on the device, never from what its own tab last saw.
   */
  async change(
    userId: string,
    change: (records: StoreRecord[]) => Change | undefined,
  ): Promise<StoreRecord[]> {
    const db = await open();
    let wrote = false;
    const after = await new Promise<StoreRecord[]>((resolve, reject) => {
      const transaction = db.transaction(ROWS, 'readwrite', { durability: 'strict' });
      const rows = transaction.objectStore(ROWS);
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only this module writes the store
      const own = (request: IDBRequest) => request.result as StoreRecord[];
      let records: StoreRecord[] = [];
      let thrown: unknown;
      const before = rows.getAll();
      before.addEventListener('success', () => {
        records = own(before).filter((record) => record.userId === userId);
        let result: Change | undefined;
        try {
          result = change(records);
        } catch (error) {
          thrown = error;
          transaction.abort();
          return;
        }
        const put = result?.put ?? [];
        const remove = result?.remove ?? [];
        if (put.length + remove.length === 0) return;
        wrote = true;
        for (const record of put) rows.put(record);
        for (const id of remove) rows.delete(id);
        const written = rows.getAll();
        written.addEventListener('success', () => {
          records = own(written).filter((record) => record.userId === userId);
        });
      });
      transaction.addEventListener('complete', () => resolve(records));
      transaction.addEventListener('error', () => reject(failure(transaction.error)));
      transaction.addEventListener('abort', () => reject(failure(thrown ?? transaction.error)));
    });
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a BroadcastChannel, not a window
    if (wrote) channel?.postMessage(userId);
    return after;
  },
};
