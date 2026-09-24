import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { isUnauthenticated } from './api';
import { AppBar, Notice } from './components';
import { safeNext, useLocation } from './navigation';
import { meQuery } from './query';
import { ExerciseLibrary } from './screens/ExerciseLibrary';
import { SignIn } from './screens/SignIn';

// /sign-in is open to everyone; every other route needs a member (docs/08 §5).
export function App() {
  const { pathname, searchParams, navigate } = useLocation();
  const me = useQuery(meQuery);
  const onSignIn = pathname === '/sign-in';
  const signedOut = isUnauthenticated(me.error);

  useEffect(() => {
    if (onSignIn && me.data !== undefined && !signedOut) {
      navigate(safeNext(searchParams.get('next')), { replace: true });
    }
    if (!onSignIn && signedOut) {
      navigate(`/sign-in?next=${encodeURIComponent(pathname + window.location.search)}`, {
        replace: true,
      });
    }
  }, [onSignIn, signedOut, me.data, pathname, searchParams, navigate]);

  if (onSignIn) return <SignIn searchParams={searchParams} />;
  if (me.data !== undefined && !signedOut)
    return <ExerciseLibrary me={me.data} navigate={navigate} />;
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
