import type { Equipment, Exercise, MuscleGroup, WeightUnit } from '@overload/api-contract';
import { useQuery } from '@tanstack/react-query';
import { useId, useState, type ReactNode } from 'react';
import { api, expectOk, unwrap } from '../api';
import {
  AppBar,
  DeleteConfirm,
  Notice,
  NumberField,
  DataState,
  TextField,
  parseFigure,
} from '../components';
import { classIncrementKg, equipmentLabels, newExerciseDefaults } from '../equipment';
import { muscleGroupLabels } from '../exercise-list';
import { newId } from '../ids';
import {
  allExercisesQuery,
  currentWeightUnit,
  forAccount,
  refreshExercises,
  useAccount,
  useOpensEditor,
} from '../query';
import { formatWeight, toKg } from '../units';
import {
  SaveNotice,
  refusedOnDevice,
  saveProblem,
  unreadableFigures,
  useFocusRefused,
  type SaveProblem,
} from '../saving';

// S8's write half (docs/10 §8.1): a new custom exercise, an edit of one, or the caller's own values
// for a seeded one. A seeded exercise is nobody's to rename; its figures are overridden per user and
// `null` restores the default (docs/07 §3.2).

type Figures = { incrementKg: string; restSeconds: string; repLow: string; repHigh: string };
type FigureKey = keyof Figures;

const figuresOf = (exercise: Exercise, unit: WeightUnit): Figures => ({
  incrementKg: formatWeight(exercise.incrementKg, unit),
  restSeconds: String(exercise.restSeconds),
  repLow: String(exercise.repLow),
  repHigh: String(exercise.repHigh),
});

/** The setting as it stands: the caller's own values, and null where the default applies. */
const settingOf = (exercise: Exercise) => ({
  incrementKg: exercise.overrides.incrementKg ? exercise.incrementKg : null,
  restSeconds: exercise.overrides.restSeconds ? exercise.restSeconds : null,
  repLow: exercise.overrides.repLow ? exercise.repLow : null,
  repHigh: exercise.overrides.repHigh ? exercise.repHigh : null,
  hidden: exercise.hidden,
});

/** Omitted rather than null: a PATCH or create leaves an empty field to the stored or default value. */
const figureOrOmit = (value: string) => parseFigure(value) ?? undefined;

export function ExerciseForm({
  exercise,
  slot,
  back,
  onDone,
}: {
  /** Absent for a new custom exercise. */
  exercise: Exercise | undefined;
  slot: ReactNode;
  back: { label: string; onClick: () => void };
  /** After a save, with the exercise as it now is; after a delete, with nothing. */
  onDone: (saved: Exercise | undefined) => void;
}) {
  const creating = exercise === undefined;
  const seeded = exercise !== undefined && !exercise.custom;
  const [id] = useState(() => exercise?.id ?? newId());
  const [name, setName] = useState(exercise?.name ?? '');
  const [equipment, setEquipment] = useState<Equipment>(exercise?.equipment ?? 'barbell');
  // Empty for none: the library then lists it apart from the groups.
  const [muscleGroup, setMuscleGroup] = useState<MuscleGroup | ''>(exercise?.muscleGroup ?? '');
  // The increment is shown and typed in the user's unit, and stored in kilograms.
  const [unit] = useState(currentWeightUnit);
  const [figures, setFigures] = useState<Figures>(
    exercise === undefined
      ? {
          incrementKg: formatWeight(classIncrementKg.barbell, unit),
          restSeconds: String(newExerciseDefaults.restSeconds),
          repLow: String(newExerciseDefaults.repLow),
          repHigh: String(newExerciseDefaults.repHigh),
        }
      : figuresOf(exercise, unit),
  );
  const [touched, setTouched] = useState<Set<FigureKey>>(new Set());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<SaveProblem>();
  const formRef = useFocusRefused(problem);
  const equipmentId = useId();
  const muscleGroupId = useId();

  const fieldError = (path: string) =>
    problem?.kind === 'refused' ? problem.fields.get(path) : undefined;

  const setFigure = (key: FigureKey) => (value: string) => {
    setFigures((current) => ({ ...current, [key]: value }));
    setTouched((current) => new Set(current).add(key));
  };

  /** Whether a seeded exercise's figure is the user's own: set before, or changed now. */
  const own = (key: FigureKey) => exercise?.overrides[key] === true || touched.has(key);
  /** The user's own value for a figure, or null to fall back to the default. */
  const ownFigure = (key: FigureKey) => (own(key) ? parseFigure(figures[key]) : null);
  /**
   * The increment in kilograms. Left as it was shown, or typed back to it, it is the stored value:
   * pounds turned back to kilograms would move it by a hundredth.
   */
  const incrementKg = () => {
    const typed = parseFigure(figures.incrementKg);
    if (typed === null) return null;
    const shownKg = exercise?.incrementKg ?? classIncrementKg[equipment];
    if (figures.incrementKg === formatWeight(shownKg, unit)) return shownKg;
    return toKg(typed, unit);
  };

  async function run(write: () => Promise<Exercise | undefined>) {
    setBusy(true);
    setProblem(undefined);
    try {
      const saved = await forAccount(write);
      await refreshExercises();
      onDone(saved);
    } catch (error) {
      setProblem(saveProblem(error));
      setBusy(false);
    }
  }

  const putSetting = async (body: ReturnType<typeof settingOf>) =>
    unwrap(await api.PUT('/api/exercises/{id}/setting', { params: { path: { id } }, body }));

  const save = () => {
    const refused = refusedOnDevice(unreadableFigures(Object.entries(figures)));
    if (refused !== undefined) return setProblem(refused);
    return run(async () => {
      if (creating) {
        return unwrap(
          await api.POST('/api/exercises', {
            body: {
              id,
              name,
              equipment,
              muscleGroup: muscleGroup === '' ? null : muscleGroup,
              incrementKg: incrementKg() ?? undefined,
              restSeconds: figureOrOmit(figures.restSeconds),
              repLow: figureOrOmit(figures.repLow),
              repHigh: figureOrOmit(figures.repHigh),
            },
          }),
        );
      }
      if (!seeded) {
        return unwrap(
          await api.PATCH('/api/exercises/{id}', {
            params: { path: { id } },
            body: {
              name,
              equipment,
              muscleGroup: muscleGroup === '' ? null : muscleGroup,
              incrementKg: incrementKg() ?? undefined,
              restSeconds: figureOrOmit(figures.restSeconds),
              repLow: figureOrOmit(figures.repLow),
              repHigh: figureOrOmit(figures.repHigh),
            },
          }),
        );
      }
      return putSetting({
        incrementKg: own('incrementKg') ? incrementKg() : null,
        restSeconds: ownFigure('restSeconds'),
        repLow: ownFigure('repLow'),
        repHigh: ownFigure('repHigh'),
        hidden: exercise.hidden,
      });
    });
  };

  const setHidden = (hidden: boolean) => {
    if (exercise === undefined) return;
    void run(() => putSetting({ ...settingOf(exercise), hidden }));
  };

  const restoreDefaults = () => {
    if (exercise === undefined) return;
    void run(() =>
      putSetting({
        incrementKg: null,
        restSeconds: null,
        repLow: null,
        repHigh: null,
        hidden: exercise.hidden,
      }),
    );
  };

  const remove = () =>
    run(async () => {
      expectOk(await api.DELETE('/api/exercises/{id}', { params: { path: { id } } }));
      return undefined;
    });

  const note = (key: FigureKey) => {
    if (!seeded) return undefined;
    return own(key) ? 'Yours' : 'Default';
  };
  const anyOwn = exercise !== undefined && Object.values(exercise.overrides).some(Boolean);

  return (
    <main>
      <AppBar
        title={creating ? 'New exercise' : exercise.name}
        subline={exercise === undefined ? undefined : subline(exercise)}
        slot={slot}
        back={back}
      />
      <SaveNotice problem={problem} what="exercise" />
      <form
        ref={formRef}
        className="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void save();
        }}
      >
        {!seeded && (
          <>
            <TextField
              label="Name"
              value={name}
              onChange={setName}
              error={fieldError('name')}
              placeholder="Cable Y-Raise…"
              focusOnOpen={creating}
            />
            <div className="field">
              <div className="field__label-row">
                <label htmlFor={equipmentId} className="field__label">
                  Equipment
                </label>
              </div>
              <select
                id={equipmentId}
                className="field__input field__select"
                value={equipment}
                onChange={(event) => {
                  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the options are the Equipment values
                  const next = event.target.value as Equipment;
                  setEquipment(next);
                  // A new exercise's step follows its class until the user types one.
                  if (creating && !touched.has('incrementKg')) {
                    setFigures((current) => ({
                      ...current,
                      incrementKg: formatWeight(classIncrementKg[next], unit),
                    }));
                  }
                }}
              >
                {Object.entries(equipmentLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <div className="field__label-row">
                <label htmlFor={muscleGroupId} className="field__label">
                  Muscle group
                </label>
              </div>
              <select
                id={muscleGroupId}
                className="field__input field__select"
                value={muscleGroup}
                onChange={(event) => {
                  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the options are the MuscleGroup values and none
                  setMuscleGroup(event.target.value as MuscleGroup | '');
                }}
              >
                <option value="">None</option>
                {Object.entries(muscleGroupLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        {seeded && (
          <p className="form__lede">
            Your own step, rest and rep range for this exercise. Only you see them.
          </p>
        )}

        <div className="form__pair">
          <NumberField
            label="Increment"
            unit={unit}
            decimal
            value={figures.incrementKg}
            onChange={setFigure('incrementKg')}
            error={fieldError('incrementKg')}
            note={note('incrementKg')}
          />
          <NumberField
            label="Rest"
            unit="s"
            value={figures.restSeconds}
            onChange={setFigure('restSeconds')}
            error={fieldError('restSeconds')}
            note={note('restSeconds')}
          />
        </div>
        <div className="form__pair">
          <NumberField
            label="Reps low"
            value={figures.repLow}
            onChange={setFigure('repLow')}
            error={fieldError('repLow')}
            note={note('repLow')}
          />
          <NumberField
            label="Reps high"
            value={figures.repHigh}
            onChange={setFigure('repHigh')}
            error={fieldError('repHigh')}
            note={note('repHigh')}
          />
        </div>

        <button type="submit" className="button button--primary" disabled={busy}>
          {busy ? 'Saving…' : creating ? 'Create exercise' : 'Save'}
        </button>
      </form>

      {exercise !== undefined && (
        <section className="form form--secondary" aria-label="More">
          {seeded && anyOwn && (
            <button
              type="button"
              className="button button--secondary"
              disabled={busy}
              onClick={restoreDefaults}
            >
              Restore defaults
            </button>
          )}
          <button
            type="button"
            className="button button--secondary"
            disabled={busy}
            onClick={() => setHidden(!exercise.hidden)}
          >
            {exercise.hidden ? 'Show in pickers again' : 'Hide from pickers'}
          </button>
          {exercise.custom && (
            <DeleteConfirm
              label="Delete exercise"
              question={`Delete ${exercise.name}? This can’t be undone.`}
              busy={busy}
              onDelete={() => void remove()}
            />
          )}
        </section>
      )}
    </main>
  );
}

function subline(exercise: Exercise) {
  const parts = [exercise.custom ? 'YOURS' : 'LIBRARY', equipmentLabels[exercise.equipment]];
  if (exercise.hidden) parts.push('HIDDEN');
  return parts.join(' · ').toUpperCase();
}

/** `/exercises/new` and `/exercises/{id}`: the form, once the exercise has loaded. */
export function ExerciseScreen({
  id,
  navigate,
}: {
  id: string | undefined;
  navigate: (path: string, options?: { replace?: boolean }) => void;
}) {
  const confirmed = useAccount().status === 'confirmed';
  const exercises = useQuery({ ...allExercisesQuery, enabled: confirmed });
  const slot = <DataState at={exercises.dataUpdatedAt} />;
  const back = { label: 'Back to exercises', onClick: () => navigate('/exercises') };
  const done = () => navigate('/exercises', { replace: true });
  const opens = useOpensEditor(exercises);

  if (id === undefined) {
    return <ExerciseForm exercise={undefined} slot={slot} back={back} onDone={done} />;
  }
  if (!opens) {
    return (
      <main>
        <AppBar title="Exercise" slot={slot} back={back} />
      </main>
    );
  }
  const exercise = exercises.data?.find((candidate) => candidate.id === id);
  if (exercise === undefined) {
    return (
      <main>
        <AppBar title="Exercise" slot={slot} back={back} />
        {exercises.isError && (
          <Notice tone="flag" word="Not updated">
            Couldn’t reach Overload. Try again when you have signal.
          </Notice>
        )}
        {exercises.data !== undefined && (
          <p className="empty">This exercise is not in your library.</p>
        )}
      </main>
    );
  }
  return (
    <ExerciseForm key={exercise.id} exercise={exercise} slot={slot} back={back} onDone={done} />
  );
}
