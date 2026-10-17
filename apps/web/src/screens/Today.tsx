import type {
  CurrentTargets,
  DayType,
  GoalPhase,
  Me,
  PlanDay,
  Routine,
  WeightUnit,
} from '@overload/api-contract';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import {
  AccountFooter,
  AppBar,
  CheckIcon,
  Chevron,
  DataState,
  Notice,
  ScreenTabs,
  TextField,
} from '../components';
import { agoLabel, dayLabel, localDate, minutesBetween } from '../dates';
import { historyOnDevice, removedOnDevice } from '../history';
import { useEntryNote, type Navigate } from '../navigation';
import { phaseLine } from '../plan';
import { DayTotals, PlanSkeleton, Shortfalls, Timeline } from '../plan-day';
import {
  addLocalDays,
  allExercisesQuery,
  confirmedAccountData,
  currentTargetsQuery,
  dayRoutinesQuery,
  foodsQuery,
  goalPhasesQuery,
  lastDoneQuery,
  lastTimeQuery,
  planDaysQuery,
  planToday,
  queryClient,
  refreshLastTime,
  regeneratePlan,
  routinesQuery,
  setProfile,
  useAccount,
  weighInsQuery,
  workoutsQuery,
} from '../query';
import { RefusedSet, setFigures } from '../refused';
import { SaveNotice, saveProblem, useFocusRefused, type SaveProblem } from '../saving';
import type { WorkoutRecord } from '../set-store';
import { ThemeField } from '../theme-field';
import { TimezoneField } from '../timezone-field';
import { deviceTimezone } from '../timezones';
import {
  EMPTY_WORKOUT_NAME,
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
  startEmptyWorkout,
  startWorkout,
  useWorkoutStore,
} from '../workout';

// Today (docs/09 F1, F2, F3): where sign-in lands and a workout starts. A routine starts a workout
// in one tap (S4), and an empty workout starts from no routine; one in progress is resumed instead,
// since only one is open at a time. The
// profile's time zone is the day boundary every local date is read against, and its weight unit is
// how weights are shown (docs/06, 2026-09-23). The last workout is the way into History from here
// (docs/10 §9). Today is the whole day (docs/10 §3, Q7): once the plan is set up, the day's meals
// as a timeline with the workout marked in it, and until then the first setup step missing
// (docs/09 F10).

const clock = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone }).format(
    new Date(iso),
  );

export function Today({ me, navigate }: { me: Me; navigate: Navigate }) {
  const account = useAccount();
  const confirmed = account.status === 'confirmed';
  const routines = useQuery({ ...routinesQuery, enabled: confirmed });
  const exercises = useQuery({ ...allExercisesQuery, enabled: confirmed });
  // Kept warm here so a start has it offline (S2); `start` reads the cache's copy.
  useQuery({ ...lastTimeQuery, enabled: confirmed && me.profile !== null });
  const history = useInfiniteQuery({ ...workoutsQuery, enabled: confirmed });
  const lastDone = useQuery({ ...lastDoneQuery, enabled: confirmed });
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
  // The newest finished workout, as the device has it: one just finished is here before it uploads.
  const pages = history.data?.pages;
  const finished =
    pages === undefined
      ? []
      : historyOnDevice(
          {
            items: pages.flatMap((page) => page.items),
            total: pages[0]?.total ?? 0,
            more: history.hasNextPage,
          },
          records,
        ).items;
  const [latest] = finished;
  // When each routine was last done: the server's answer, with a workout finished here laid over
  // it. One whose answer the device has since deleted is not known again until the server says.
  const doneAt = new Map<string, string>();
  const unknown = new Set<string>();
  for (const last of lastDone.data ?? []) {
    if (removedOnDevice(records, last.workoutId)) unknown.add(last.routineId);
    else doneAt.set(last.routineId, last.startedAt);
  }
  for (const workout of finished) {
    if (workout.routineId == null) continue;
    const known = doneAt.get(workout.routineId);
    if (known !== undefined && Date.parse(known) >= Date.parse(workout.startedAt)) continue;
    doneAt.set(workout.routineId, workout.startedAt);
    unknown.delete(workout.routineId);
  }
  const top = useRef<HTMLElement>(null);
  const refusedHeading = useRef<HTMLHeadingElement>(null);

  const plan = usePlan(me, confirmed);
  const note = useEntryNote();
  // The day's routine is the one done longest ago, never done first: the next in the rotation. It
  // is started from its place in the timeline, and the others are listed under the day (Q5).
  const dayRoutine = items
    .map((routine, index) => ({ routine, index, at: doneAt.get(routine.id) }))
    .toSorted(
      (a, b) =>
        (a.at === undefined ? 0 : Date.parse(a.at)) - (b.at === undefined ? 0 : Date.parse(b.at)) ||
        a.index - b.index,
    )[0]?.routine;
  const doneToday = finished.find(
    (workout) => localDate(workout.startedAt, timeZone) === plan.today,
  );
  const trainingDay = plan.day?.dayType === 'training';
  const inTimeline = plan.day !== undefined && trainingDay && plan.trainingTime !== null;
  const others =
    inTimeline && doneToday === undefined && open === undefined
      ? items.filter((routine) => routine.id !== dayRoutine?.id)
      : items;

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
      if (queryClient.isFetching({ queryKey: lastTimeQuery.queryKey, exact: true }) > 0) {
        await Promise.race([
          queryClient.fetchQuery({ ...lastTimeQuery, staleTime: 0 }).catch(() => undefined),
          new Promise((resolve) => setTimeout(resolve, 1500)),
        ]);
      }
      const lastTimes = queryClient.getQueryData(lastTimeQuery.queryKey);
      await startWorkout({
        userId: me.user.id,
        routine,
        exercises: new Map(exercises.data.map((exercise) => [exercise.id, exercise])),
        lastTimes: lastTimes && new Map(lastTimes.map((last) => [last.exerciseId, last])),
        lastTimesAt: queryClient.getQueryState(lastTimeQuery.queryKey)?.dataUpdatedAt,
        timeZone,
      });
      navigate('/workout');
    } catch {
      setStartFailed('device');
      setStarting(false);
    }
  };

  const startEmpty = async (name: string) => {
    setStarting(true);
    setStartFailed(undefined);
    try {
      await startEmptyWorkout({ userId: me.user.id, name, timeZone });
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
        subline={
          plan.day === undefined
            ? date.toUpperCase()
            : `${date.toUpperCase()} · ${trainingDay ? 'TRAINING DAY' : 'REST DAY'}`
        }
        slot={<DataState at={routines.dataUpdatedAt} />}
      />
      <ScreenTabs current="/" navigate={navigate} />

      {note === 'plan-saved' && (
        <output className="saved-line">
          <CheckIcon size={13} color="var(--done)" />
          {plan.step === undefined ? 'Saved. The week’s plan is made again from it.' : 'Saved.'}
        </output>
      )}
      {plan.step !== undefined && (
        <SetupStep step={plan.step} done={plan.done} navigate={navigate} />
      )}
      {plan.step === undefined && (plan.generating || plan.reading) && plan.day === undefined && (
        <PlanSkeleton />
      )}
      {/* Mounted throughout, so making the plan and its arrival are both said (a failure is the
          notice's own). */}
      <p className="visually-hidden" aria-live="polite">
        {plan.generating ? 'Making today’s plan.' : plan.made ? 'Today’s plan is ready.' : ''}
      </p>
      {plan.step === undefined && plan.failed && plan.day === undefined && (
        <Notice tone="flag" word="No plan yet">
          Couldn’t make today’s plan. Try again when you have signal.
        </Notice>
      )}
      {plan.day !== undefined && (
        <>
          <DayTotals day={plan.day} />
          <Shortfalls day={plan.day} navigate={navigate} />
        </>
      )}

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

      {plan.day !== undefined && (
        <section className="today__section today__section--timeline" aria-labelledby="the-day">
          <h2 id="the-day" className="section-label">
            The day
          </h2>
          <Timeline
            day={plan.day}
            now={clock(new Date().toISOString(), timeZone)}
            workout={
              inTimeline && plan.trainingTime !== null && loaded
                ? {
                    time: plan.trainingTime,
                    node: (
                      <WorkoutSlot
                        routine={
                          doneToday === undefined && open === undefined ? dayRoutine : undefined
                        }
                        open={open?.row.name}
                        done={
                          doneToday === undefined
                            ? undefined
                            : { name: doneToday.name, at: clock(doneToday.startedAt, timeZone) }
                        }
                        lastDone={dayRoutine === undefined ? undefined : doneAt.get(dayRoutine.id)}
                        timeZone={timeZone}
                        starting={starting}
                        onStart={(routine) => void start(routine)}
                        onResume={() => navigate('/workout')}
                        onCreate={() => navigate('/routines/new')}
                      />
                    ),
                  }
                : undefined
            }
          />
          {plan.day.meals.some((meal) => meal.items.some((item) => item.approximate)) && (
            <p className="plan__footnote">
              A cooked weight marked approx. uses the food table’s cooked values, because no batch
              of it has been weighed yet. Weighing a batch, raw and cooked, makes it exact.
            </p>
          )}
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
            a workout becomes one tap. Or start an empty workout and add exercises as you go.
          </p>
          <button
            type="button"
            className="button button--primary"
            onClick={() => navigate('/routines/new')}
          >
            Create a routine
          </button>
          <EmptyStart
            variant="button"
            open={undefined}
            starting={starting}
            onStart={(name) => void startEmpty(name)}
            onResume={() => navigate('/workout')}
          />
        </section>
      )}

      {loaded && items.length > 0 && (
        <section className="today__section" aria-labelledby="start-heading">
          <h2 id="start-heading" className="section-label">
            {plan.day === undefined
              ? 'Start a workout'
              : trainingDay
                ? 'Or start another workout'
                : 'Rest day. Start a workout anyway'}
          </h2>
          <ul className="starts">
            {others.map((routine) => (
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
                    <LastDone
                      startedAt={doneAt.get(routine.id)}
                      known={lastDone.data !== undefined && !unknown.has(routine.id)}
                      timeZone={timeZone}
                    />
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
            <li>
              <EmptyStart
                variant="row"
                open={open}
                starting={starting}
                onStart={(name) => void startEmpty(name)}
                onResume={() => navigate('/workout')}
              />
            </li>
          </ul>
        </section>
      )}

      {plan.step === undefined && plan.phase !== undefined && (
        <YourPlan
          phaseLine={phaseLine(plan.phase, plan.today)}
          targets={plan.targets}
          routines={plan.mealCounts}
          navigate={navigate}
        />
      )}

      {loaded && latest !== undefined && (
        <section className="today__section" aria-labelledby="last-workout">
          <h2 id="last-workout" className="section-label">
            Last workout
          </h2>
          <a
            href={`/workouts/${latest.id}`}
            className="link-row link-row--flush"
            onClick={(event) => {
              event.preventDefault();
              navigate(`/workouts/${latest.id}`, { returns: true });
            }}
          >
            <span>
              <span className="link-row__name">
                {latest.name} · {dayLabel(latest.startedAt, timeZone)}
              </span>
              <span className="link-row__meta">
                {latest.workingSets} {latest.workingSets === 1 ? 'working set' : 'working sets'} ·{' '}
                {minutesBetween(latest.startedAt, latest.endedAt)} min ·{' '}
                {agoLabel(latest.startedAt, timeZone)}
              </span>
            </span>
            <Chevron direction="forward" />
          </a>
        </section>
      )}

      <ProfileForm key={me.user.id} me={me} />

      <ThemeField />

      <AccountFooter email={me.user.email} admin={me.isAdmin} navigate={navigate} />
    </main>
  );
}

/** The prototype's line under a routine: when it was last done, or that it has not been. */
function LastDone({
  startedAt,
  known,
  timeZone,
}: {
  startedAt: string | undefined;
  known: boolean;
  timeZone: string;
}) {
  if (startedAt !== undefined) {
    return (
      <span className="routines__preview">
        Last done {dayLabel(startedAt, timeZone)}, {agoLabel(startedAt, timeZone)}
      </span>
    );
  }
  // Said only once the server has answered, or it would be wrong for a while.
  return known ? <span className="routines__preview">Not done yet</span> : null;
}

/** The longest name a workout takes (docs/07 §3.4). */
const NAME_MAX = 80;

/**
 * Starting an empty workout (docs/09 F2 step 3, docs/10 §8.2): it opens a name in place, which
 * defaults to `Workout` left empty, then the workout with no exercises. With one in progress it asks
 * first, as a routine does: one workout at a time (docs/09 F3).
 */
function EmptyStart({
  variant,
  open,
  starting,
  onStart,
  onResume,
}: {
  /** A row of the start list, or the no-routines empty state's second button. */
  variant: 'row' | 'button';
  open: WorkoutRecord | undefined;
  starting: boolean;
  onStart: (name: string) => void;
  onResume: () => void;
}) {
  const [step, setStep] = useState<'closed' | 'asking' | 'naming'>('closed');
  const [name, setName] = useState('');
  const [tooLong, setTooLong] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finishFailed, setFinishFailed] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const question = useId();
  // Cancel gives focus back to what opened the name; set by that tap only.
  const focusOpener = useRef(false);
  useEffect(() => {
    if (step !== 'closed' || !focusOpener.current) return;
    focusOpener.current = false;
    opener.current?.focus();
  }, [step]);

  const tap = () => {
    if (step !== 'closed') {
      setStep('closed');
      return;
    }
    setStep(open === undefined ? 'naming' : 'asking');
  };

  const finishFirst = async () => {
    setFinishing(true);
    setFinishFailed(false);
    try {
      await finishWorkout();
      setStep('naming');
    } catch {
      setFinishFailed(true);
    } finally {
      setFinishing(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim().length > NAME_MAX) {
      setTooLong(true);
      return;
    }
    onStart(name);
  };

  const busy = starting || finishing;
  return (
    <>
      {variant === 'row' ? (
        <button
          ref={opener}
          type="button"
          className="starts__row"
          disabled={busy}
          aria-expanded={step !== 'closed'}
          onClick={tap}
        >
          <span className="routines__text">
            <span className="routines__name">Empty workout</span>
            <span className="routines__meta">NO ROUTINE</span>
            <span className="routines__preview">Add exercises as you go</span>
          </span>
          <span className="starts__go" aria-hidden="true">
            START
          </span>
          <span className="visually-hidden">. Start an empty workout</span>
        </button>
      ) : (
        <button
          ref={opener}
          type="button"
          className="button button--secondary"
          disabled={busy}
          aria-expanded={step !== 'closed'}
          onClick={tap}
        >
          Start an empty workout
        </button>
      )}
      {step === 'asking' && open !== undefined && (
        <fieldset className={variant === 'row' ? 'confirm confirm--row' : 'confirm'}>
          <legend className="confirm__question">Finish {open.row.name} first?</legend>
          {finishFailed && (
            <Notice tone="flag" word="Not finished">
              Couldn’t save that on this device. Try again.
            </Notice>
          )}
          <div className="confirm__actions">
            <button
              type="button"
              className="button button--tertiary"
              disabled={busy}
              onClick={onResume}
            >
              Resume
            </button>
            <button
              type="button"
              className="button button--secondary"
              disabled={busy}
              onClick={() => void finishFirst()}
            >
              Finish
            </button>
          </div>
        </fieldset>
      )}
      {step === 'naming' && (
        <form
          className={variant === 'row' ? 'confirm confirm--row' : 'confirm'}
          aria-labelledby={question}
          noValidate
          onSubmit={submit}
        >
          <p id={question} className="confirm__question">
            Start an empty workout. Name it, or leave it as {EMPTY_WORKOUT_NAME}.
          </p>
          <TextField
            label="Workout name"
            value={name}
            onChange={(value) => {
              setName(value);
              setTooLong(false);
            }}
            placeholder={EMPTY_WORKOUT_NAME}
            error={tooLong ? `Shorten it to ${NAME_MAX} characters or fewer` : undefined}
            focusOnOpen
          />
          <div className="confirm__actions">
            <button
              type="button"
              className="button button--tertiary"
              disabled={busy}
              onClick={() => {
                focusOpener.current = true;
                setStep('closed');
              }}
            >
              Cancel
            </button>
            <button type="submit" className="button button--secondary" disabled={busy}>
              Start workout
            </button>
          </div>
        </form>
      )}
    </>
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

/** The first-run steps, in the order Today asks for them (docs/09 F10, docs/10 §3). */
const SETUP = [
  {
    key: 'profile',
    name: 'About you',
    title: 'First, a little about you',
    body: 'Your height, sex and birth date set the starting calories, and your weight sets protein. Asked once.',
    action: 'Add your details',
    path: '/plan/about',
  },
  {
    key: 'foods',
    name: 'Your foods',
    title: 'The plan is built from your foods',
    body: 'Add the foods you eat, starting with a protein source. The planner only ever plans from your list.',
    action: 'Add a food',
    path: '/food/new',
  },
  {
    key: 'phase',
    name: 'Goal phase',
    title: 'Set your goal phase',
    body: 'Cut, maintain or bulk, and how fast. That sets your daily calories and protein, each default with its source.',
    action: 'Set your goal',
    path: '/plan/phase',
  },
  {
    key: 'routine',
    name: 'Your day',
    title: 'Tell the plan your day',
    body: 'Wake time, work hours, training days and time, and bedtime. The plan cannot place meals without them.',
    action: 'Set your day',
    path: '/plan/day',
  },
] as const;

type SetupKey = (typeof SETUP)[number]['key'];

/**
 * The plan as Today reads it: which setup steps are done, and once all four are, the week from
 * today, made when any of its days is missing (docs/09 F10 step 4, F11 step 1).
 */
function usePlan(me: Me, confirmed: boolean) {
  const profile = me.profile;
  const timeZone = profile?.timezone ?? deviceTimezone();
  const today = planToday(timeZone);
  const weighIns = useQuery({ ...weighInsQuery, enabled: confirmed && profile !== null });
  const foods = useQuery({ ...foodsQuery, enabled: confirmed });
  const phases = useQuery({ ...goalPhasesQuery, enabled: confirmed });
  const routines = useQuery({ ...dayRoutinesQuery, enabled: confirmed });
  const phase: GoalPhase | undefined = phases.data?.find((each) => each.endedOn === null);
  const weekdays = profile?.trainingWeekdays ?? [];
  const needed: DayType[] = [
    ...(weekdays.length > 0 ? (['training'] as const) : []),
    ...(weekdays.length < 7 ? (['rest'] as const) : []),
  ];
  const done: Record<SetupKey, boolean> = {
    profile:
      profile != null &&
      profile.heightCm !== null &&
      profile.sex !== null &&
      profile.birthDate !== null &&
      (weighIns.data?.weighIns.length ?? 0) > 0,
    foods: (foods.data?.filter((each) => each.archivedAt === null).length ?? 0) > 0,
    phase: phase !== undefined,
    routine: needed.every((type) => routines.data?.some((each) => each.dayType === type) === true),
  };
  const known =
    foods.data !== undefined &&
    phases.data !== undefined &&
    routines.data !== undefined &&
    (profile == null || weighIns.data !== undefined);
  const step = known ? SETUP.find((each) => !done[each.key]) : undefined;
  const ready = known && step === undefined;

  const to = addLocalDays(today, 6);
  const days = useQuery({ ...planDaysQuery(today, to), enabled: confirmed && ready });
  const targets = useQuery({ ...currentTargetsQuery, enabled: confirmed && ready });
  const [generating, setGenerating] = useState(false);
  const [failed, setFailed] = useState(false);
  const [made, setMade] = useState(false);
  const attempted = useRef<string>(undefined);
  const missing = days.data?.missing.length ?? 0;
  useEffect(() => {
    if (missing === 0 || attempted.current === today) return;
    attempted.current = today;
    setGenerating(true);
    setFailed(false);
    void regeneratePlan()
      .then(() => queryClient.fetchQuery({ ...planDaysQuery(today, to), staleTime: 0 }))
      .then((read) => {
        const none = read.days.every((day) => day.date !== today);
        setFailed(none);
        setMade(!none);
      })
      .catch(() => setFailed(true))
      .finally(() => setGenerating(false));
  }, [missing, today, to]);

  return {
    today,
    step: step === undefined ? undefined : { ...step, number: SETUP.indexOf(step) + 1 },
    done,
    day: ready ? days.data?.days.find((day: PlanDay) => day.date === today) : undefined,
    generating,
    // Ready, with the week still being read: the skeleton holds its place.
    reading: ready && days.isPending,
    made,
    failed,
    phase,
    targets: targets.data,
    mealCounts:
      routines.data?.map((each) => ({ dayType: each.dayType, meals: each.mealCount })) ?? [],
    trainingTime: routines.data?.find((each) => each.dayType === 'training')?.trainingTime ?? null,
  };
}

/** The first setup step missing as Today's empty state, then the four with a check for each done. */
function SetupStep({
  step,
  done,
  navigate,
}: {
  step: (typeof SETUP)[number] & { number: number };
  done: Record<SetupKey, boolean>;
  navigate: Navigate;
}) {
  const heading = useId();
  return (
    <>
      <section className="empty-state" aria-labelledby={heading}>
        <span className="m2-step">STEP {step.number} OF 4 · YOUR MEAL PLAN</span>
        <h2 id={heading} className="empty-state__title">
          {step.title}
        </h2>
        <p className="empty-state__body">{step.body}</p>
        <button
          type="button"
          className="button button--primary"
          onClick={() => navigate(step.path, { returns: true })}
        >
          {step.action}
        </button>
      </section>
      <ol className="m2-steps" aria-label="Your meal plan, four steps">
        {SETUP.map((each) => (
          <li
            key={each.key}
            className={done[each.key] ? 'm2-steps__item m2-steps__item--done' : 'm2-steps__item'}
          >
            {done[each.key] ? (
              <CheckIcon size={13} color="var(--done)" />
            ) : (
              <span className="m2-steps__ring" aria-hidden="true" />
            )}
            {each.name}
            <span className="visually-hidden">{done[each.key] ? ', done' : ', to do'}</span>
          </li>
        ))}
      </ol>
    </>
  );
}

/** A workout entry's heading, beside the meals' own, so heading navigation reaches it too. */
function SlotHeading({ name }: { name: string }) {
  return (
    <h3 className="workout-slot__heading">
      <span className="workout-slot__label">Workout</span>
      <span className="visually-hidden">: </span>
      <span className="workout-slot__name">{name}</span>
    </h3>
  );
}

/** The workout's place in the timeline: the day's routine to start, or the one in progress or done. */
function WorkoutSlot({
  routine,
  open,
  done,
  lastDone,
  timeZone,
  starting,
  onStart,
  onResume,
  onCreate,
}: {
  routine: Routine | undefined;
  open: string | undefined;
  done: { name: string; at: string } | undefined;
  lastDone: string | undefined;
  timeZone: string;
  starting: boolean;
  onStart: (routine: Routine) => void;
  onResume: () => void;
  onCreate: () => void;
}) {
  if (done !== undefined) {
    return (
      <div className="workout-slot">
        <div>
          <SlotHeading name={done.name} />
          <span className="workout-slot__meta">Done, started {done.at}</span>
        </div>
      </div>
    );
  }
  if (open !== undefined) {
    return (
      <div className="workout-slot">
        <div>
          <SlotHeading name={open} />
          <span className="workout-slot__meta">In progress</span>
        </div>
        <button
          type="button"
          className="button button--primary workout-slot__go"
          onClick={onResume}
        >
          Resume
        </button>
      </div>
    );
  }
  if (routine === undefined) {
    return (
      <div className="workout-slot">
        <div>
          <SlotHeading name="No routine yet" />
          <span className="workout-slot__meta">Make one and start it from here</span>
        </div>
        <button
          type="button"
          className="button button--primary workout-slot__go"
          onClick={onCreate}
        >
          Create
        </button>
      </div>
    );
  }
  const sets = routine.exercises.reduce((sum, slot) => sum + slot.targetSets, 0);
  return (
    <div className="workout-slot">
      <div>
        <SlotHeading name={routine.name} />
        <span className="workout-slot__meta">
          {routine.exercises.length} {routine.exercises.length === 1 ? 'exercise' : 'exercises'} ·{' '}
          {sets} sets
          {lastDone === undefined ? '' : ` · last done ${dayLabel(lastDone, timeZone)}`}
        </span>
      </div>
      <button
        type="button"
        className="button button--primary workout-slot__go"
        disabled={starting}
        onClick={() => onStart(routine)}
      >
        Start
        <span className="visually-hidden"> {routine.name}</span>
      </button>
    </div>
  );
}

/** The phase and the day, opened from the foot of Today (Q18). */
function YourPlan({
  phaseLine: line,
  targets,
  routines,
  navigate,
}: {
  phaseLine: string;
  targets: CurrentTargets | undefined;
  routines: { dayType: DayType; meals: number }[];
  navigate: Navigate;
}) {
  const meals = (type: DayType) => routines.find((each) => each.dayType === type)?.meals;
  const training = meals('training');
  const rest = meals('rest');
  return (
    <section className="today__section" aria-labelledby="your-plan">
      <h2 id="your-plan" className="section-label">
        Your plan
      </h2>
      <a
        href="/plan/phase"
        className="link-row link-row--flush"
        onClick={(event) => {
          event.preventDefault();
          navigate('/plan/phase', { returns: true });
        }}
      >
        <span>
          <span className="link-row__name">{line}</span>
          {targets !== undefined && (
            <span className="link-row__meta">
              {Math.round(targets.energyKcal).toLocaleString('en-US')} kcal
              {targets.source.kind === 'provisional_formula' ? ', provisional' : ''} ·{' '}
              {Math.round(targets.proteinG)} g protein
            </span>
          )}
        </span>
        <Chevron direction="forward" />
      </a>
      <a
        href="/plan/day"
        className="link-row link-row--flush"
        onClick={(event) => {
          event.preventDefault();
          navigate('/plan/day', { returns: true });
        }}
      >
        <span>
          <span className="link-row__name">Your day</span>
          <span className="link-row__meta">
            {[
              training === undefined ? undefined : `training days ${training} meals`,
              rest === undefined ? undefined : `rest days ${rest} meals`,
            ]
              .filter(Boolean)
              .join(' · ')
              .replace(/^./, (first) => first.toUpperCase())}
          </span>
        </span>
        <Chevron direction="forward" />
      </a>
    </section>
  );
}
