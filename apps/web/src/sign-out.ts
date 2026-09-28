import { authClient } from './auth-client';
import { deviceStore } from './device-store';
import { announceSignOut, closeAccount, queryClient } from './query';

/** End the server session before closing the account; wipe failures are handled as in docs/08 §7. */
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
