import { authClient } from './auth-client';
import { deviceStore } from './device-store';
import { announceSignOut, closeAccount, queryClient } from './query';

/**
 * docs/08 §7, "with nothing pending": end this login session, clear the query cache and every
 * account's IndexedDB copy, clear the stored user and the incomplete days, then go to /sign-in. Pending and
 * refused sets, and the dialog that guards them, arrive with the set store in slice 3.
 */
export async function signOut(navigate: (path: string) => void): Promise<boolean> {
  try {
    const result = await authClient.signOut();
    if (result.error) return false;
  } catch {
    return false;
  }
  const pendingRemember = closeAccount();
  queryClient.clear();
  await pendingRemember?.catch(() => undefined);
  // The server has ended the session, so a failed wipe still finishes signing out here and in
  // every other tab; staying on this screen would only show an account that is already closed.
  await deviceStore.wipe().catch(() => undefined);
  announceSignOut();
  navigate('/sign-in');
  return true;
}
