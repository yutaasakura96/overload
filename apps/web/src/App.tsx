import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { isUnauthenticated } from './api';
import { AppBar, Notice } from './components';
import { routeOf, safeNext, useLocation } from './navigation';
import { meQuery, useAccount } from './query';
import { ExerciseScreen } from './screens/ExerciseForm';
import { ExerciseLibrary } from './screens/ExerciseLibrary';
import { Progress } from './screens/Progress';
import { RoutineScreen } from './screens/RoutineEditor';
import { RoutineList } from './screens/RoutineList';
import { SignIn } from './screens/SignIn';
import { Today } from './screens/Today';
import { Workout } from './screens/Workout';
import { endIdleWorkout, loadWorkouts } from './workout';

// /sign-in is open to everyone; every other route needs a member (docs/08 §5).
export function App() {
  const { pathname, searchParams, navigate } = useLocation();
  const me = useQuery(meQuery);
  const account = useAccount();
  const onSignIn = pathname === '/sign-in';
  const signedOut = isUnauthenticated(me.error);
  // The cache renders only as the account it belongs to, once /api/me has confirmed that account
  // this launch, or offline as the last one it confirmed on this device (docs/08 §5, §7). An account
  // already open stays on screen while a later check runs: only an answer that ends the session or
  // names another account takes its screen away.
  const [openedAs, setOpenedAs] = useState<string>();
  const shownAs =
    me.data !== undefined && me.data.user.id === account.userId && !signedOut
      ? me.data.user.id
      : undefined;
  const answered = !me.isFetching && (account.status !== 'checking' || me.fetchStatus === 'paused');
  const opens =
    me.data !== undefined && shownAs !== undefined && (answered || shownAs === openedAs);
  if (opens && openedAs !== shownAs) setOpenedAs(shownAs);

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

  // The open workout is rebuilt from the set store at every launch, with or without signal, and a
  // workout idle for 3 hours is ended on the device as the app opens or comes back (docs/09 F3).
  const userId = opens ? me.data.user.id : undefined;
  useEffect(() => {
    if (userId === undefined) return undefined;
    // A workout the device could not end stays in progress; coming back to the app tries again.
    void loadWorkouts(userId)
      .then(() => endIdleWorkout())
      .catch(() => undefined);
    const onReturn = () => {
      if (document.visibilityState === 'visible') void endIdleWorkout().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onReturn);
    return () => document.removeEventListener('visibilitychange', onReturn);
  }, [userId]);

  if (onSignIn) return <SignIn searchParams={searchParams} />;
  if (opens) {
    const route = routeOf(pathname);
    if (route.screen === 'workout') return <Workout me={me.data} navigate={navigate} />;
    if (route.screen === 'routines') return <RoutineList me={me.data} navigate={navigate} />;
    if (route.screen === 'routine') return <RoutineScreen id={route.id} navigate={navigate} />;
    if (route.screen === 'exercise') return <ExerciseScreen id={route.id} navigate={navigate} />;
    if (route.screen === 'progress')
      return (
        <Progress
          key={route.id}
          id={route.id}
          me={me.data}
          searchParams={searchParams}
          navigate={navigate}
        />
      );
    if (route.screen === 'library') return <ExerciseLibrary me={me.data} navigate={navigate} />;
    return <Today me={me.data} navigate={navigate} />;
  }
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
