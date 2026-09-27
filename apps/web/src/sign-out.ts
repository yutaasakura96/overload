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
  return true;
}
