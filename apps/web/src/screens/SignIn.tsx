import { useState } from 'react';
import { authClient } from '../auth-client';
import { AppBar, Notice } from '../components';
import { safeNext } from '../navigation';

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

  const signIn = async () => {
    setStarting(true);
    setFailed(false);
    const result = await authClient.signIn
      .social({ provider: 'google', callbackURL: next, errorCallbackURL: '/sign-in' })
      .catch(() => ({ error: true }));
    // On success the browser is already leaving for Google.
    if (result.error) {
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
        {refusal !== undefined && (
          <Notice tone="error" word="Refused">
            {refusal}
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
