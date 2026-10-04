import type { Exercise, LastTime, Routine, SyncResult } from '@overload/api-contract';
import { create } from 'zustand';
import { newId } from './ids';
import {
  setStore,
  type SetRecord,
  type StoreRecord,
  type WorkoutExerciseRecord,
  type WorkoutRecord,
} from './set-store';

// The active workout, open on the device (docs/03 §6): one Zustand store, in memory, rebuilt from
// the set store on every launch. Every change is written to the set store first and reaches this
// store, and so the screen, only once that write has landed (docs/03 §8.1). Server data never lives
// here; the rest timer keeps which set it counts from, never a countdown.

/** A workout with no new set for this long counts as ended (docs/09 F3). */
export const IDLE_END_MS = 3 * 60 * 60 * 1000;

type Rest = {
  /** The set rest counts from: its `performedAt` is when rest started. */
  setId: string;
  /** What `+30s` has added to this rest. */
  extraSeconds: number;
  /** Skipped, or dismissed once over. */
  dismissed: boolean;
};

type WorkoutState = {
  /** Whose records are loaded, or undefined before the first load. */
  userId: string | undefined;
  loaded: boolean;
  /** The set store could not be read: what is on the device is not known, so nothing is assumed. */
  readFailed: boolean;
  records: StoreRecord[];
  rest: Rest | undefined;
  /** When the uploader last had every row answered, for the data-state slot. 0 before that. */
  lastSyncedAt: number;
  /** A workout the 3-hour rule ended at this launch, said once on Today (docs/09 F3). */
  idleEnded: { name: string; endedAt: string } | undefined;
};

export const useWorkoutStore = create<WorkoutState>()(() => ({
  userId: undefined,
  loaded: false,
  readFailed: false,
  records: [],
  rest: undefined,
  lastSyncedAt: 0,
  idleEnded: undefined,
}));

type Change = { put?: StoreRecord[]; remove?: string[] };

// One change at a time, each made from the records the one before it left.
let queue: Promise<unknown> = Promise.resolve();

/** Writes a change to the set store, then shows it. A failed write shows nothing and rejects. */
function mutate(change: (records: StoreRecord[]) => Change | undefined): Promise<void> {
  const run = queue.then(async () => {
    const { records } = useWorkoutStore.getState();
    const result = change(records);
    if (result === undefined) return;
    await setStore.write(result);
    const put = new Map((result.put ?? []).map((record) => [record.id, record]));
    const gone = new Set(result.remove ?? []);
    useWorkoutStore.setState({
      records: [
        ...records.filter((record) => !gone.has(record.id) && !put.has(record.id)),
        ...put.values(),
      ],
    });
  });
  queue = run.catch(() => undefined);
  return run;
}

// Reading the records.

/** Whether this user's records have been read from the set store this launch. */
export const recordsLoadedFor = (state: WorkoutState, userId: string | undefined) =>
  state.loaded && state.userId === userId;

/** Whether reading this user's records failed. */
export const readFailedFor = (state: WorkoutState, userId: string | undefined) =>
  state.readFailed && state.userId === userId;

const NO_RECORDS: StoreRecord[] = [];

/** This user's records, or none while the store holds nobody's or another account's (docs/08 §5). */
export const recordsOf = (state: WorkoutState, userId: string | undefined) =>
  recordsLoadedFor(state, userId) ? state.records : NO_RECORDS;

const byPosition = (a: { row: { position: number; id: string } }, b: typeof a) =>
  a.row.position - b.row.position || (a.row.id < b.row.id ? -1 : 1);

/** The workout in progress: not ended, not deleted. One at a time (docs/09 F3). */
export function openWorkout(records: StoreRecord[]): WorkoutRecord | undefined {
  return records
    .filter(
      (record): record is WorkoutRecord =>
        record.table === 'workouts' &&
        record.deletedAt === undefined &&
        record.row.endedAt === null,
    )
    .toSorted((a, b) => (a.row.startedAt < b.row.startedAt ? 1 : -1))[0];
}

export function exercisesOf(records: StoreRecord[], workoutId: string): WorkoutExerciseRecord[] {
  return records
    .filter(
      (record): record is WorkoutExerciseRecord =>
        record.table === 'workoutExercises' &&
        record.workoutId === workoutId &&
        record.deletedAt === undefined,
    )
    .toSorted(byPosition);
}

/** One exercise's logged sets in order, warm-ups included. */
export function setsOf(records: StoreRecord[], workoutExerciseId: string): SetRecord[] {
  return records
    .filter(
      (record): record is SetRecord =>
        record.table === 'sets' &&
        record.row.workoutExerciseId === workoutExerciseId &&
        record.deletedAt === undefined,
    )
    .toSorted(byPosition);
}

function setsOfWorkout(records: StoreRecord[], workoutId: string): SetRecord[] {
  return records.filter(
    (record): record is SetRecord =>
      record.table === 'sets' && record.workoutId === workoutId && record.deletedAt === undefined,
  );
}

/** The set logged last in a workout, which is where rest counts from. */
export function lastSetOf(records: StoreRecord[], workoutId: string): SetRecord | undefined {
  return setsOfWorkout(records, workoutId).toSorted((a, b) =>
    a.row.performedAt < b.row.performedAt ? 1 : -1,
  )[0];
}

/**
 * What the data-state slot counts (docs/10 §7.4): refused rows, and sets the server has not
 * acknowledged. With no set waiting, a workout row still waiting counts instead, so the slot never
 * reads synced while something is not.
 */
export function dataState(records: StoreRecord[]): { refused: number; pending: number } {
  const pending = records.filter((record) => record.state === 'pending');
  const sets = pending.filter(
    (record) => record.table === 'sets' && record.deletedAt === undefined,
  );
  return {
    refused: records.filter((record) => record.state === 'refused').length,
    pending: sets.length > 0 ? sets.length : pending.length,
  };
}

// Changing them.

/**
 * Rebuilds the store from the set store, for this user. Rest still running from the last set's
 * `performedAt` picks up where it was, which is why the timer is never stored as a countdown.
 */
export async function loadWorkouts(userId: string, nowMs = Date.now()): Promise<void> {
  // A device whose IndexedDB cannot be read is not loaded: Today says so and offers to try again,
  // and neither a start nor a sign-out goes ahead on records nobody has seen (docs/08 §7).
  const records = await setStore.all(userId).catch(() => undefined);
  // What the store says of the account before stays with that account.
  const other =
    useWorkoutStore.getState().userId === userId ? {} : { idleEnded: undefined, lastSyncedAt: 0 };
  if (records === undefined) {
    useWorkoutStore.setState({
      ...other,
      userId,
      loaded: false,
      readFailed: true,
      records: [],
      rest: undefined,
    });
    return;
  }
  const workout = openWorkout(records);
  const last = workout === undefined ? undefined : lastSetOf(records, workout.id);
  const exercise = records.find(
    (record): record is WorkoutExerciseRecord =>
      record.table === 'workoutExercises' && record.id === last?.row.workoutExerciseId,
  );
  const resting =
    last !== undefined &&
    exercise !== undefined &&
    nowMs - new Date(last.row.performedAt).getTime() < exercise.local.restSeconds * 1000;
  // A rest already counted from this set keeps its `+30s` and its skip: this runs again from
  // Today's "Try again" and when the account changes, not only at launch.
  const { rest } = useWorkoutStore.getState();
  const kept = last !== undefined && rest?.setId === last.id ? rest : undefined;
  useWorkoutStore.setState({
    ...other,
    userId,
    loaded: true,
    readFailed: false,
    records,
    rest: kept ?? (resting ? { setId: last.id, extraSeconds: 0, dismissed: false } : undefined),
  });
}

/**
 * Starts a workout from a routine (docs/09 F3 step 1): the workout and its exercises are made on
 * the device, each exercise with its rep range, increment and target sets resolved and copied
 * (routine slot → user setting → exercise default; `exercises` already holds the last two), and
 * with last time and the suggestion from the offline cache.
 */
export async function startWorkout(input: {
  userId: string;
  routine: Routine;
  exercises: Map<string, Exercise>;
  lastTimes: Map<string, LastTime>;
}): Promise<void> {
  const now = new Date().toISOString();
  const workoutId = newId();
  const base = { userId: input.userId, workoutId, state: 'pending' } as const;
  const workout: WorkoutRecord = {
    ...base,
    table: 'workouts',
    id: workoutId,
    row: {
      id: workoutId,
      routineId: input.routine.id,
      name: input.routine.name,
      startedAt: now,
      endedAt: null,
      note: null,
      clientUpdatedAt: now,
    },
    local: {},
  };
  const exercises = input.routine.exercises.flatMap((slot, position): WorkoutExerciseRecord[] => {
    const exercise = input.exercises.get(slot.exerciseId);
    if (exercise === undefined) return [];
    // A slot reads its own last time; one never logged falls back to the exercise's.
    const logged = input.lastTimes.get(slot.exerciseId);
    const last = logged?.slots.find((own) => own.routineExerciseId === slot.id) ?? logged;
    const id = newId();
    return [
      {
        ...base,
        table: 'workoutExercises',
        id,
        row: {
          id,
          workoutId,
          exerciseId: slot.exerciseId,
          routineExerciseId: slot.id,
          position,
          targetSets: slot.targetSets,
          repLow: slot.repLow ?? exercise.repLow,
          repHigh: slot.repHigh ?? exercise.repHigh,
          incrementKg: exercise.incrementKg,
          clientUpdatedAt: now,
        },
        local: {
          name: exercise.name,
          bodyweight: exercise.equipment === 'bodyweight',
          restSeconds: exercise.restSeconds,
          lastTime: (last?.sets ?? []).map((set) => ({ weightKg: set.weightKg, reps: set.reps })),
          suggestion: last?.suggestion ?? null,
        },
      },
    ];
  });
  await mutate(() => ({ put: [workout, ...exercises] }));
  useWorkoutStore.setState({ rest: undefined, idleEnded: undefined });
}

/** Logs a set: on the device first, then on screen, and rest starts from it (S1, S5). */
export async function completeSet(input: {
  exercise: WorkoutExerciseRecord;
  weightKg: number;
  reps: number;
  rir: number | null;
  isWarmup: boolean;
}): Promise<void> {
  const now = new Date().toISOString();
  const id = newId();
  await mutate((records) => {
    // A deleted set keeps its place: positions are never renumbered (docs/04 `set`).
    const positions = records.flatMap((record) =>
      record.table === 'sets' && record.row.workoutExerciseId === input.exercise.id
        ? [record.row.position]
        : [],
    );
    const record: SetRecord = {
      table: 'sets',
      id,
      userId: input.exercise.userId,
      workoutId: input.exercise.workoutId,
      state: 'pending',
      row: {
        id,
        workoutExerciseId: input.exercise.id,
        position: positions.length === 0 ? 0 : Math.max(...positions) + 1,
        weightKg: input.weightKg,
        reps: input.reps,
        rir: input.rir,
        rpe: null,
        isWarmup: input.isWarmup,
        performedAt: now,
        clientUpdatedAt: now,
      },
    };
    return { put: [record] };
  });
  const rests = input.exercise.local.restSeconds > 0;
  useWorkoutStore.setState({
    rest: rests ? { setId: id, extraSeconds: 0, dismissed: false } : undefined,
  });
}

/** A workout left with no logged set is deleted, not kept (docs/09 F3). */
function removeWorkout(records: StoreRecord[], workout: WorkoutRecord, now: string): Change {
  return {
    put: [{ ...workout, state: 'pending', deletedAt: now }],
    remove: records
      .filter((record) => record.workoutId === workout.id && record.id !== workout.id)
      .map((record) => record.id),
  };
}

/** Finish (docs/09 F3 step 5): `ended_at` is now. With no logged set the workout is deleted. */
export async function finishWorkout(): Promise<void> {
  const now = new Date().toISOString();
  await mutate((records) => {
    const workout = openWorkout(records);
    if (workout === undefined) return undefined;
    if (setsOfWorkout(records, workout.id).length === 0)
      return removeWorkout(records, workout, now);
    const row = { ...workout.row, endedAt: now, clientUpdatedAt: now };
    return { put: [{ ...workout, state: 'pending', row }] };
  });
  useWorkoutStore.setState({ rest: undefined });
}

/**
 * The 3-hour rule (docs/09 F3): a workout with no new set for 3 hours counts as ended at its last
 * set's `performed_at`. The device writes it when the app next opens, offline or not; the server
 * derives nothing. One that never logged a set is deleted, as Finish would.
 */
export async function endIdleWorkout(nowMs = Date.now()): Promise<void> {
  const now = new Date(nowMs).toISOString();
  let ended: WorkoutState['idleEnded'];
  await mutate((records) => {
    const workout = openWorkout(records);
    if (workout === undefined) return undefined;
    const last = lastSetOf(records, workout.id);
    const lastActivity = last?.row.performedAt ?? workout.row.startedAt;
    if (nowMs - new Date(lastActivity).getTime() < IDLE_END_MS) return undefined;
    if (last === undefined) return removeWorkout(records, workout, now);
    ended = { name: workout.row.name, endedAt: last.row.performedAt };
    const row = { ...workout.row, endedAt: last.row.performedAt, clientUpdatedAt: now };
    return {
      put: [{ ...workout, state: 'pending', row, local: { endedByIdleRule: true } }],
    };
  });
  if (ended !== undefined) useWorkoutStore.setState({ rest: undefined, idleEnded: ended });
}

/** The rest counted from this set, as the store holds it or as it starts. */
function restFrom(setId: string): Rest {
  const { rest } = useWorkoutStore.getState();
  return rest?.setId === setId ? rest : { setId, extraSeconds: 0, dismissed: false };
}

export function extendRest(setId: string, seconds: number) {
  const rest = restFrom(setId);
  useWorkoutStore.setState({ rest: { ...rest, extraSeconds: rest.extraSeconds + seconds } });
}

/** Skip, or dismiss once over. */
export function dismissRest(setId: string) {
  useWorkoutStore.setState({ rest: { ...restFrom(setId), dismissed: true } });
}

/** A row as it was sent, to tell whether the record changed while the request was away. */
export type SentRow = {
  id: string;
  clientUpdatedAt: string | undefined;
  deletedAt: string | undefined;
};

export const sentRowOf = (record: StoreRecord): SentRow => ({
  id: record.id,
  clientUpdatedAt: record.deletedAt === undefined ? record.row.clientUpdatedAt : undefined,
  deletedAt: record.deletedAt,
});

/** Whether the server's copy of a workout ended on the device is still in progress. */
const stillOpenThere = (record: StoreRecord, row: object) =>
  record.table === 'workouts' &&
  record.row.endedAt !== null &&
  'endedAt' in row &&
  row.endedAt === null;

/**
 * Applies a sync answer (docs/07 §3.4). A stored, unchanged or deleted row is acknowledged: its
 * record is deleted, or, while its workout is open, kept and marked acknowledged. A refused row is
 * kept and marked refused. A record changed since it was sent stays pending for the next upload,
 * and so does a workout's ending or removal the server's answer does not show: its own copy won
 * and is still open (docs/08 §7).
 * Then every ended workout whose records are all acknowledged leaves the device.
 */
export async function applySyncResults(sent: SentRow[], results: SyncResult[]): Promise<void> {
  const sentById = new Map(sent.map((row) => [row.id, row]));
  await mutate((records) => {
    const byId = new Map(records.map((record) => [record.id, record]));
    const put = new Map<string, StoreRecord>();
    const remove = new Set<string>();
    for (const result of results) {
      const record = byId.get(result.id);
      const was = sentById.get(result.id);
      if (record === undefined || was === undefined) continue;
      const now = sentRowOf(record);
      if (now.clientUpdatedAt !== was.clientUpdatedAt || now.deletedAt !== was.deletedAt) continue;
      if (result.status === 'refused') {
        put.set(record.id, { ...record, state: 'refused', problem: result.problem });
      } else if (result.status === 'deleted') {
        for (const other of records) {
          if (
            other.id === record.id ||
            (record.table === 'workouts' && other.workoutId === record.id)
          ) {
            remove.add(other.id);
          }
        }
      } else if (record.deletedAt === undefined && !stillOpenThere(record, result.row)) {
        put.set(record.id, { ...record, state: 'acknowledged' });
      }
    }
    const after = records
      .filter((record) => !remove.has(record.id))
      .map((record) => put.get(record.id) ?? record);
    for (const workout of after) {
      if (workout.table !== 'workouts' || workout.row.endedAt === null) continue;
      const whole = after.filter((record) => record.workoutId === workout.id);
      if (whole.every((record) => record.state === 'acknowledged')) {
        for (const record of whole) remove.add(record.id);
      }
    }
    if (put.size === 0 && remove.size === 0) return undefined;
    return {
      put: [...put.values()].filter((record) => !remove.has(record.id)),
      remove: [...remove],
    };
  });
}

/** Removes every record of this user from the device: sign-out's explicit discard (docs/08 §7). */
export async function discardWorkouts(): Promise<void> {
  await mutate((records) => ({ remove: records.map((record) => record.id) }));
  useWorkoutStore.setState({ rest: undefined, idleEnded: undefined });
}

export function markSynced() {
  useWorkoutStore.setState({ lastSyncedAt: Date.now() });
}
