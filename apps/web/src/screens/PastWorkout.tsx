import type { Me, SetRow, WeightUnit, WorkoutDetail } from '@overload/api-contract';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../api';
import { AppBar, CheckIcon, Chevron, DataState, Notice } from '../components';
import { clockLabel, dayLabel, minutesBetween } from '../dates';
import { removedOnDevice, workingSets, workoutOnDevice } from '../history';
import { goBack, useEntryNote, type Navigate } from '../navigation';
import { useAccount, workoutQuery } from '../query';
import { SetEditor } from '../set-editor';
import { deviceTimezone } from '../timezones';
import { formatVolume, formatWeight, unitLabel, unitName } from '../units';
import { deletePastSet, editPastSet, recordsOf, useWorkoutStore } from '../workout';

// One workout from History (docs/10 §9, docs/09 F3a): every set as it was logged. A workout in
// progress on another device is read-only here. Finish lands here, so it serves as the finish
// summary. A workout the device still holds rows of is read from them (history.ts), which is how
// one finished or changed with no signal shows here at once.

const NOTES = {
  finished: 'Workout finished. It is in History from now on.',
  saved: 'Set saved. Charts, last time and the target use the new figures.',
  deleted: 'Set deleted. Charts, last time and the target no longer count it.',
};

export function PastWorkout({ id, me, navigate }: { id: string; me: Me; navigate: Navigate }) {
  // The saved copy shows until /api/me confirms the account; no fetch runs under an unconfirmed one.
  const confirmed = useAccount().status === 'confirmed';
  const records = useWorkoutStore((state) => recordsOf(state, me.user.id));
  const syncedAt = useWorkoutStore((state) => state.lastSyncedAt);
  const held = workoutOnDevice(records, id);
  const removed = removedOnDevice(records, id);
  const stored = useQuery({ ...workoutQuery(id), enabled: confirmed && held === undefined });
  const workout = held ?? (removed ? undefined : stored.data);
  const unit = me.profile?.weightUnit ?? 'kg';
  const timeZone = me.profile?.timezone ?? deviceTimezone();
  const opened = useEntryNote();
  const [note, setNote] = useState<keyof typeof NOTES | undefined>(
    opened === 'finished' ? 'finished' : undefined,
  );
  // The set whose editor is open. One at a time.
  const [editing, setEditing] = useState<string>();

  // Focus goes back to the row an editor closed under, or to the screen when the row has gone.
  const top = useRef<HTMLElement>(null);
  const focusPending = useRef<string>(null);
  useEffect(() => {
    const target = focusPending.current;
    if (target === null) return;
    focusPending.current = null;
    (document.getElementById(target) ?? top.current)?.focus();
  });
  const close = (setId: string, said?: keyof typeof NOTES) => {
    focusPending.current = `set-${setId}`;
    setEditing(undefined);
    setNote(said);
  };

  const back = { label: 'Back', onClick: () => goBack(navigate, '/progress') };
  // The device's rows are as fresh as its last acknowledged upload; the server's copy, as its fetch.
  const slot = <DataState at={held === undefined ? stored.dataUpdatedAt : syncedAt} />;
  const unknown = removed || (stored.error instanceof ApiError && stored.error.status === 404);

  if (workout === undefined) {
    return (
      <main>
        <AppBar title="Workout" slot={slot} back={back} />
        {unknown && <p className="empty">This workout is not in your history.</p>}
        {!unknown && stored.isError && (
          <Notice tone="flag" word="Not loaded">
            Couldn’t reach Overload. Try again when you have signal.
          </Notice>
        )}
      </main>
    );
  }

  const exercises = workout.exercises.filter((exercise) => exercise.sets.length > 0);
  const working = exercises.flatMap((exercise) => workingSets(exercise.sets));
  const volumeKg = working.reduce((sum, set) => sum + set.weightKg * set.reps, 0);
  const minutes =
    workout.endedAt === null ? undefined : minutesBetween(workout.startedAt, workout.endedAt);
  const editable = held !== undefined || workout.endedAt !== null;
  const when = `${dayLabel(workout.startedAt, timeZone).toUpperCase()} · ${clockLabel(workout.startedAt, timeZone)}`;

  const save = async (set: SetRow, figures: Parameters<typeof editPastSet>[2]) => {
    await editPastSet(workout, set.id, figures);
    close(set.id, 'saved');
  };
  const remove = async (set: SetRow) => {
    if (await deletePastSet(workout, set.id)) {
      navigate('/progress', { replace: true, note: 'removed' });
      return;
    }
    close(set.id, 'deleted');
  };

  return (
    <main ref={top} tabIndex={-1}>
      <AppBar
        title={workout.name}
        subline={`${when} · ${minutes === undefined ? 'IN PROGRESS' : `${minutes} MIN`}`}
        slot={slot}
        back={back}
      />

      {stored.isError && held === undefined && (
        <Notice tone="flag" word="Not updated">
          Couldn’t reach Overload. Showing the last copy.
        </Notice>
      )}
      {note !== undefined && (
        <output className="saved-line">
          <CheckIcon size={13} color="var(--done)" />
          {NOTES[note]}
        </output>
      )}

      <dl className="stat-strip">
        <Stat label="Working sets" figure={String(working.length)} />
        <Stat label="Volume" figure={formatVolume(volumeKg, unit)} unit={unit} />
        {minutes !== undefined && <Stat label="Time" figure={String(minutes)} unit="min" />}
      </dl>

      {exercises.map((exercise) => (
        <ExerciseSets
          key={exercise.id}
          exercise={exercise}
          unit={unit}
          editable={editable}
          editing={editing}
          onOpen={(setId) => {
            setEditing(setId === editing ? undefined : setId);
            setNote(undefined);
          }}
          onChart={() => navigate(`/exercises/${exercise.exerciseId}/progress`, { returns: true })}
          onSave={save}
          onDelete={remove}
          onCancel={(setId) => close(setId)}
        />
      ))}
    </main>
  );
}

const SPOKEN_UNITS: Record<string, string> = { min: 'minutes' };

function Stat({ label, figure, unit }: { label: string; figure: string; unit?: string }) {
  return (
    <div className="progress__stat">
      <dt className="progress__stat-label">{label}</dt>
      <dd className="progress__stat-value">
        <span className="progress__stat-figure">{figure}</span>
        {unit !== undefined && (
          <>
            <span className="progress__stat-unit" aria-hidden="true">
              {unit}
            </span>
            <span className="visually-hidden">
              {SPOKEN_UNITS[unit] ?? unitName(unit === 'lb' ? 'lb' : 'kg')}
            </span>
          </>
        )}
      </dd>
    </div>
  );
}

type LoggedExercise = WorkoutDetail['exercises'][number];

/** One exercise of the workout: its name, which opens its chart, and every set it logged. */
function ExerciseSets({
  exercise,
  unit,
  editable,
  editing,
  onOpen,
  onChart,
  onSave,
  onDelete,
  onCancel,
}: {
  exercise: LoggedExercise;
  unit: WeightUnit;
  editable: boolean;
  editing: string | undefined;
  onOpen: (setId: string) => void;
  onChart: () => void;
  onSave: (set: SetRow, figures: Parameters<typeof editPastSet>[2]) => Promise<void>;
  onDelete: (set: SetRow) => Promise<void>;
  onCancel: (setId: string) => void;
}) {
  const working = workingSets(exercise.sets);
  return (
    <section className="hx" aria-labelledby={`exercise-${exercise.id}`}>
      <h2 id={`exercise-${exercise.id}`} className="hx__title">
        <a
          href={`/exercises/${exercise.exerciseId}/progress`}
          className="hx__head"
          onClick={(event) => {
            event.preventDefault();
            onChart();
          }}
        >
          <span className="hx__name">{exercise.name}</span>
          <span className="visually-hidden">: its chart and past sets</span>
          <Chevron direction="forward" />
        </a>
      </h2>
      <div className="hsets__head" aria-hidden="true">
        <span>Set</span>
        <span>{unitLabel(unit)}</span>
        <span>Reps</span>
        <span>RIR</span>
        <span />
      </div>
      <ul className="hsets">
        {exercise.sets.map((set) => {
          const number = working.indexOf(set) + 1;
          const name = set.isWarmup ? 'the warm-up set' : `set ${number}`;
          const open = editing === set.id;
          const rowClass = set.isWarmup ? 'hsets__row hsets__row--warm' : 'hsets__row';
          const cells = (
            <>
              <span className="sets__number">
                {set.isWarmup ? (
                  <>
                    <span aria-hidden="true">W</span>
                    <span className="visually-hidden">Warm-up set:</span>
                  </>
                ) : (
                  <>
                    <span className="visually-hidden">Set </span>
                    {number}
                    <span className="visually-hidden">:</span>
                  </>
                )}
              </span>
              <span className="sets__figure">
                {formatWeight(set.weightKg, unit)}
                <span className="visually-hidden"> {unitName(unit)},</span>
              </span>
              <span className="sets__figure">
                {set.reps}
                <span className="visually-hidden"> reps,</span>
              </span>
              <span className="sets__number">
                <span className="visually-hidden">RIR </span>
                {set.rir ?? (
                  <>
                    <span aria-hidden="true">—</span>
                    <span className="visually-hidden">not recorded</span>
                  </>
                )}
                <span className="visually-hidden">.</span>
              </span>
            </>
          );
          return (
            <li key={set.id}>
              {editable ? (
                <button
                  type="button"
                  id={`set-${set.id}`}
                  className={rowClass}
                  aria-expanded={open}
                  onClick={() => onOpen(set.id)}
                >
                  {cells}
                  <span className="hsets__edit">{open ? 'CLOSE' : 'EDIT'}</span>
                </button>
              ) : (
                <div className={rowClass}>{cells}</div>
              )}
              {open && (
                <SetEditor
                  set={set}
                  unit={unit}
                  name={name}
                  onSave={(figures) => onSave(set, figures)}
                  onDelete={() => onDelete(set)}
                  onCancel={() => onCancel(set.id)}
                />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
