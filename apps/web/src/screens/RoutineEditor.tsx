import type { Exercise, Routine } from '@overload/api-contract';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { api, expectOk, unwrap } from '../api';
import {
  AppBar,
  Chevron,
  DeleteConfirm,
  FieldError,
  Notice,
  NumberField,
  SyncedAt,
  TextField,
  parseFigure,
} from '../components';
import { newId } from '../ids';
import {
  allExercisesQuery,
  forAccount,
  refreshRoutines,
  routinesQuery,
  useAccount,
} from '../query';
import {
  SaveNotice,
  refusedOnDevice,
  saveProblem,
  unreadableFigures,
  useFocusRefused,
  type SaveProblem,
} from '../saving';
import { ExerciseForm } from './ExerciseForm';
import { ExercisePicker } from './ExercisePicker';

// S4's routine editor (docs/09 F2 step 2, docs/10 §8.1). A routine is saved only on Save, and
// leaving discards the edit. The picker and the new-exercise form open inside this screen, so what is
// typed here survives them.

type DraftSlot = {
  id: string;
  exerciseId: string;
  targetSets: string;
  repLow: string;
  repHigh: string;
};

const draftOf = (routine: Routine | undefined): DraftSlot[] =>
  (routine?.exercises ?? []).map((slot) => ({
    id: slot.id,
    exerciseId: slot.exerciseId,
    targetSets: String(slot.targetSets),
    repLow: slot.repLow === null ? '' : String(slot.repLow),
    repHigh: slot.repHigh === null ? '' : String(slot.repHigh),
  }));

/** The slot list as the API takes it. An empty rep field falls back to the exercise's range. */
const slotsBody = (slots: DraftSlot[]) =>
  slots.map((slot) => ({
    id: slot.id,
    exerciseId: slot.exerciseId,
    targetSets: parseFigure(slot.targetSets) ?? undefined,
    repLow: parseFigure(slot.repLow),
    repHigh: parseFigure(slot.repHigh),
  }));

/** Slots with one end of the rep range set: refused on the missing end, as the server would. */
const halfSetRanges = (slots: DraftSlot[]): [path: string, message: string][] =>
  slots.flatMap((slot, index) => {
    const low = slot.repLow.trim() !== '';
    const high = slot.repHigh.trim() !== '';
    if (low === high) return [];
    const missing = low ? 'repHigh' : 'repLow';
    return [[`exercises.${index}.${missing}`, 'Set both ends of the range, or neither']];
  });

export function RoutineEditor({
  routine,
  exercises,
  exercisesFailed,
  slot,
  navigate,
}: {
  /** Absent for a new routine. */
  routine: Routine | undefined;
  /** The caller's whole library, hidden exercises included, or undefined while it loads. */
  exercises: Exercise[] | undefined;
  exercisesFailed: boolean;
  slot: ReactNode;
  navigate: (path: string, options?: { replace?: boolean }) => void;
}) {
  const [id] = useState(() => routine?.id ?? newId());
  const [name, setName] = useState(routine?.name ?? '');
  const [slots, setSlots] = useState<DraftSlot[]>(() => draftOf(routine));
  const [mode, setMode] = useState<'edit' | 'pick' | 'new-exercise'>('edit');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<SaveProblem>();
  const formRef = useFocusRefused(problem);
  // Where focus goes once the next render lands, when the element that had it is gone: the slot now
  // at a removed slot's place, or Add exercises on the way back from the picker.
  const focusNext = useRef<number | 'add'>(undefined);
  const listRef = useRef<HTMLOListElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const next = focusNext.current;
    if (next === undefined) return;
    focusNext.current = undefined;
    const removes = listRef.current?.querySelectorAll<HTMLButtonElement>('.slot__remove') ?? [];
    const slotButton = next === 'add' ? undefined : removes[Math.min(next, removes.length - 1)];
    (slotButton ?? addRef.current)?.focus();
  });

  const byId = new Map((exercises ?? []).map((exercise) => [exercise.id, exercise]));
  const pickable = exercises?.filter((exercise) => !exercise.hidden);
  const fieldError = (path: string) =>
    problem?.kind === 'refused' ? problem.fields.get(path) : undefined;
  const back = () => navigate('/routines');

  const addSlots = (exerciseIds: string[]) => {
    setSlots((current) => [
      ...current,
      ...exerciseIds.map((exerciseId) => ({
        id: newId(),
        exerciseId,
        targetSets: '3',
        repLow: '',
        repHigh: '',
      })),
    ]);
    backToEdit();
  };

  const backToEdit = () => {
    focusNext.current = 'add';
    setMode('edit');
  };

  const removeSlot = (index: number) => {
    focusNext.current = index;
    setSlots((current) => current.filter((_, i) => i !== index));
  };

  const updateSlot = (slotId: string, change: Partial<DraftSlot>) =>
    setSlots((current) => current.map((s) => (s.id === slotId ? { ...s, ...change } : s)));

  const move = (index: number, by: -1 | 1) =>
    setSlots((current) => {
      const next = [...current];
      const [moved] = next.splice(index, 1);
      if (moved === undefined) return current;
      next.splice(index + by, 0, moved);
      return next;
    });

  /** `slotsSaved` says whether the slots already landed when a later call failed. */
  async function run(write: () => Promise<void>, slotsSaved = () => false) {
    setBusy(true);
    setProblem(undefined);
    try {
      await forAccount(write);
      await refreshRoutines();
      navigate('/routines', { replace: true });
    } catch (error) {
      const failed = saveProblem(error);
      if (slotsSaved()) {
        await refreshRoutines();
        if (failed.kind === 'refused') failed.saved = 'The exercises were saved; the name was not.';
      }
      setProblem(failed);
      setBusy(false);
    }
  }

  const save = () => {
    const refused = refusedOnDevice([
      ...unreadableFigures(
        slots.flatMap((s, index) =>
          (['targetSets', 'repLow', 'repHigh'] as const).map((field): [string, string] => [
            `exercises.${index}.${field}`,
            s[field],
          ]),
        ),
      ),
      ...halfSetRanges(slots),
    ]);
    if (refused !== undefined) return setProblem(refused);
    let slotsSaved = false;
    return run(
      async () => {
        if (routine === undefined) {
          unwrap(
            await api.POST('/api/routines', { body: { id, name, exercises: slotsBody(slots) } }),
          );
          return;
        }
        const path = { params: { path: { id } } };
        const body = slotsBody(slots);
        if (JSON.stringify(body) !== JSON.stringify(slotsBody(draftOf(routine)))) {
          unwrap(
            await api.PUT('/api/routines/{id}/exercises', { ...path, body: { exercises: body } }),
          );
          slotsSaved = true;
        }
        if (name.trim() !== routine.name) {
          unwrap(await api.PATCH('/api/routines/{id}', { ...path, body: { name } }));
        }
      },
      () => slotsSaved,
    );
  };

  const remove = () =>
    run(async () => {
      expectOk(await api.DELETE('/api/routines/{id}', { params: { path: { id } } }));
    });

  if (mode === 'pick') {
    return (
      <ExercisePicker
        exercises={pickable}
        failed={exercisesFailed}
        slot={slot}
        onCancel={backToEdit}
        onAdd={addSlots}
        onCreate={() => setMode('new-exercise')}
      />
    );
  }
  if (mode === 'new-exercise') {
    return (
      <ExerciseForm
        exercise={undefined}
        slot={slot}
        back={{ label: 'Back to the picker', onClick: () => setMode('pick') }}
        onDone={(created) => (created === undefined ? setMode('pick') : addSlots([created.id]))}
      />
    );
  }

  const totalSets = slots.reduce((sum, s) => sum + (parseFigure(s.targetSets) || 0), 0);

  return (
    <main>
      <AppBar
        title={routine === undefined ? 'New routine' : routine.name}
        subline={`${slots.length} ${slots.length === 1 ? 'EXERCISE' : 'EXERCISES'} · ${totalSets} SETS`}
        slot={slot}
        back={{ label: 'Back to routines', onClick: back }}
      />
      <SaveNotice problem={problem} what="routine" />

      <form
        ref={formRef}
        className="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void save();
        }}
      >
        <TextField
          label="Name"
          value={name}
          onChange={setName}
          error={fieldError('name')}
          placeholder="Push A…"
          focusOnOpen={routine === undefined}
        />

        <section aria-labelledby="slots-heading" className="slots">
          <h2 id="slots-heading" className="section-label">
            Exercises
          </h2>
          {slots.length === 0 ? (
            <p className="empty empty--flush">
              No exercises yet. Add them in the order you do them.
            </p>
          ) : (
            <ol className="slots__list" ref={listRef}>
              {slots.map((draft, index) => (
                <SlotRow
                  key={draft.id}
                  draft={draft}
                  index={index}
                  last={index === slots.length - 1}
                  exercise={byId.get(draft.exerciseId)}
                  fieldError={(field) => fieldError(`exercises.${index}.${field}`)}
                  onChange={(change) => updateSlot(draft.id, change)}
                  onMove={(by) => move(index, by)}
                  onRemove={() => removeSlot(index)}
                />
              ))}
            </ol>
          )}
          <button
            ref={addRef}
            type="button"
            className="button button--secondary"
            onClick={() => setMode('pick')}
          >
            Add exercises
          </button>
        </section>

        <button type="submit" className="button button--primary button--terminal" disabled={busy}>
          {busy ? 'Saving…' : routine === undefined ? 'Create routine' : 'Save routine'}
        </button>
      </form>

      {routine !== undefined && (
        <section className="form form--secondary" aria-label="More">
          <DeleteConfirm
            label="Delete routine"
            question={`Delete ${routine.name}? Its exercises stay in your library.`}
            busy={busy}
            onDelete={() => void remove()}
          />
        </section>
      )}
    </main>
  );
}

function SlotRow({
  draft,
  index,
  last,
  exercise,
  fieldError,
  onChange,
  onMove,
  onRemove,
}: {
  draft: DraftSlot;
  index: number;
  last: boolean;
  exercise: Exercise | undefined;
  fieldError: (field: string) => string | undefined;
  onChange: (change: Partial<DraftSlot>) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const errorsId = useId();
  const name = exercise?.name ?? 'Exercise not in your library';
  const exerciseError = fieldError('exerciseId');
  // The slot's figures are too narrow to hold a message, so they are marked in place and every
  // message is printed once under them.
  const figureErrors = (['targetSets', 'repLow', 'repHigh'] as const).flatMap((field) => {
    const message = fieldError(field);
    return message === undefined ? [] : [message];
  });
  return (
    <li className="slot">
      <div className="slot__head">
        <span className="slot__index" aria-hidden="true">
          {index + 1}
        </span>
        <span className="slot__name">
          {name}
          {exercise?.hidden === true && <span className="slot__flag"> · Hidden</span>}
        </span>
        <button type="button" className="button button--tertiary slot__remove" onClick={onRemove}>
          Remove<span className="visually-hidden"> {name}</span>
        </button>
      </div>
      {exerciseError !== undefined && (
        <p className="slot__error" role="alert">
          <span className="field__error-word">Refused</span> {exerciseError}
        </p>
      )}
      <div className="slot__fields">
        <NumberField
          label="Sets"
          labelContext={`for ${name}`}
          value={draft.targetSets}
          onChange={(targetSets) => onChange({ targetSets })}
          error={fieldError('targetSets')}
          errorShownAt={errorsId}
        />
        <NumberField
          label="Reps low"
          labelContext={`for ${name}`}
          value={draft.repLow}
          placeholder={exercise === undefined ? '' : String(exercise.repLow)}
          onChange={(repLow) => onChange({ repLow })}
          error={fieldError('repLow')}
          errorShownAt={errorsId}
        />
        <NumberField
          label="Reps high"
          labelContext={`for ${name}`}
          value={draft.repHigh}
          placeholder={exercise === undefined ? '' : String(exercise.repHigh)}
          onChange={(repHigh) => onChange({ repHigh })}
          error={fieldError('repHigh')}
          errorShownAt={errorsId}
        />
        <div className="slot__moves">
          <button
            type="button"
            className="button button--secondary button--icon"
            // aria-disabled rather than disabled, so focus stays on the button that just moved.
            aria-disabled={index === 0}
            onClick={() => {
              if (index > 0) onMove(-1);
            }}
          >
            <Chevron direction="up" />
            <span className="visually-hidden">Move {name} up</span>
          </button>
          <button
            type="button"
            className="button button--secondary button--icon"
            aria-disabled={last}
            onClick={() => {
              if (!last) onMove(1);
            }}
          >
            <Chevron direction="down" />
            <span className="visually-hidden">Move {name} down</span>
          </button>
        </div>
      </div>
      {figureErrors.length > 0 && (
        <div className="slot__errors" id={errorsId}>
          {[...new Set(figureErrors)].map((message) => (
            <FieldError key={message} message={message} />
          ))}
        </div>
      )}
    </li>
  );
}

/** `/routines/new` and `/routines/{id}`: the editor, once what it edits has loaded. */
export function RoutineScreen({
  id,
  navigate,
}: {
  id: string | undefined;
  navigate: (path: string, options?: { replace?: boolean }) => void;
}) {
  const confirmed = useAccount().status === 'confirmed';
  const routines = useQuery({ ...routinesQuery, enabled: confirmed });
  const exercises = useQuery({ ...allExercisesQuery, enabled: confirmed });
  const slot = <SyncedAt at={routines.dataUpdatedAt} />;
  const back = { label: 'Back to routines', onClick: () => navigate('/routines') };

  if (id === undefined) {
    return (
      <RoutineEditor
        routine={undefined}
        exercises={exercises.data}
        exercisesFailed={exercises.isError}
        slot={slot}
        navigate={navigate}
      />
    );
  }
  const routine = routines.data?.find((candidate) => candidate.id === id);
  if (routine === undefined) {
    return (
      <main>
        <AppBar title="Routine" slot={slot} back={back} />
        {routines.isError && (
          <Notice tone="flag" word="Not updated">
            Couldn’t reach Overload. Try again when you have signal.
          </Notice>
        )}
        {routines.data !== undefined && (
          <p className="empty">This routine no longer exists. It may have been deleted.</p>
        )}
      </main>
    );
  }
  return (
    <RoutineEditor
      key={routine.id}
      routine={routine}
      exercises={exercises.data}
      exercisesFailed={exercises.isError}
      slot={slot}
      navigate={navigate}
    />
  );
}
