import { useEffect, useState } from 'react';
import { authClient } from '../auth-client';
import { AppBar, Notice } from '../components';
import { deviceStore } from '../device-store';
import { safeNext } from '../navigation';
import { markSigningIn, takeSigningIn } from '../query';
import { refuseRevokedSets } from '../workout';

// The gate's refusals, as docs/08 §1 words them. Better Auth redirects a refused sign-in back here
// with `?error=<code>` (read from its callback source, 1.7.5).
const refusals: Record<string, string> = {
  not_invited: 'This Google account hasn’t been invited.',
  access_revoked: 'Your access was revoked.',
  email_unverified: 'Use a Google account with a verified email.',
};

export function SignIn({ searchParams }: { searchParams: URLSearchParams }) {
  const [starting, setStarting] = useState(false);
  const [failed, setFailed] = useState(false);
  const error = searchParams.get('error');
  const next = safeNext(searchParams.get('next'));
  const revokedSets = useRevokedSets(error === 'access_revoked');

  const signIn = async () => {
    setStarting(true);
    setFailed(false);
    markSigningIn();
    const result = await authClient.signIn
      .social({ provider: 'google', callbackURL: next, errorCallbackURL: '/sign-in' })
      .catch(() => ({ error: true }));
    // On success the browser is already leaving for Google.
    if (result.error) {
      takeSigningIn();
      setStarting(false);
      setFailed(true);
    }
  };

  const refusal = error === null ? undefined : refusals[error];

  return (
    <main className="sign-in">
      <AppBar title="Overload" slot={<span />} />
      <div className="sign-in__body">
        <p className="sign-in__lede">
          Invite only. Sign in with the Google account you were invited with.
        </p>
        {searchParams.get('deleted') === '1' && (
          <Notice tone="flag" word="Deleted">
            Your account was deleted.
          </Notice>
        )}
        {searchParams.get('wipe') === 'failed' && (
          <Notice tone="flag" word="Saved data">
            Saved data couldn't be cleared from this device.
          </Notice>
        )}
        {refusal !== undefined && (
          <Notice tone="error" word="Refused">
            {refusal}
            {revokedSets === 1 &&
              ' 1 set logged on this device wasn’t saved. It stays on this device until you discard it.'}
            {revokedSets > 1 &&
              ` ${revokedSets} sets logged on this device weren’t saved. They stay on this device until you discard them.`}
          </Notice>
        )}
        {(failed || (error !== null && refusal === undefined)) && (
          <Notice tone="flag" word="Not signed in">
            Sign-in didn’t finish. Check your connection and try again.
          </Notice>
        )}
        <button
          type="button"
          className="button button--primary"
          onClick={() => void signIn()}
          disabled={starting}
        >
          {starting ? 'Opening Google…' : 'Sign in with Google'}
        </button>
      </div>
    </main>
  );
}

/**
 * On a refusal for revoked access, the last account signed in on this device has its unsaved sets
 * marked refused, access revoked (docs/08 §5, docs/09 F4). Answers how many there are.
 */
function useRevokedSets(revoked: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!revoked) return undefined;
    let current = true;
    void deviceStore
      .signedInUser()
      .then((user) => (user === undefined ? 0 : refuseRevokedSets(user.id)))
      .then((refused) => {
        if (current) setCount(refused);
      })
      // A device whose set store cannot be read keeps the sets pending, as they were.
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [revoked]);
  return count;
}
