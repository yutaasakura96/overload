import type { Me, WeightUnit } from '@overload/api-contract';
import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import { Brief } from '../brief';
import {
  AppBar,
  CheckIcon,
  Chevron,
  DataState,
  DeleteConfirm,
  FieldError,
  InfoIcon,
  Notice,
} from '../components';
import { readFigures, type FigureRefusal } from '../figures';
import { useFocusGuide } from '../focus-guide';
import type { Navigate } from '../navigation';
import { RefusedSet } from '../refused';
import { keepAwake, playTone, unlockTone } from '../rest-alert';
import { SetEditor } from '../set-editor';
import type { SetRecord, StoreRecord, WorkoutExerciseRecord, WorkoutRecord } from '../set-store';
import { deviceTimezone } from '../timezones';
import { formatWeight, unitLabel } from '../units';
import { FocusGuide } from './FocusGuide';
import {
  completeSet,
  discardSet,
  dismissRest,
  editSet,
  exercisesOf,
  extendRest,
  finishWorkout,
  lastSetOf,
  openWorkout,
  readFailedFor,
  recordsLoadedFor,
  recordsOf,
  refusedSets,
  setsOf,
  useWorkoutStore,
} from '../workout';

// Screen 1, the live workout (docs/10 §1, docs/09 F3): read mid-set, at arm's length, one-handed.
// Everything is subordinate to the active set card. It works the same with no signal: a logged set
// is on the device before it shows here, and the data-state slot counts what has not uploaded yet.
// Full screen (docs/10 §1) is a second layout of the same screen: what it leaves out is hidden, not
// unmounted, so entering and leaving it loses nothing that was typed or opened.

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** `m:ss`, or `h:mm:ss` from an hour up. */
function duration(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds % 60)}`
    : `${minutes}:${pad(seconds % 60)}`;
}

const working = (sets: SetRecord[]) => sets.filter((set) => !set.row.isWarmup);

const isRefused = (set: SetRecord) => set.state === 'refused';

/** An exercise with a target is complete once its working sets reach it. */
const isComplete = (exercise: WorkoutExerciseRecord, sets: SetRecord[]) =>
  exercise.row.targetSets !== null && working(sets).length >= exercise.row.targetSets;

/**
 * The exercise the screen opens on: the one last logged while it still has sets to do, else the
 * first with sets to do, else the last logged.
 */
function exerciseToOpen(
  exercises: WorkoutExerciseRecord[],
  records: StoreRecord[],
  workoutId: string,
) {
  const lastSet = lastSetOf(records, workoutId);
  const lastLogged = exercises.find((exercise) => exercise.id === lastSet?.row.workoutExerciseId);
  if (lastLogged !== undefined && !isComplete(lastLogged, setsOf(records, lastLogged.id))) {
    return lastLogged.id;
  }
  const next = exercises.find((exercise) => !isComplete(exercise, setsOf(records, exercise.id)));
  return (next ?? lastLogged ?? exercises[0])?.id;
}

export function Workout({
  me,
  navigate,
  guide = false,
}: {
  me: Me;
  navigate: Navigate;
  /** The iPhone Focus guide is open over the workout (`/workout/focus`). */
  guide?: boolean;
}) {
  const userId = me.user.id;
  const loaded = useWorkoutStore(
    (state) => recordsLoadedFor(state, userId) || readFailedFor(state, userId),
  );
  const records = useWorkoutStore((state) => recordsOf(state, userId));
  const workout = openWorkout(records);
  const gone = loaded && workout === undefined;
  const openedGuide = useRef(false);
  const closeGuide = () => {
    if (openedGuide.current) {
      openedGuide.current = false;
      window.history.back();
    } else {
      navigate('/workout', { replace: true });
    }
  };
  // Finish was tapped and has not answered: where it leaves for is its own to say.
  const [finishing, setFinishing] = useState(false);

  // With nothing in progress, Today is where the next one starts.
  useEffect(() => {
    if (gone && !finishing) navigate('/', { replace: true });
  }, [gone, finishing, navigate]);

  if (workout === undefined) return <AppBar title="Workout" slot={<DataState at={0} />} />;
  // The guide is read with the workout still running under it: the rest still counts and sounds,
  // and the set half typed is there on the way back.
  return (
    <>
      <div hidden={guide}>
        <LiveWorkout
          key={workout.id}
          workout={workout}
          records={records}
          unit={me.profile?.weightUnit ?? 'kg'}
          timeZone={me.profile?.timezone ?? deviceTimezone()}
          guideOpen={guide}
          onGuide={() => {
            openedGuide.current = true;
            navigate(GUIDE_PATH);
          }}
          onFinish={(result) => {
            setFinishing(true);
            // A workout just finished opens its page in History, which is its summary (docs/09 F3
            // step 5). One with nothing kept leaves for Today.
            void result.then((kept) => {
              if (kept === undefined) setFinishing(false);
              else if (kept)
                navigate(`/workouts/${workout.id}`, { replace: true, note: 'finished' });
              else navigate('/', { replace: true });
            });
          }}
        />
      </div>
      {guide && <FocusGuide onBack={closeGuide} />}
    </>
  );
}

const GUIDE_PATH = '/workout/focus';

/** The rest that is on screen: the set it counts from, and its length with what `+30s` added. */
type CountedRest = { set: SetRecord; total: number };

/** Where a rest stands at `now`. Past zero it is over and `remaining` counts down below it. */
function readRest(rest: CountedRest, now: number) {
  const elapsed = (now - new Date(rest.set.row.performedAt).getTime()) / 1000;
  const remaining = rest.total - elapsed;
  const over = remaining <= 0;
  return {
    remaining,
    over,
    fill: over ? 100 : Math.min(100, (elapsed / rest.total) * 100),
    clock: over ? `+${duration(-remaining)}` : duration(Math.ceil(remaining)),
  };
}

function LiveWorkout({
  workout,
  records,
  unit,
  timeZone,
  guideOpen,
  onGuide,
  onFinish,
}: {
  workout: WorkoutRecord;
  records: StoreRecord[];
  unit: WeightUnit;
  timeZone: string;
  guideOpen: boolean;
  onGuide: () => void;
  /** Finish was tapped: whether the workout was kept, once known; `undefined` when it failed. */
  onFinish: (result: Promise<boolean | undefined>) => void;
}) {
  const exercises = exercisesOf(records, workout.id);
  // Turned on by hand each workout and not remembered (docs/06, 2026-10-12): it lives here, in a
  // component keyed by the workout.
  const [full, setFull] = useState(false);
  const focusSetUp = useFocusGuide().done;
  const [currentId, setCurrentId] = useState(() => exerciseToOpen(exercises, records, workout.id));
  // Counts the sets logged on this screen, so the card a set promotes knows to bring itself into
  // view and the first card, on opening the screen, does not.
  const [logged, setLogged] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const [finishFailed, setFinishFailed] = useState(false);
  const current = exercises.find((exercise) => exercise.id === currentId) ?? exercises[0];
  const setCount = exercises.reduce((sum, e) => sum + setsOf(records, e.id).length, 0);

  const restState = useWorkoutStore((state) => state.rest);
  const restSet = records.find(
    (record): record is SetRecord =>
      record.table === 'sets' && record.id === restState?.setId && record.workoutId === workout.id,
  );
  const rest: CountedRest | undefined =
    restState === undefined || restSet === undefined || restState.dismissed
      ? undefined
      : {
          set: restSet,
          total:
            (exercises.find((exercise) => exercise.id === restSet.row.workoutExerciseId)?.local
              .restSeconds ?? 0) + restState.extraSeconds,
        };

  // The control that switches the layout is a different one in each, so focus follows the switch
  // to its counterpart and the screen starts from its top. Set by the tap only.
  const enter = useRef<HTMLButtonElement>(null);
  const exit = useRef<HTMLButtonElement>(null);
  const switched = useRef(false);
  const switchTo = (next: boolean) => {
    switched.current = true;
    setFull(next);
  };
  useEffect(() => {
    if (!switched.current) return;
    switched.current = false;
    window.scrollTo(0, 0);
    (full ? exit : enter).current?.focus({ preventScroll: true });
  }, [full]);

  // Back from the guide, focus returns to the row that opened it.
  const guideLink = useRef<HTMLAnchorElement>(null);
  const wasInGuide = useRef(guideOpen);
  useEffect(() => {
    if (wasInGuide.current && !guideOpen) {
      window.scrollTo(0, 0);
      guideLink.current?.focus({ preventScroll: true });
    }
    wasInGuide.current = guideOpen;
  }, [guideOpen]);

  const onLogged = (exercise: WorkoutExerciseRecord, isWarmup: boolean) => {
    setLogged((count) => count + 1);
    // The set just logged is not in `records` yet: this render still holds the list before it.
    const done = working(setsOf(records, exercise.id)).length + (isWarmup ? 0 : 1);
    // Only the set that reaches the target moves on: an extra set stays where the user chose to be.
    if (done !== exercise.row.targetSets) return;
    const next = exercises.find(
      (other) => other.id !== exercise.id && !isComplete(other, setsOf(records, other.id)),
    );
    if (next !== undefined) setCurrentId(next.id);
  };

  const finish = () => {
    setFinishing(true);
    setFinishFailed(false);
    // Leaving happens in <Workout>, once the set store has said whether the workout was kept.
    onFinish(
      finishWorkout().catch(() => {
        setFinishing(false);
        setFinishFailed(true);
        return undefined;
      }),
    );
  };

  const others = exercises.filter((exercise) => exercise.id !== current?.id);
  const upNext = others.filter((exercise) => !isComplete(exercise, setsOf(records, exercise.id)));
  const done = others.filter((exercise) => isComplete(exercise, setsOf(records, exercise.id)));

  return (
    <main className={full ? 'full' : 'workout'}>
      {full ? (
        <FullBar workout={workout} exit={exit} onExit={() => switchTo(false)} />
      ) : (
        <WorkoutBar workout={workout} />
      )}

      {current === undefined ? (
        <p className="empty">This routine has no exercises. Finish, then add some to it.</p>
      ) : (
        <ExerciseBlock
          key={current.id}
          exercise={current}
          position={exercises.indexOf(current) + 1}
          count={exercises.length}
          sets={setsOf(records, current.id)}
          unit={unit}
          timeZone={timeZone}
          scrollIntoView={logged > 0}
          onLogged={(isWarmup) => onLogged(current, isWarmup)}
          full={full}
          rest={rest}
        />
      )}

      {!full && upNext.length > 0 && (
        <ExerciseList
          label="Up next"
          exercises={upNext}
          records={records}
          onOpen={(id) => setCurrentId(id)}
        />
      )}
      {!full && done.length > 0 && (
        <ExerciseList
          label="Done"
          exercises={done}
          records={records}
          onOpen={(id) => setCurrentId(id)}
        />
      )}

      <div className="workout__finish" hidden={full}>
        {finishFailed && (
          <Notice tone="flag" word="Not finished">
            Couldn’t save that on this device. Try again.
          </Notice>
        )}
        <DeleteConfirm
          label="Finish workout"
          question={
            setCount === 0
              ? `Finish ${workout.row.name}? No sets are logged, so nothing is kept.`
              : `Finish ${workout.row.name}? ${setCount} ${setCount === 1 ? 'set' : 'sets'} logged.`
          }
          keepLabel="Keep going"
          confirmLabel="Finish"
          busy={finishing}
          onDelete={finish}
        />
      </div>

      {full ? (
        <div className="full__foot">
          <a
            ref={guideLink}
            href={GUIDE_PATH}
            className="link-row"
            onClick={(event) => {
              event.preventDefault();
              onGuide();
            }}
          >
            <span>
              <span className="link-row__name">
                {focusSetUp ? 'iPhone Focus: set up' : 'Calls and messages can still interrupt'}
              </span>
              <span className="link-row__meta">
                {focusSetUp
                  ? 'Open the guide again'
                  : 'Set up an iPhone Focus that lets only chosen people through'}
              </span>
            </span>
            <Chevron direction="forward" />
          </a>
        </div>
      ) : (
        <RestBar
          rest={rest}
          records={records}
          current={current}
          enter={enter}
          onFull={() => switchTo(true)}
        />
      )}
      <RestAlert rest={rest} awake={full} />
    </main>
  );
}

/**
 * What a rest does besides show: the tone as it reaches zero, and the screen kept awake. Awake for
 * the length of the rest, and in full screen for the whole workout (docs/06, 2026-10-12). It has no
 * view of its own, so neither stops when the layout or the screen on top changes.
 */
function RestAlert({ rest, awake }: { rest: CountedRest | undefined; awake: boolean }) {
  const now = useNow();
  const remaining = rest === undefined ? undefined : readRest(rest, now).remaining;
  const resting = remaining !== undefined && remaining > 0;
  const over = remaining !== undefined && remaining <= 0;

  // The tone, once, as the count reaches zero while the app is on screen.
  const wasResting = useRef(false);
  useEffect(() => {
    if (wasResting.current && over && remaining > -2) playTone();
    wasResting.current = resting;
  }, [resting, over, remaining]);

  // Where the browser allows it.
  const lit = resting || awake;
  useEffect(() => (lit ? keepAwake() : undefined), [lit]);

  return null;
}

/** The app bar, with the elapsed time ticking under the routine's name. It stays put (§7.3). */
function WorkoutBar({ workout }: { workout: WorkoutRecord }) {
  const now = useNow();
  const syncedAt = useWorkoutStore((state) => state.lastSyncedAt);
  const elapsed = (now - new Date(workout.row.startedAt).getTime()) / 1000;
  return (
    <AppBar
      sticky
      title={workout.row.name}
      subline={`${duration(elapsed)} elapsed`}
      slot={<DataState at={syncedAt} />}
    />
  );
}

/** Full screen's bar: the same name and elapsed time, and the way out in place of the slot. */
function FullBar({
  workout,
  exit,
  onExit,
}: {
  workout: WorkoutRecord;
  exit: RefObject<HTMLButtonElement | null>;
  onExit: () => void;
}) {
  const now = useNow();
  const elapsed = (now - new Date(workout.row.startedAt).getTime()) / 1000;
  return (
    <header className="full__bar">
      <div className="full__lead">
        <h1 className="app-bar__title">{workout.row.name}</h1>
        <div className="app-bar__subline">{duration(elapsed)} elapsed</div>
      </div>
      <button ref={exit} type="button" className="button button--tertiary" onClick={onExit}>
        Exit full screen
      </button>
    </header>
  );
}

const range = (exercise: WorkoutExerciseRecord) =>
  exercise.row.repLow === exercise.row.repHigh
    ? String(exercise.row.repLow)
    : `${exercise.row.repLow}–${exercise.row.repHigh}`;

/**
 * The current exercise: its header, last time and today's target in words, warm-ups, completed
 * sets and the active set card. In full screen it is one exercise and one set: the count under the
 * name, the compact block and the card, or, while a rest is on screen, the countdown and the set
 * that comes next.
 */
function ExerciseBlock({
  exercise,
  position,
  count,
  sets,
  unit,
  timeZone,
  scrollIntoView,
  onLogged,
  full,
  rest,
}: {
  exercise: WorkoutExerciseRecord;
  position: number;
  count: number;
  sets: SetRecord[];
  unit: WeightUnit;
  timeZone: string;
  scrollIntoView: boolean;
  onLogged: (isWarmup: boolean) => void;
  full: boolean;
  rest: CountedRest | undefined;
}) {
  // A refused warm-up leaves the summary for the table, where it can be acted on.
  const warmups = sets.filter((set) => set.row.isWarmup && !isRefused(set));
  const completed = working(sets);
  const rows = sets.filter((set) => !set.row.isWarmup || isRefused(set));
  const heading = useId();
  const name = useRef<HTMLHeadingElement>(null);
  const figures = (set: { weightKg: number; reps: number }) =>
    `${formatWeight(set.weightKg, unit)} × ${set.reps}`;
  const target = exercise.row.targetSets;
  const next = setLabel(completed.length + 1, target);
  const hero = full ? rest : undefined;
  // The set whose tick has opened into the editor (docs/05 §4.20). One at a time.
  const [editing, setEditing] = useState<string>();
  // A set was corrected since the last one was logged: the card under the table is made again from
  // the corrected figures, and must not take the screen as the card a logged set promotes does.
  const [corrected, setCorrected] = useState(false);
  // Focus goes back to the tick an editor closed under, or to the exercise when the set has gone.
  const focusPending = useRef<string>(null);
  useEffect(() => {
    const target = focusPending.current;
    if (target === null) return;
    focusPending.current = null;
    (document.getElementById(target) ?? name.current)?.focus();
  });
  const close = (setId: string) => {
    focusPending.current = `tick-${setId}`;
    setEditing(undefined);
  };

  return (
    <section aria-labelledby={heading}>
      <div className="exercise-head">
        <h2 ref={name} id={heading} className="exercise-head__name" tabIndex={-1}>
          {exercise.local.name}
        </h2>
        {!full && (
          <span className="exercise-head__meta">
            <span className="visually-hidden">Exercise </span>
            {position} OF {count}
          </span>
        )}
      </div>
      {full && (
        <p className="full__count">
          Exercise {position} of {count} ·{' '}
          {target === null
            ? `${completed.length} ${completed.length === 1 ? 'set' : 'sets'} done`
            : `${completed.length} of ${target} sets done`}
        </p>
      )}

      {hero === undefined ? (
        <Brief exercise={exercise} unit={unit} timeZone={timeZone} compact={full} />
      ) : (
        <RestHero rest={hero} next={next} />
      )}

      {warmups.length > 0 && <Warmups sets={warmups} figures={figures} unit={unit} hidden={full} />}

      {rows.length > 0 && (
        <table className="sets" aria-label={`${exercise.local.name}, completed sets`} hidden={full}>
          <thead>
            <tr className="sets__row sets__row--head">
              <th scope="col">Set</th>
              <th scope="col">Last</th>
              <th scope="col">{unitLabel(unit)}</th>
              <th scope="col">Reps</th>
              <th scope="col">RIR</th>
              <th scope="col">
                <span className="visually-hidden">Edit</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((set) => {
              const index = completed.indexOf(set);
              const last = exercise.local.lastTime[index];
              const cells = (
                <>
                  <td className="sets__number">
                    {index < 0 ? (
                      <>
                        <span aria-hidden="true">W</span>
                        <span className="visually-hidden">Warm-up</span>
                      </>
                    ) : (
                      index + 1
                    )}
                  </td>
                  <td className="sets__last">{last === undefined ? '' : figures(last)}</td>
                  <td className="sets__figure">{formatWeight(set.row.weightKg, unit)}</td>
                  <td className="sets__figure">{set.row.reps}</td>
                  <td className="sets__number">{set.row.rir ?? '—'}</td>
                </>
              );
              if (!isRefused(set)) {
                const open = editing === set.id;
                return (
                  <Fragment key={set.id}>
                    <tr className="sets__row">
                      {cells}
                      <td className="sets__check">
                        <button
                          type="button"
                          id={`tick-${set.id}`}
                          className="check-cell check-cell--done sets__edit"
                          aria-expanded={open}
                          onClick={() => setEditing(open ? undefined : set.id)}
                        >
                          <CheckIcon size={17} color="var(--done)" />
                          <span className="visually-hidden">Set {index + 1} done. Edit</span>
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr className="sets__row sets__row--editor">
                        <td colSpan={6}>
                          <SetEditor
                            set={set.row}
                            unit={unit}
                            name={`set ${index + 1}`}
                            onSave={async (changed) => {
                              setCorrected(true);
                              await editSet(set.id, changed);
                              close(set.id);
                            }}
                            onDelete={async () => {
                              setCorrected(true);
                              await discardSet(set.id);
                              close(set.id);
                            }}
                            onCancel={() => close(set.id)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              }
              // The refused row (docs/05 §4.17): the figures as entered, then what to do about it.
              return (
                <Fragment key={set.id}>
                  <tr className="sets__row sets__row--refused">
                    {cells}
                    <td className="sets__check">
                      <span className="check-cell check-cell--refused">
                        <InfoIcon size={15} color="var(--error)" />
                        <span className="visually-hidden">Refused</span>
                      </span>
                    </td>
                  </tr>
                  <tr className="sets__row sets__row--refusal">
                    <td colSpan={6}>
                      <RefusedSet
                        set={set}
                        unit={unit}
                        name={index < 0 ? 'the warm-up set' : `set ${index + 1}`}
                        onSettled={() => name.current?.focus()}
                      />
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}

      <ActiveSet
        // Made again for each set, and when the set it opens on is corrected (docs/09 F3 step 4).
        key={`${sets.length}:${unit}:${completed.at(-1)?.row.clientUpdatedAt ?? ''}`}
        exercise={exercise}
        completed={completed}
        unit={unit}
        asNext={hero !== undefined}
        scrollIntoView={scrollIntoView && !corrected}
        onLogged={(isWarmup) => {
          setCorrected(false);
          onLogged(isWarmup);
        }}
      />
    </section>
  );
}

/** Warm-ups collapse to one row and expand in place, as compact rows for review (docs/10 §7.2). */
function Warmups({
  sets,
  figures,
  unit,
  hidden,
}: {
  sets: SetRecord[];
  figures: (set: { weightKg: number; reps: number }) => string;
  unit: WeightUnit;
  hidden: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const list = useId();
  return (
    <div className="warmups" hidden={hidden}>
      <button
        type="button"
        className="warmups__summary"
        aria-expanded={expanded}
        aria-controls={list}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="warmups__label">
          <CheckIcon size={13} color="var(--done)" />
          {sets.length} {sets.length === 1 ? 'WARM-UP SET' : 'WARM-UP SETS'}
        </span>
        <span className="warmups__figures">
          {expanded ? 'HIDE' : sets.map((set) => figures(set.row)).join(' · ')}
        </span>
      </button>
      <ol id={list} className="warmups__list" hidden={!expanded}>
        {sets.map((set, index) => (
          <li key={set.id} className="warmups__row">
            <span className="warmups__number">
              W{index + 1}
              <span className="visually-hidden">, warm-up</span>
            </span>
            <span>
              {formatWeight(set.row.weightKg, unit)}
              <span className="visually-hidden"> {unit === 'lb' ? 'pounds' : 'kilograms'},</span>
            </span>
            <span>
              {set.row.reps}
              <span className="visually-hidden"> reps</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** `SET 3 OF 4` while the target stands, `SET 5 · EXTRA` past it, `SET 3` with no target. */
function setLabel(number: number, target: number | null) {
  if (target === null) return `SET ${number}`;
  return number <= target ? `SET ${number} OF ${target}` : `SET ${number} · EXTRA`;
}

/**
 * The active set card (docs/10 §1): the one place the 56px figures appear. The weight opens on the
 * last set logged today, else on the suggestion; reps and RIR open on the same set's, as real
 * values the user edits or clears, so a set repeated is one tap. A warm-up is not that set again:
 * with the toggle on, reps and RIR left as they opened are empty. What is typed is never
 * overwritten (S3).
 *
 * With `asNext`, full screen's rest is on screen: the card is hidden and the same figures, as they
 * stand, are shown as the set that comes next (docs/05 §4.22).
 */
function ActiveSet({
  exercise,
  completed,
  unit,
  scrollIntoView,
  onLogged,
  asNext,
}: {
  exercise: WorkoutExerciseRecord;
  completed: SetRecord[];
  unit: WeightUnit;
  scrollIntoView: boolean;
  onLogged: (isWarmup: boolean) => void;
  asNext: boolean;
}) {
  const { lastTime, lastTimeKnown, suggestion, bodyweight } = exercise.local;
  const number = completed.length + 1;
  const last = lastTime[completed.length];
  const previous = completed.at(-1);
  const openingKg = previous?.row.weightKg ?? suggestion?.weightKg ?? (bodyweight ? 0 : null);
  const opening = openingKg === null ? '' : formatWeight(openingKg, unit);
  const [kg, setKg] = useState(opening);

  // Assume the same again: the previous set's reps and RIR. The first set opens on last time's,
  // unless the suggestion moves the weight, where a new weight starts at the bottom of the range
  // and last time's RIR no longer applies.
  const repeated =
    suggestion === null || suggestion.weightKg === Math.max(...lastTime.map((set) => set.weightKg));
  const openingReps =
    previous?.row.reps ?? (repeated ? last?.reps : undefined) ?? exercise.row.repLow;
  const openingRir = previous === undefined ? (repeated ? last?.rir : null) : previous.row.rir;
  const [filled] = useState({
    reps: String(openingReps),
    rir: openingRir == null ? '' : String(openingRir),
  });
  const [typed, setTyped] = useState<{ reps?: string; rir?: string }>({});
  const [warm, setWarm] = useState(false);
  const reps = typed.reps ?? (warm ? '' : filled.reps);
  const rir = typed.rir ?? (warm ? '' : filled.rir);
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<FigureRefusal>();
  const card = useRef<HTMLElement>(null);
  const ids = {
    kg: useId(),
    reps: useId(),
    rir: useId(),
    error: useId(),
    label: useId(),
    next: useId(),
  };

  // The card a completed set promotes comes into view and takes focus, so the next thing read and
  // reached is the next set (docs/10 §7.3). `nearest` moves nothing when it is already in view.
  useEffect(() => {
    if (!scrollIntoView) return;
    card.current?.focus({ preventScroll: true });
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    card.current?.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' });
  }, [scrollIntoView]);

  // Full screen's rest gives the screen back to the card, which takes focus as it does after a set.
  const wasNext = useRef(asNext);
  useEffect(() => {
    if (wasNext.current && !asNext) card.current?.focus({ preventScroll: true });
    wasNext.current = asNext;
  }, [asNext]);

  const complete = async () => {
    // The tap that completes a set is the gesture that lets the rest tone play (docs/03 §11).
    unlockTone();
    const figures = readFigures({ kg, reps, rir }, unit, { shown: opening, kg: openingKg });
    if ('message' in figures) {
      setRefusal(figures);
      // The figure to correct is the one in hand.
      if (figures.field !== undefined) document.getElementById(ids[figures.field])?.focus();
      return;
    }
    setSaving(true);
    setRefusal(undefined);
    try {
      await completeSet({ exercise, ...figures, isWarmup: warm });
      onLogged(warm);
    } catch {
      setRefusal({ message: 'Couldn’t save the set on this device. Try again' });
      setSaving(false);
    }
  };

  const unitWord = unitLabel(unit).toLowerCase();
  const nextWeight =
    kg.trim() === ''
      ? bodyweight
        ? 'Bodyweight'
        : 'Find your weight'
      : bodyweight && Number(kg.replace(',', '.')) === 0
        ? 'Bodyweight'
        : // A no-break space: the figure and its unit never part at the end of a line.
          `${kg.trim()}\u00a0${unitWord}`;

  return (
    <>
      {asNext && (
        <section className="next-set" aria-labelledby={ids.next}>
          <h3 id={ids.next} className="section-label">
            Next · {setLabel(number, exercise.row.targetSets)}
          </h3>
          <div className="next-set__figures">
            {nextWeight} × {reps.trim() || range(exercise)}
          </div>
          <div className="brief__when">
            {last !== undefined
              ? `Last time ${formatWeight(last.weightKg, unit)} × ${last.reps}`
              : lastTime.length > 0
                ? 'No matching set last time'
                : lastTimeKnown && 'First workout of this exercise'}
          </div>
        </section>
      )}
      <section
        ref={card}
        className="active-set"
        aria-labelledby={ids.label}
        tabIndex={-1}
        hidden={asNext}
      >
        <div className="active-set__label-row">
          <span id={ids.label} className="active-set__label">
            {warm ? 'WARM-UP' : setLabel(number, exercise.row.targetSets)}
          </span>
          {last !== undefined && !warm && (
            <span className="active-set__last">
              <span className="active-set__last-word">LAST TIME</span>
              {formatWeight(last.weightKg, unit)} × {last.reps}
            </span>
          )}
          {lastTime.length === 0 && lastTimeKnown && (
            <span className="active-set__last-word">FIRST WORKOUT</span>
          )}
        </div>

        <div className="active-set__figures">
          <Figure
            id={ids.kg}
            name="weight"
            label={unitLabel(unit)}
            spoken={unit === 'lb' ? 'Weight in pounds' : 'Weight in kilograms'}
            value={kg}
            onChange={setKg}
            placeholder="—"
            decimal
            describedBy={refusal?.field === 'kg' ? ids.error : undefined}
          />
          <Figure
            id={ids.reps}
            name="reps"
            label="REPS"
            spoken="Reps"
            value={reps}
            onChange={(value) => setTyped({ ...typed, reps: value })}
            placeholder="—"
            describedBy={refusal?.field === 'reps' ? ids.error : undefined}
          />
          <Figure
            id={ids.rir}
            name="rir"
            label="RIR"
            spoken="Reps in reserve, optional"
            value={rir}
            onChange={(value) => setTyped({ ...typed, rir: value })}
            placeholder="—"
            describedBy={refusal?.field === 'rir' ? ids.error : undefined}
          />
        </div>

        <RirHelp />

        {refusal !== undefined && (
          <div role="alert">
            <FieldError id={ids.error} message={refusal.message} />
          </div>
        )}

        <div className="active-set__actions">
          <button
            type="button"
            className="active-set__warm"
            aria-pressed={warm}
            onClick={() => setWarm(!warm)}
          >
            <span aria-hidden="true">WARM</span>
            <span className="visually-hidden">Warm-up set</span>
          </button>
          <button
            type="button"
            className="button button--primary active-set__complete"
            // One set per tap: the control waits for the write to the device (docs/09 F3).
            disabled={saving}
            onClick={() => void complete()}
          >
            <CheckIcon size={22} color="currentColor" />
            Complete set
          </button>
        </div>
      </section>
    </>
  );
}

function RirHelp() {
  const [open, setOpen] = useState(false);
  const guide = useId();
  return (
    <div className="rir-help">
      <p className="rir-help__line">
        <span className="rir-help__term">RIR</span> is reps in reserve: how many more reps you could
        have done. Optional.
        <button
          type="button"
          className="rir-help__toggle"
          aria-expanded={open}
          aria-controls={guide}
          onClick={() => setOpen(!open)}
        >
          {open ? 'Hide guide' : 'How to gauge it'}
        </button>
      </p>
      {open && (
        <div id={guide} className="rir-help__guide">
          <p className="rir-help__ask">
            After the set, ask: how many more good reps could I have done?
          </p>
          <dl className="rir-help__scale">
            <dt>0</dt>
            <dd>Could not do another. The last rep was a grind.</dd>
            <dt>1–2</dt>
            <dd>Hard. One or two more would have been possible.</dd>
            <dt>3+</dt>
            <dd>Comfortable. Plenty left.</dd>
          </dl>
          <p className="rir-help__ask">Not sure? Leave it empty. The set still counts.</p>
        </div>
      )}
    </div>
  );
}

/**
 * One 56px figure the user types into. Empty, it shows its placeholder in `text/placeholder`. A
 * figure too long for its column at 56px is set smaller, so it is always read whole (docs/05 §2.6).
 */
function Figure({
  id,
  name,
  label,
  spoken,
  value,
  onChange,
  placeholder,
  decimal = false,
  describedBy,
}: {
  id: string;
  name: string;
  label: string;
  spoken: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  decimal?: boolean;
  describedBy: string | undefined;
}) {
  return (
    <div
      className="figure"
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a custom property
      style={{ '--chars': Math.max(1, (value || placeholder).length) } as CSSProperties}
    >
      <label htmlFor={id} className="figure__label">
        <span aria-hidden="true">{label}</span>
        <span className="visually-hidden">{spoken}</span>
      </label>
      <input
        id={id}
        name={name}
        type="text"
        inputMode={decimal ? 'decimal' : 'numeric'}
        enterKeyHint="done"
        className="figure__input"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        aria-invalid={describedBy === undefined ? undefined : true}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
        onFocus={(event) => event.target.select()}
      />
    </div>
  );
}

/** The other exercises of the workout. A row opens that exercise. */
function ExerciseList({
  label,
  exercises,
  records,
  onOpen,
}: {
  label: string;
  exercises: WorkoutExerciseRecord[];
  records: StoreRecord[];
  onOpen: (id: string) => void;
}) {
  const heading = useId();
  return (
    <section className="up-next" aria-labelledby={heading}>
      <h2 id={heading} className="section-label">
        {label}
      </h2>
      <ul className="up-next__list">
        {exercises.map((exercise) => {
          const logged = working(setsOf(records, exercise.id)).length;
          const target = exercise.row.targetSets;
          const refused = refusedSets(records).filter(
            (set) => set.row.workoutExerciseId === exercise.id,
          ).length;
          return (
            <li key={exercise.id}>
              <button type="button" className="up-next__row" onClick={() => onOpen(exercise.id)}>
                <span className="up-next__name">
                  {exercise.local.name}
                  {refused > 0 && (
                    <span className="up-next__refused">
                      <InfoIcon size={12} color="var(--error)" />
                      {refused} REFUSED
                    </span>
                  )}
                </span>
                <span className="up-next__target">
                  {logged > 0 && (
                    <>
                      {logged}
                      <span className="visually-hidden"> sets done</span>
                      <span aria-hidden="true"> / </span>
                      <span className="visually-hidden"> of </span>
                    </>
                  )}
                  {target === null ? '' : `${target} × `}
                  {range(exercise)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The rest bar (docs/05 §4.14), pinned to the bottom for the whole workout: with no rest counting
 * it says the timer starts by itself. Rest counts from the last set's `performedAt`, so a locked
 * phone or a relaunch does not stop it (docs/09 F3). At zero it turns to the accent and counts over
 * until dismissed or the next set (docs/06, 2026-10-03). `FULL SCREEN` is always on it.
 */
function RestBar({
  rest,
  records,
  current,
  enter,
  onFull,
}: {
  rest: CountedRest | undefined;
  records: StoreRecord[];
  current: WorkoutExerciseRecord | undefined;
  enter: RefObject<HTMLButtonElement | null>;
  onFull: () => void;
}) {
  const now = useNow();

  if (rest === undefined) {
    const seconds = current?.local.restSeconds;
    return (
      <section className="rest-bar" aria-label="Rest timer">
        <div className="rest-bar__track" />
        <div className="rest-bar__body">
          <div>
            <div className="rest-bar__label">REST TIMER</div>
            <div className="rest-bar__idle">
              {seconds === 0 ? (
                'This exercise has no rest set, so no timer starts.'
              ) : seconds === undefined ? (
                'Starts by itself after each set.'
              ) : (
                <>
                  Starts by itself after each set: <b>{duration(seconds)}</b>
                </>
              )}
            </div>
          </div>
          <div className="rest-bar__actions">
            <button
              ref={enter}
              type="button"
              className="rest-bar__full rest-bar__full--wide"
              onClick={onFull}
            >
              Full screen
            </button>
          </div>
        </div>
      </section>
    );
  }
  const { over, fill, clock } = readRest(rest, now);
  const next =
    current === undefined
      ? ''
      : ` · NEXT: ${setLabel(working(setsOf(records, current.id)).length + 1, current.row.targetSets)}`;
  return (
    <section className={over ? 'rest-bar rest-bar--over' : 'rest-bar'} aria-label="Rest timer">
      <div className="rest-bar__track">
        <div className="rest-bar__fill" style={{ width: `${fill}%` }} />
      </div>
      <div className="rest-bar__body">
        <div>
          <div className="rest-bar__label">
            {over ? 'REST OVER' : 'REST'}
            {next}
          </div>
          <div className="rest-bar__timer" role="timer">
            {clock}
          </div>
        </div>
        <output className="visually-hidden">{over ? 'Rest over' : ''}</output>
        <div className="rest-bar__actions">
          <button ref={enter} type="button" className="rest-bar__full" onClick={onFull}>
            Full <br />
            screen
          </button>
          {!over && (
            <button
              type="button"
              className="rest-bar__extend"
              onClick={() => extendRest(rest.set.id, 30)}
            >
              +30s
              <span className="visually-hidden"> rest</span>
            </button>
          )}
          <button type="button" className="rest-bar__skip" onClick={() => dismissRest(rest.set.id)}>
            {over ? 'DISMISS' : 'SKIP'}
            <span className="visually-hidden"> rest</span>
          </button>
        </div>
      </div>
    </section>
  );
}

/**
 * Full screen's rest (docs/05 §4.22): the countdown is the one large figure on the screen, at 56px,
 * with the same track and the same two answers as the bar. It takes focus as it replaces the card
 * whose `Complete set` was just tapped.
 */
function RestHero({ rest, next }: { rest: CountedRest; next: string }) {
  const now = useNow();
  const { over, fill, clock } = readRest(rest, now);
  const hero = useRef<HTMLElement>(null);
  useEffect(() => hero.current?.focus(), []);
  return (
    <section
      ref={hero}
      className={over ? 'rest-hero rest-hero--over' : 'rest-hero'}
      aria-label="Rest timer"
      tabIndex={-1}
    >
      <div>
        <div className="rest-bar__label">{over ? 'REST OVER' : 'REST'}</div>
        <div className="rest-hero__timer" role="timer">
          {clock}
        </div>
      </div>
      <output className="visually-hidden">{over ? 'Rest over' : ''}</output>
      <div className="rest-bar__track">
        <div className="rest-bar__fill" style={{ width: `${fill}%` }} />
      </div>
      {over ? (
        <div className="rest-hero__actions rest-hero__actions--one">
          <button
            type="button"
            className="button button--primary"
            onClick={() => dismissRest(rest.set.id)}
          >
            Start {next.toLowerCase()}
          </button>
        </div>
      ) : (
        <div className="rest-hero__actions">
          <button
            type="button"
            className="button button--secondary"
            onClick={() => extendRest(rest.set.id, 30)}
          >
            +30s
            <span className="visually-hidden"> rest</span>
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => dismissRest(rest.set.id)}
          >
            Skip rest
          </button>
        </div>
      )}
    </section>
  );
}
