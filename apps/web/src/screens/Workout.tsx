import type { Me, WeightUnit } from '@overload/api-contract';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import {
  AppBar,
  CheckIcon,
  DataState,
  DeleteConfirm,
  FieldError,
  Notice,
  parseFigure,
} from '../components';
import { routinesQuery, useAccount } from '../query';
import { keepAwake, playTone, unlockTone } from '../rest-alert';
import type { SetRecord, StoreRecord, WorkoutExerciseRecord, WorkoutRecord } from '../set-store';
import { formatWeight, toKg, unitLabel } from '../units';
import {
  completeSet,
  dismissRest,
  exercisesOf,
  extendRest,
  finishWorkout,
  lastSetOf,
  openWorkout,
  readFailedFor,
  recordsLoadedFor,
  recordsOf,
  setsOf,
  useWorkoutStore,
} from '../workout';

// Screen 1, the live workout (docs/10 §1, docs/09 F3): read mid-set, at arm's length, one-handed.
// Everything is subordinate to the active set card. It works the same with no signal: a logged set
// is on the device before it shows here, and the data-state slot counts what has not uploaded yet.

type Navigate = (path: string, options?: { replace?: boolean }) => void;

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

export function Workout({ me, navigate }: { me: Me; navigate: Navigate }) {
  const userId = me.user.id;
  const loaded = useWorkoutStore(
    (state) => recordsLoadedFor(state, userId) || readFailedFor(state, userId),
  );
  const records = useWorkoutStore((state) => recordsOf(state, userId));
  // What this screen shows of the server's is copied at the start; the slot's time is the routines'.
  const routines = useQuery({ ...routinesQuery, enabled: useAccount().status === 'confirmed' });
  const workout = openWorkout(records);
  const gone = loaded && workout === undefined;

  // Nothing in progress, or the workout just finished: Today is where the next one starts.
  useEffect(() => {
    if (gone) navigate('/', { replace: true });
  }, [gone, navigate]);

  if (workout === undefined) return <AppBar title="Workout" slot={<DataState at={0} />} />;
  return (
    <LiveWorkout
      key={workout.id}
      workout={workout}
      records={records}
      unit={me.profile?.weightUnit ?? 'kg'}
      syncedAt={routines.dataUpdatedAt}
    />
  );
}

function LiveWorkout({
  workout,
  records,
  unit,
  syncedAt,
}: {
  workout: WorkoutRecord;
  records: StoreRecord[];
  unit: WeightUnit;
  syncedAt: number;
}) {
  const exercises = exercisesOf(records, workout.id);
  const [currentId, setCurrentId] = useState(() => exerciseToOpen(exercises, records, workout.id));
  // Counts the sets logged on this screen, so the card a set promotes knows to bring itself into
  // view and the first card, on opening the screen, does not.
  const [logged, setLogged] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const [finishFailed, setFinishFailed] = useState(false);
  const current = exercises.find((exercise) => exercise.id === currentId) ?? exercises[0];
  const setCount = exercises.reduce((sum, e) => sum + setsOf(records, e.id).length, 0);

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
    // Leaving for Today happens in <Workout>, once no workout is open.
    finishWorkout().catch(() => {
      setFinishing(false);
      setFinishFailed(true);
    });
  };

  const others = exercises.filter((exercise) => exercise.id !== current?.id);
  const upNext = others.filter((exercise) => !isComplete(exercise, setsOf(records, exercise.id)));
  const done = others.filter((exercise) => isComplete(exercise, setsOf(records, exercise.id)));

  return (
    <main className="workout">
      <WorkoutBar workout={workout} syncedAt={syncedAt} />

      {current === undefined ? (
        <p className="empty">This routine has no exercises. Finish, then add some to it.</p>
      ) : (
        <ExerciseBlock
          key={current.id}
          exercise={current}
          sets={setsOf(records, current.id)}
          unit={unit}
          scrollIntoView={logged > 0}
          onLogged={(isWarmup) => onLogged(current, isWarmup)}
        />
      )}

      {upNext.length > 0 && (
        <ExerciseList
          label="Up next"
          exercises={upNext}
          records={records}
          onOpen={(id) => setCurrentId(id)}
        />
      )}
      {done.length > 0 && (
        <ExerciseList
          label="Done"
          exercises={done}
          records={records}
          onOpen={(id) => setCurrentId(id)}
        />
      )}

      <div className="workout__finish">
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

      <RestBar workout={workout} records={records} />
    </main>
  );
}

/** The app bar, with the elapsed time ticking under the routine's name. It stays put (§7.3). */
function WorkoutBar({ workout, syncedAt }: { workout: WorkoutRecord; syncedAt: number }) {
  const now = useNow();
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

const range = (exercise: WorkoutExerciseRecord) =>
  exercise.row.repLow === exercise.row.repHigh
    ? String(exercise.row.repLow)
    : `${exercise.row.repLow}–${exercise.row.repHigh}`;

/** The current exercise: its header, warm-ups, completed sets and the active set card. */
function ExerciseBlock({
  exercise,
  sets,
  unit,
  scrollIntoView,
  onLogged,
}: {
  exercise: WorkoutExerciseRecord;
  sets: SetRecord[];
  unit: WeightUnit;
  scrollIntoView: boolean;
  onLogged: (isWarmup: boolean) => void;
}) {
  const warmups = sets.filter((set) => set.row.isWarmup);
  const completed = working(sets);
  const heading = useId();
  const figures = (set: { weightKg: number; reps: number }) =>
    `${formatWeight(set.weightKg, unit)} × ${set.reps}`;

  return (
    <section aria-labelledby={heading}>
      <div className="exercise-head">
        <h2 id={heading} className="exercise-head__name">
          {exercise.local.name}
        </h2>
        <span className="exercise-head__meta">
          <span className="visually-hidden">Reps </span>
          {range(exercise)} · <span className="visually-hidden">increment </span>+
          {formatWeight(exercise.row.incrementKg, unit)}
        </span>
      </div>

      {warmups.length > 0 && <Warmups sets={warmups} figures={figures} unit={unit} />}

      {completed.length > 0 && (
        <table className="sets" aria-label={`${exercise.local.name}, completed sets`}>
          <thead>
            <tr className="sets__row sets__row--head">
              <th scope="col">Set</th>
              <th scope="col">Last</th>
              <th scope="col">{unitLabel(unit)}</th>
              <th scope="col">Reps</th>
              <th scope="col">RIR</th>
              <th scope="col">
                <span className="visually-hidden">Done</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {completed.map((set, index) => {
              const last = exercise.local.lastTime[index];
              return (
                <tr key={set.id} className="sets__row">
                  <td className="sets__number">{index + 1}</td>
                  <td className="sets__last">{last === undefined ? '' : figures(last)}</td>
                  <td className="sets__figure">{formatWeight(set.row.weightKg, unit)}</td>
                  <td className="sets__figure">{set.row.reps}</td>
                  <td className="sets__number">{set.row.rir ?? '—'}</td>
                  <td className="sets__check">
                    <span className="check-cell check-cell--done">
                      <CheckIcon size={17} color="var(--done)" />
                      <span className="visually-hidden">Done</span>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <ActiveSet
        key={sets.length}
        exercise={exercise}
        completed={completed}
        unit={unit}
        scrollIntoView={scrollIntoView}
        onLogged={onLogged}
      />
    </section>
  );
}

/** Warm-ups collapse to one row and expand in place, as compact rows for review (docs/10 §7.2). */
function Warmups({
  sets,
  figures,
  unit,
}: {
  sets: SetRecord[];
  figures: (set: { weightKg: number; reps: number }) => string;
  unit: WeightUnit;
}) {
  const [expanded, setExpanded] = useState(false);
  const list = useId();
  return (
    <div className="warmups">
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

/** Why a set was not logged, and the figure to correct when one is at fault. */
type Refusal = { field?: 'kg' | 'reps' | 'rir'; message: string };

/** `SET 3 OF 4` while the target stands, `SET 5 · EXTRA` past it, `SET 3` with no target. */
function setLabel(number: number, target: number | null) {
  if (target === null) return `SET ${number}`;
  return number <= target ? `SET ${number} OF ${target}` : `SET ${number} · EXTRA`;
}

/**
 * The active set card (docs/10 §1): the one place the 56px figures appear. The weight opens on the
 * last set logged today, else on the suggestion; reps and RIR open empty, on placeholders, and the
 * set can be completed as it stands. The suggestion never overwrites what is typed (S3).
 */
function ActiveSet({
  exercise,
  completed,
  unit,
  scrollIntoView,
  onLogged,
}: {
  exercise: WorkoutExerciseRecord;
  completed: SetRecord[];
  unit: WeightUnit;
  scrollIntoView: boolean;
  onLogged: (isWarmup: boolean) => void;
}) {
  const { lastTime, suggestion, bodyweight } = exercise.local;
  const number = completed.length + 1;
  const last = lastTime[completed.length];
  const previous = completed.at(-1);
  const openingKg = previous?.row.weightKg ?? suggestion?.weightKg ?? (bodyweight ? 0 : null);
  const opening = openingKg === null ? '' : formatWeight(openingKg, unit);
  const [kg, setKg] = useState(opening);
  const [reps, setReps] = useState('');
  const [rir, setRir] = useState('');
  const [warm, setWarm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<Refusal>();
  const card = useRef<HTMLElement>(null);
  const ids = { kg: useId(), reps: useId(), rir: useId(), error: useId(), label: useId() };

  // A new weight starts at the bottom of the range; a repeated one aims at last time's reps.
  const suggestedReps =
    suggestion?.rule === 'top_of_range_hit'
      ? exercise.row.repLow
      : (last?.reps ?? exercise.row.repLow);

  // The card a completed set promotes comes into view and takes focus, so the next thing read and
  // reached is the next set (docs/10 §7.3). `nearest` moves nothing when it is already in view.
  useEffect(() => {
    if (!scrollIntoView) return;
    card.current?.focus({ preventScroll: true });
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    card.current?.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' });
  }, [scrollIntoView]);

  /** What the server would refuse is refused here, so a logged set is never one it turns away. */
  const read = (): Refusal | { weightKg: number; reps: number; rir: number | null } => {
    const typedWeight = parseFigure(kg);
    const typedReps = parseFigure(reps) ?? suggestedReps;
    const typedRir = parseFigure(rir);
    if (typedWeight === null) return { field: 'kg', message: 'Enter the weight' };
    if (!Number.isFinite(typedWeight) || typedWeight < 0 || toKg(typedWeight, unit) > 9999.99) {
      return { field: 'kg', message: 'Enter the weight as a number, in digits only' };
    }
    if (!Number.isInteger(typedReps) || typedReps < 1 || typedReps > 100) {
      return { field: 'reps', message: 'Reps are a whole number, 1 to 100' };
    }
    if (typedRir !== null && (!Number.isInteger(typedRir) || typedRir < 0 || typedRir > 10)) {
      return { field: 'rir', message: 'RIR is a whole number, 0 to 10, or empty' };
    }
    const weightKg = openingKg !== null && kg === opening ? openingKg : toKg(typedWeight, unit);
    return { weightKg, reps: typedReps, rir: typedRir };
  };

  const complete = async () => {
    // The tap that completes a set is the gesture that lets the rest tone play (docs/03 §11).
    unlockTone();
    const figures = read();
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

  return (
    <section ref={card} className="active-set" aria-labelledby={ids.label} tabIndex={-1}>
      <div className="active-set__label-row">
        <span id={ids.label} className="active-set__label">
          {warm ? 'WARM-UP' : setLabel(number, exercise.row.targetSets)}
        </span>
        {last !== undefined && !warm && (
          <span className="active-set__last">
            <span className="active-set__last-word">LAST</span>
            {formatWeight(last.weightKg, unit)} × {last.reps}
          </span>
        )}
        {lastTime.length === 0 && <span className="active-set__last-word">first workout</span>}
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
          onChange={setReps}
          placeholder={String(suggestedReps)}
          describedBy={refusal?.field === 'reps' ? ids.error : undefined}
        />
        <Figure
          id={ids.rir}
          name="rir"
          label="RIR"
          spoken="Reps in reserve, optional"
          value={rir}
          onChange={setRir}
          placeholder="—"
          describedBy={refusal?.field === 'rir' ? ids.error : undefined}
        />
      </div>

      {refusal !== undefined && (
        <div role="alert">
          <FieldError id={ids.error} message={refusal.message} />
        </div>
      )}

      {suggestion !== null && (
        <div className="active-set__suggestion">
          <span className="active-set__last-word">SUGGESTED</span>
          <span className="active-set__chip">
            {formatWeight(suggestion.weightKg, unit)}
            <span className="visually-hidden"> {unit === 'lb' ? 'pounds' : 'kilograms'}:</span>
          </span>
          <span className="active-set__reason">{suggestion.reason}</span>
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
          return (
            <li key={exercise.id}>
              <button type="button" className="up-next__row" onClick={() => onOpen(exercise.id)}>
                <span className="up-next__name">{exercise.local.name}</span>
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
 * The rest bar (docs/05 §4.14), pinned to the bottom. Rest counts from the last set's
 * `performedAt`, so a locked phone or a relaunch does not stop it (docs/09 F3). At zero it plays the
 * tone, turns to the accent and counts over until dismissed or the next set (docs/06, 2026-10-03).
 */
function RestBar({ workout, records }: { workout: WorkoutRecord; records: StoreRecord[] }) {
  const now = useNow();
  const rest = useWorkoutStore((state) => state.rest);
  const set = records.find(
    (record): record is SetRecord =>
      record.table === 'sets' && record.id === rest?.setId && record.workoutId === workout.id,
  );
  const exercise = exercisesOf(records, workout.id).find(
    (candidate) => candidate.id === set?.row.workoutExerciseId,
  );
  const total = (exercise?.local.restSeconds ?? 0) + (rest?.extraSeconds ?? 0);
  const elapsed = set === undefined ? 0 : (now - new Date(set.row.performedAt).getTime()) / 1000;
  const remaining = total - elapsed;
  const shown = rest !== undefined && set !== undefined && !rest.dismissed;
  const resting = shown && remaining > 0;
  const over = shown && remaining <= 0;

  // The tone, once, as the count reaches zero while the app is on screen.
  const wasResting = useRef(false);
  useEffect(() => {
    if (wasResting.current && over && remaining > -2) playTone();
    wasResting.current = resting;
  }, [resting, over, remaining]);

  // The screen stays awake for the length of the rest, where the browser allows it.
  useEffect(() => (resting ? keepAwake() : undefined), [resting]);

  if (!shown) return null;
  return (
    <section className={over ? 'rest-bar rest-bar--over' : 'rest-bar'} aria-label="Rest timer">
      <div className="rest-bar__track">
        <div
          className="rest-bar__fill"
          style={{ width: `${over ? 100 : Math.min(100, (elapsed / total) * 100)}%` }}
        />
      </div>
      <div className="rest-bar__body">
        <div>
          <div className="rest-bar__label">{over ? 'REST OVER' : 'REST'}</div>
          <div className="rest-bar__timer" role="timer">
            {over ? `+${duration(-remaining)}` : duration(Math.ceil(remaining))}
          </div>
        </div>
        <output className="visually-hidden">{over ? 'Rest over' : ''}</output>
        <div className="rest-bar__actions">
          {resting && (
            <button
              type="button"
              className="rest-bar__extend"
              onClick={() => extendRest(set.id, 30)}
            >
              +30s
              <span className="visually-hidden"> rest</span>
            </button>
          )}
          <button type="button" className="rest-bar__skip" onClick={() => dismissRest(set.id)}>
            {over ? 'DISMISS' : 'SKIP'}
            <span className="visually-hidden"> rest</span>
          </button>
        </div>
      </div>
    </section>
  );
}
