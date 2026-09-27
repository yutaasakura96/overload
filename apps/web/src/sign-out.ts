import { authClient } from './auth-client';
import { deviceStore } from './device-store';
import { announceSignOut, closeAccount, queryClient } from './query';

/**
 * docs/08 §7, "with nothing pending": end this login session, clear the query cache and every
 * account's IndexedDB copy, clear the stored user and the incomplete days, then go to /sign-in. Pending and
 * refused sets, and the dialog that guards them, arrive with the set store in slice 3.
 */
export async function signOut(navigate: (path: string) => void) {
  // The server call may fail offline. The device is wiped either way: nothing of this user's may
  // stay readable once they asked to leave.
  const pendingRemember = closeAccount();
  queryClient.clear();
  await authClient.signOut().catch(() => undefined);
  await pendingRemember;
  await deviceStore.wipe();
  announceSignOut();
  navigate('/sign-in');
}
