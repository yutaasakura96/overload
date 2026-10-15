import { authClient } from './auth-client';
import { deviceStore } from './device-store';
import { announceSignOut, closeAccount, currentAccount, queryClient } from './query';
import { discardWorkouts, openWorkout, recordsLoadedFor, useWorkoutStore } from './workout';

/**
 * What stops a sign-out before it starts (docs/08 §7): sets are never left on a device nobody is
 * signed in to, and they are lost only by an explicit choice. A workout in progress is finished
 * first, and its ending (or its removal) has to be acknowledged, so no workout is left open on the
 * server; only then are rows not uploaded yet uploaded or discarded.
 */
export type SignOutResult =
  | 'signed-out'
  | 'failed'
  | 'workout-open'
  | 'workout-unsynced'
  | 'rows-waiting';

/** Account deletion stops for the same reasons, and for two of the server's own (docs/08 §6). */
export type DeleteAccountResult =
  | Exclude<SignOutResult, 'signed-out'>
  | 'deleted'
  | 'stale-session'
  | 'admin-account';

/** Why the device cannot let go of the account yet, if it cannot. */
function heldBack(options: {
  discard?: boolean;
}): Exclude<SignOutResult, 'signed-out'> | undefined {
  const state = useWorkoutStore.getState();
  if (!recordsLoadedFor(state, currentAccount().userId)) return 'failed';
  const { records } = state;
  if (openWorkout(records) !== undefined) return 'workout-open';
  if (records.some((record) => record.table === 'workouts' && record.state !== 'acknowledged')) {
    return 'workout-unsynced';
  }
  if (options.discard !== true && records.some((record) => record.state !== 'acknowledged')) {
    return 'rows-waiting';
  }
  return undefined;
}

/** End the server session before closing the account; wipe failures are handled as in docs/08 §7. */
export async function signOut(
  navigate: (path: string) => void,
  options: { discard?: boolean } = {},
): Promise<SignOutResult> {
  const held = heldBack(options);
  if (held !== undefined) return held;
  try {
    const result = await authClient.signOut();
    if (result.error) return 'failed';
  } catch {
    return 'failed';
  }
  await wipeDevice(navigate);
  return 'signed-out';
}

/**
 * Delete the account (S10, docs/09 F7), then run the sign-out wipe. The device's rows not uploaded
 * yet are uploaded or discarded first, by the user's choice, as on sign-out: deletion never uploads
 * them itself.
 */
export async function deleteAccount(
  navigate: (path: string) => void,
  options: { discard?: boolean } = {},
): Promise<DeleteAccountResult> {
  const held = heldBack(options);
  if (held !== undefined) return held;
  try {
    const result = await authClient.deleteUser();
    if (result.error) {
      // Better Auth's own refusals, in its `{ code, message }` format (docs/07 §1.3).
      if (result.error.code === 'SESSION_EXPIRED') return 'stale-session';
      if (result.error.code === 'admin_account') return 'admin-account';
      return 'failed';
    }
  } catch {
    return 'failed';
  }
  await wipeDevice(navigate, 'deleted=1');
  return 'deleted';
}

/** Nothing of the user's stays readable on the device: the set store's records go with the cache. */
async function wipeDevice(navigate: (path: string) => void, note?: string) {
  const setsWiped = await discardWorkouts().then(
    () => true,
    () => false,
  );
  const pendingRemember = closeAccount();
  queryClient.clear();
  await pendingRemember?.catch(() => undefined);
  const wiped = await deviceStore.wipe().then(
    () => true,
    () =>
      deviceStore.wipe().then(
        () => true,
        () => false,
      ),
  );
  announceSignOut();
  const query = [note, wiped && setsWiped ? undefined : 'wipe=failed'].filter(Boolean).join('&');
  navigate(query === '' ? '/sign-in' : `/sign-in?${query}`);
}
