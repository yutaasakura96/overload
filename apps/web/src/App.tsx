import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { isUnauthenticated } from './api';
import { AppBar, Notice } from './components';
import { safeNext, useLocation } from './navigation';
import { meQuery, useAccount } from './query';
import { ExerciseLibrary } from './screens/ExerciseLibrary';
import { SignIn } from './screens/SignIn';

// /sign-in is open to everyone; every other route needs a member (docs/08 §5).
export function App() {
  const { pathname, searchParams, navigate } = useLocation();
  const me = useQuery(meQuery);
  const account = useAccount();
  const onSignIn = pathname === '/sign-in';
  const signedOut = isUnauthenticated(me.error);
  // The cache renders only as the account it belongs to, once /api/me has confirmed that account
  // this launch, or offline as the last one it confirmed on this device (docs/08 §5, §7).
  const opens =
    me.data !== undefined &&
    me.data.user.id === account.userId &&
    !signedOut &&
    !me.isFetching &&
    (account.status !== 'checking' || me.fetchStatus === 'paused');

  useEffect(() => {
    if (onSignIn && opens) {
      navigate(safeNext(searchParams.get('next')), { replace: true });
    }
    if (!onSignIn && signedOut) {
      navigate(`/sign-in?next=${encodeURIComponent(pathname + window.location.search)}`, {
        replace: true,
      });
    }
  }, [onSignIn, signedOut, opens, pathname, searchParams, navigate]);

  if (onSignIn) return <SignIn searchParams={searchParams} />;
  if (opens) return <ExerciseLibrary me={me.data} navigate={navigate} />;
  if (me.isError && !signedOut) {
    return (
      <main>
        <AppBar title="Overload" slot={<span />} />
        <Notice tone="flag" word="Offline">
          Couldn’t reach Overload. Open the app again when you have signal.
        </Notice>
      </main>
    );
  }
  return <AppBar title="Overload" slot={<span />} />;
}
