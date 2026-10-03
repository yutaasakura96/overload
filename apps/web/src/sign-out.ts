import { authClient } from './auth-client';
import { deviceStore } from './device-store';
import { announceSignOut, closeAccount, queryClient } from './query';
import { discardWorkouts, openWorkout, useWorkoutStore } from './workout';

/**
 * What stops a sign-out before it starts (docs/08 §7): sets are never left on a device nobody is
 * signed in to, and they are lost only by an explicit choice. A workout in progress is finished
 * first, so its end reaches the server; rows not uploaded yet are uploaded or discarded.
 */
export type SignOutResult = 'signed-out' | 'failed' | 'workout-open' | 'rows-waiting';

/** End the server session before closing the account; wipe failures are handled as in docs/08 §7. */
export async function signOut(
  navigate: (path: string) => void,
  options: { discard?: boolean } = {},
): Promise<SignOutResult> {
  const { records } = useWorkoutStore.getState();
  if (options.discard !== true) {
    if (records.some((record) => record.state !== 'acknowledged')) return 'rows-waiting';
    if (openWorkout(records) !== undefined) return 'workout-open';
  }
  try {
    const result = await authClient.signOut();
    if (result.error) return 'failed';
  } catch {
    return 'failed';
  }
  // Nothing of the user's stays readable on the device: the set store's records go with the cache.
  await discardWorkouts().catch(() => undefined);
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
  navigate(wiped ? '/sign-in' : '/sign-in?wipe=failed');
  return 'signed-out';
}
