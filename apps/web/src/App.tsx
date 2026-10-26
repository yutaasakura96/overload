import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { isUnauthenticated } from './api';
import { AppBar, Notice } from './components';
import { routeOf, safeNext, useLocation } from './navigation';
import { meQuery, useAccount } from './query';
import { ExerciseScreen } from './screens/ExerciseForm';
import { AboutYou } from './screens/AboutYou';
import { AddFood } from './screens/AddFood';
import { EndOfDay } from './screens/EndOfDay';
import { ExerciseLibrary } from './screens/ExerciseLibrary';
import { FoodBarcode } from './screens/FoodBarcode';
import { FoodCheck, FoodEdit } from './screens/FoodCheck';
import { FoodLabel } from './screens/FoodLabel';
import { FoodPage } from './screens/FoodPage';
import { GoalPhaseScreen } from './screens/GoalPhase';
import { Foods } from './screens/Foods';
import { History } from './screens/History';
import { Invites } from './screens/Invites';
import { MealAdjust } from './screens/MealAdjust';
import { MealReplace } from './screens/MealReplace';
import { PastWorkout } from './screens/PastWorkout';
import { Progress } from './screens/Progress';
import { Balance } from './screens/Balance';
import { Batches, RecordBatch } from './screens/Batches';
import { Grocery, Prep } from './screens/Prep';
import { RoutineScreen } from './screens/RoutineEditor';
import { RoutineList } from './screens/RoutineList';
import { RotationGroups } from './screens/RotationGroups';
import { SignIn } from './screens/SignIn';
import { Strength } from './screens/Strength';
import { Today } from './screens/Today';
import { WeighIn } from './screens/WeighIn';
import { Weight } from './screens/Weight';
import { Workout } from './screens/Workout';
import { YourDay } from './screens/YourDay';
import { YourData } from './screens/YourData';
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
    if (route.screen === 'workout')
      return <Workout me={me.data} navigate={navigate} guide={route.guide} />;
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
    if (route.screen === 'history') return <History me={me.data} navigate={navigate} />;
    if (route.screen === 'strength')
      return <Strength me={me.data} searchParams={searchParams} navigate={navigate} />;
    if (route.screen === 'balance')
      return <Balance me={me.data} searchParams={searchParams} navigate={navigate} />;
    if (route.screen === 'weight') return <Weight me={me.data} navigate={navigate} />;
    if (route.screen === 'weigh-in') return <WeighIn me={me.data} navigate={navigate} />;
    if (route.screen === 'prep') return <Prep me={me.data} navigate={navigate} />;
    if (route.screen === 'grocery') return <Grocery me={me.data} navigate={navigate} />;
    if (route.screen === 'foods') return <Foods me={me.data} navigate={navigate} />;
    if (route.screen === 'batches') return <Batches me={me.data} navigate={navigate} />;
    if (route.screen === 'batch-new')
      return <RecordBatch me={me.data} searchParams={searchParams} navigate={navigate} />;
    if (route.screen === 'food')
      return <FoodPage key={route.id} id={route.id} navigate={navigate} />;
    if (route.screen === 'food-edit')
      return <FoodEdit key={route.id} id={route.id} navigate={navigate} />;
    if (route.screen === 'food-add') return <AddFood navigate={navigate} />;
    if (route.screen === 'food-barcode') return <FoodBarcode navigate={navigate} />;
    if (route.screen === 'food-label') return <FoodLabel navigate={navigate} />;
    if (route.screen === 'food-check') return <FoodCheck navigate={navigate} />;
    if (route.screen === 'rotation-groups') return <RotationGroups navigate={navigate} />;
    if (route.screen === 'about-you') return <AboutYou me={me.data} navigate={navigate} />;
    if (route.screen === 'goal-phase') return <GoalPhaseScreen me={me.data} navigate={navigate} />;
    if (route.screen === 'your-day') return <YourDay me={me.data} navigate={navigate} />;
    if (route.screen === 'end-of-day')
      return <EndOfDay key={route.date} me={me.data} date={route.date} navigate={navigate} />;
    if (route.screen === 'meal-adjust' || route.screen === 'meal-replace') {
      const date = searchParams.get('date');
      if (date === null) return <NotFound navigate={navigate} />;
      const Screen = route.screen === 'meal-adjust' ? MealAdjust : MealReplace;
      return (
        <Screen key={route.id} me={me.data} date={date} mealId={route.id} navigate={navigate} />
      );
    }
    if (route.screen === 'invites') {
      // A member gets the not-found screen, not a forbidden one (docs/08 §5).
      if (!me.data.isAdmin) return <NotFound navigate={navigate} />;
      return <Invites me={me.data} navigate={navigate} />;
    }
    if (route.screen === 'account') return <YourData me={me.data} navigate={navigate} />;
    if (route.screen === 'past-workout')
      return <PastWorkout key={route.id} id={route.id} me={me.data} navigate={navigate} />;
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

/** The app's not-found screen: says nothing about what might be at the address. */
function NotFound({ navigate }: { navigate: (path: string) => void }) {
  return (
    <main>
      <AppBar title="Not found" slot={<span />} />
      <section className="empty-state" aria-labelledby="not-found">
        <h2 id="not-found" className="empty-state__title">
          Nothing is here
        </h2>
        <p className="empty-state__body">This address is not a screen of Overload.</p>
        <button type="button" className="button button--primary" onClick={() => navigate('/')}>
          Go to Today
        </button>
      </section>
    </main>
  );
}
