import type { Me, Routine, WeightUnit } from '@overload/api-contract';
import { useQuery } from '@tanstack/react-query';
import { useId, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import { AccountFooter, AppBar, DataState, Notice, ScreenTabs } from '../components';
import {
  allExercisesQuery,
  confirmedAccountData,
  lastTimeQuery,
  queryClient,
  refreshLastTime,
  routinesQuery,
  setProfile,
  useAccount,
} from '../query';
import { RefusedSet, setFigures } from '../refused';
import { SaveNotice, saveProblem, useFocusRefused, type SaveProblem } from '../saving';
import { TimezoneField } from '../timezone-field';
import { deviceTimezone } from '../timezones';
import {
  endIdleWorkout,
  exercisesOf,
  finishWorkout,
  loadWorkouts,
  openWorkout,
  readFailedFor,
  recordsLoadedFor,
  recordsOf,
  refusedSets,
  setsOf,
  startWorkout,
  useWorkoutStore,
} from '../workout';

// Today (docs/09 F1, F2, F3): where sign-in lands and a workout starts. A routine starts a workout
// in one tap (S4); one in progress is resumed instead, since only one is open at a time. The
// profile's time zone is the day boundary every local date is read against, and its weight unit is
// how weights are shown (docs/06, 2026-09-23). The meal cards arrive with M2.

const clock = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone }).format(
    new Date(iso),
  );

export function Today({ me, navigate }: { me: Me; navigate: (path: string) => void }) {
  const account = useAccount();
  const confirmed = account.status === 'confirmed';
  const routines = useQuery({ ...routinesQuery, enabled: confirmed });
  const exercises = useQuery({ ...allExercisesQuery, enabled: confirmed });
  // Kept warm here so a start has it offline (S2); `start` reads the cache's copy.
  useQuery({ ...lastTimeQuery, enabled: confirmed && me.profile !== null });
  const userId = me.user.id;
  const loaded = useWorkoutStore((state) => recordsLoadedFor(state, userId));
  const readFailed = useWorkoutStore((state) => readFailedFor(state, userId));
  const records = useWorkoutStore((state) => recordsOf(state, userId));
  const idleEnded = useWorkoutStore((state) =>
    state.userId === userId ? state.idleEnded : undefined,
  );
  const [starting, setStarting] = useState(false);
  const [startFailed, setStartFailed] = useState<'exercises' | 'device'>();
  // The routine tapped while a workout is in progress: one at a time, so it asks first (F3).
  const [asking, setAsking] = useState<string>();

  const timeZone = me.profile?.timezone ?? deviceTimezone();
  const date = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone,
  }).format(new Date());
  const open = openWorkout(records);
  const items = routines.data ?? [];
  // The open workout's refused sets are on its own screen; these have no other place to be seen.
  const refused = refusedSets(records).filter((set) => set.workoutId !== open?.id);
  const top = useRef<HTMLElement>(null);
  const refusedHeading = useRef<HTMLHeadingElement>(null);

  const start = async (routine: Routine, finishFirst = false) => {
    if (exercises.data === undefined) {
      setStartFailed('exercises');
      return;
    }
    if (open !== undefined && !finishFirst) {
      setAsking(routine.id);
      return;
    }
    setStarting(true);
    setStartFailed(undefined);
    try {
      if (finishFirst) await finishWorkout();
      // An answer already on its way is worth a moment: it may carry the workout just finished.
      if (queryClient.isFetching({ queryKey: lastTimeQuery.queryKey }) > 0) {
        await Promise.race([
          refreshLastTime(),
          new Promise((resolve) => setTimeout(resolve, 1500)),
        ]);
      }
      const lastTimes = queryClient.getQueryData(lastTimeQuery.queryKey) ?? [];
      await startWorkout({
        userId: me.user.id,
        routine,
        exercises: new Map(exercises.data.map((exercise) => [exercise.id, exercise])),
        lastTimes: new Map(lastTimes.map((last) => [last.exerciseId, last])),
      });
      navigate('/workout');
    } catch {
      setStartFailed('device');
      setStarting(false);
    }
  };

  return (
    <main ref={top} tabIndex={-1}>
      <AppBar
        title="Today"
        subline={date.toUpperCase()}
        slot={<DataState at={routines.dataUpdatedAt} />}
      />
      <ScreenTabs current="/" navigate={navigate} />

      {idleEnded !== undefined && (
        <output className="empty">
          {idleEnded.name} ended at {clock(idleEnded.endedAt, timeZone)}.
        </output>
      )}

      {startFailed === 'exercises' && (
        <Notice tone="flag" word="Not started">
          Your exercises haven’t loaded on this device yet. Try again when you have signal.
        </Notice>
      )}
      {startFailed === 'device' && (
        <Notice tone="flag" word="Not started">
          Couldn’t save the workout on this device. Try again.
        </Notice>
      )}

      {readFailed && (
        <Notice tone="flag" word="Not read">
          Couldn’t read this device’s sets.{' '}
          <button
            type="button"
            className="button button--tertiary"
            onClick={() =>
              void loadWorkouts(me.user.id)
                .then(() => endIdleWorkout())
                .catch(() => undefined)
            }
          >
            Try again
          </button>
        </Notice>
      )}

      {loaded && refused.length > 0 && (
        <section className="today__section" aria-labelledby="refused-sets">
          <h2 ref={refusedHeading} id="refused-sets" className="section-label" tabIndex={-1}>
            Refused sets
          </h2>
          <ul className="refused-list">
            {refused.map((set) => {
              const exercise = records.find((record) => record.id === set.row.workoutExerciseId);
              const workout = records.find((record) => record.id === set.workoutId);
              const name = exercise?.table === 'workoutExercises' ? exercise.local.name : 'Set';
              const unit = me.profile?.weightUnit ?? 'kg';
              return (
                <li key={set.id} className="refused-list__item">
                  <div className="refused-list__name">{name}</div>
                  <div className="refused-list__meta">
                    {workout?.table === 'workouts' && `${workout.row.name} · `}
                    {setFigures(set, unit)}
                  </div>
                  <RefusedSet
                    set={set}
                    unit={unit}
                    name={`the ${name} set, ${setFigures(set, unit)}`}
                    icon
                    // The list stays while another set is on it; with the last one it goes.
                    onSettled={() => (refused.length > 1 ? refusedHeading : top).current?.focus()}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {loaded && open !== undefined && (
        <section className="today__section" aria-labelledby="in-progress">
          <h2 id="in-progress" className="section-label">
            In progress
          </h2>
          <div className="card card--active">
            <div className="card__title">{open.row.name}</div>
            <div className="card__meta">
              {setCount(records, open.id)} · STARTED {clock(open.row.startedAt, timeZone)}
            </div>
            <a
              href="/workout"
              className="button button--primary"
              onClick={(event) => {
                event.preventDefault();
                navigate('/workout');
              }}
            >
              Resume workout
            </a>
          </div>
        </section>
      )}

      {loaded && routines.isError && routines.data === undefined && (
        <Notice tone="flag" word="Not updated">
          Couldn’t reach Overload. Try again when you have signal.
        </Notice>
      )}

      {loaded && open === undefined && routines.data !== undefined && items.length === 0 && (
        <section className="empty-state" aria-labelledby="no-routines">
          <h2 id="no-routines" className="empty-state__title">
            No routines yet
          </h2>
          <p className="empty-state__body">
            A routine is the exercises you do together, in order, like Push A. Make one and starting
            a workout becomes one tap.
          </p>
          <button
            type="button"
            className="button button--primary"
            onClick={() => navigate('/routines/new')}
          >
            Create a routine
          </button>
        </section>
      )}

      {loaded && items.length > 0 && (
        <section className="today__section" aria-labelledby="start-heading">
          <h2 id="start-heading" className="section-label">
            Start a workout
          </h2>
          <ul className="starts">
            {items.map((routine) => (
              <li key={routine.id}>
                <button
                  type="button"
                  className="starts__row"
                  disabled={starting}
                  onClick={() => void start(routine)}
                >
                  <span className="routines__text">
                    <span className="routines__name">{routine.name}</span>
                    <span className="routines__meta">
                      {routine.exercises.length}{' '}
                      {routine.exercises.length === 1 ? 'EXERCISE' : 'EXERCISES'} ·{' '}
                      {routine.exercises.reduce((sum, slot) => sum + slot.targetSets, 0)} SETS
                    </span>
                  </span>
                  <span className="starts__go" aria-hidden="true">
                    START
                  </span>
                  <span className="visually-hidden">. Start this workout</span>
                </button>
                {asking === routine.id && open !== undefined && (
                  <fieldset className="confirm confirm--row">
                    <legend className="confirm__question">Finish {open.row.name} first?</legend>
                    <div className="confirm__actions">
                      <button
                        type="button"
                        className="button button--tertiary"
                        disabled={starting}
                        onClick={() => navigate('/workout')}
                      >
                        Resume
                      </button>
                      <button
                        type="button"
                        className="button button--secondary"
                        disabled={starting}
                        onClick={() => void start(routine, true)}
                      >
                        Finish
                      </button>
                    </div>
                  </fieldset>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <ProfileForm key={me.user.id} me={me} />

      <AccountFooter email={me.user.email} navigate={navigate} />
    </main>
  );
}

function setCount(records: Parameters<typeof exercisesOf>[0], workoutId: string) {
  const count = exercisesOf(records, workoutId).reduce(
    (sum, exercise) => sum + setsOf(records, exercise.id).length,
    0,
  );
  return `${count} ${count === 1 ? 'SET' : 'SETS'}`;
}

/**
 * The two profile fields this slice reads: the time zone and the weight unit. Until it is saved
 * once, the profile does not exist and the form says what it is for. Saved online only, like
 * routines: nothing here is queued (docs/06, offline scope).
 */
function ProfileForm({ me }: { me: Me }) {
  const exists = me.profile !== null;
  const [timezone, setTimezone] = useState(me.profile?.timezone ?? deviceTimezone());
  const [weightUnit, setWeightUnit] = useState<WeightUnit>(me.profile?.weightUnit ?? 'kg');
  // A profile changed elsewhere arrives with a later account check: a field still showing the
  // profile's value follows it, and one being edited is left alone.
  const [shown, setShown] = useState(me.profile);
  if (me.profile !== shown) {
    setShown(me.profile);
    if (me.profile !== null) {
      if (timezone === (shown?.timezone ?? deviceTimezone())) setTimezone(me.profile.timezone);
      if (weightUnit === (shown?.weightUnit ?? 'kg')) setWeightUnit(me.profile.weightUnit);
    }
  }
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState<SaveProblem>();
  const form = useFocusRefused(problem);
  const heading = useId();
  const unitName = useId();

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setSaved(false);
    setProblem(undefined);
    try {
      const profile = await confirmedAccountData(() =>
        api.PATCH('/api/me/profile', { body: { timezone, weightUnit } }),
      );
      setProfile(profile);
      void refreshLastTime();
      setSaved(true);
    } catch (error) {
      setProblem(saveProblem(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby={heading}>
      <form ref={form} className="form form--secondary" onSubmit={(event) => void save(event)}>
        <h2 id={heading} className="section-label">
          {exists ? 'Profile' : 'Set up your profile'}
        </h2>
        {!exists && (
          <p className="form__lede">
            Days are counted in your time zone, and weights are shown in your unit. Check both and
            save.
          </p>
        )}
        <SaveNotice problem={problem} what="profile" />
        <TimezoneField
          label="Time zone"
          value={timezone}
          onChange={(zone) => {
            setTimezone(zone);
            setSaved(false);
          }}
          error={problem?.kind === 'refused' ? problem.fields.get('timezone') : undefined}
        />
        <fieldset className="segments">
          <legend className="field__label">Weights shown in</legend>
          {(['kg', 'lb'] as const).map((unit) => (
            <label key={unit} className="segments__segment">
              <input
                type="radio"
                name={unitName}
                value={unit}
                checked={weightUnit === unit}
                onChange={() => {
                  setWeightUnit(unit);
                  setSaved(false);
                }}
              />
              {unit === 'kg' ? 'Kilograms' : 'Pounds'}
            </label>
          ))}
        </fieldset>
        <button type="submit" className="button button--secondary" disabled={saving}>
          {exists ? 'Save profile' : 'Save and finish setup'}
        </button>
        {saved && <output className="form__lede">Saved.</output>}
      </form>
    </section>
  );
}
