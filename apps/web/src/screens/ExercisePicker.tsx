import type { Exercise } from '@overload/api-contract';
import { useMemo, useState, type ReactNode } from 'react';
import { AppBar, CheckIcon, Notice, TextField } from '../components';
import { equipmentLabels } from '../equipment';
import { ExerciseGroups, searchExercises } from '../exercise-list';

// S8's picker, opened from the routine editor (docs/09 F2 step 2, F5 step 1; docs/10 §8.1). Several
// exercises can be ticked at once, and they join the routine in the order they were ticked.

export function ExercisePicker({
  exercises,
  failed,
  slot,
  onCancel,
  onAdd,
  onCreate,
}: {
  /** The caller's library without hidden exercises, or undefined while it has not loaded. */
  exercises: Exercise[] | undefined;
  failed: boolean;
  slot: ReactNode;
  onCancel: () => void;
  onAdd: (exerciseIds: string[]) => void;
  onCreate: () => void;
}) {
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<string[]>([]);

  const shown = useMemo(() => searchExercises(exercises ?? [], search), [exercises, search]);

  const toggle = (id: string) =>
    setPicked((current) =>
      current.includes(id) ? current.filter((other) => other !== id) : [...current, id],
    );

  return (
    <main className="picker">
      <AppBar
        title="Add exercises"
        subline={picked.length === 0 ? undefined : `${picked.length} TICKED`}
        slot={slot}
        back={{ label: 'Back to the routine', onClick: onCancel }}
      />

      {failed && (
        <Notice tone="flag" word="Not updated">
          Couldn’t reach Overload.{' '}
          {exercises === undefined ? 'Try again when you have signal.' : 'Showing the last copy.'}
        </Notice>
      )}

      <div className="exercise-tools">
        <TextField
          label="Search"
          type="search"
          value={search}
          onChange={setSearch}
          placeholder="Bench, RDL, pec deck…"
        />
        <button type="button" className="button button--secondary" onClick={onCreate}>
          New exercise
        </button>
      </div>

      {exercises !== undefined && (
        <section aria-labelledby="picker-heading">
          <h2
            id="picker-heading"
            className="section-label section-label--gutter"
            aria-live="polite"
          >
            {search === '' ? 'Library' : `${shown.length} matching`}
          </h2>
          {shown.length === 0 ? (
            <p className="empty">
              Nothing matches. Check the spelling, or make it with <em>New exercise</em>.
            </p>
          ) : (
            <ExerciseGroups exercises={shown} listClassName="picker__list">
              {(exercise) => {
                const ticked = picked.includes(exercise.id);
                return (
                  <li key={exercise.id}>
                    <label className="picker__row">
                      {/* Invisible and over the whole row, so a tap anywhere on it ticks. */}
                      <input
                        type="checkbox"
                        className="picker__check"
                        checked={ticked}
                        aria-labelledby={`${exercise.id}-name`}
                        aria-describedby={`${exercise.id}-meta`}
                        onChange={() => toggle(exercise.id)}
                      />
                      <span
                        className={ticked ? 'check-cell check-cell--done' : 'check-cell'}
                        aria-hidden="true"
                      >
                        <CheckIcon color={ticked ? 'var(--done)' : 'var(--line-control)'} />
                      </span>
                      <span className="picker__name" id={`${exercise.id}-name`}>
                        {exercise.name}
                      </span>
                      <span className="picker__meta" id={`${exercise.id}-meta`}>
                        {exercise.custom ? 'Yours · ' : ''}
                        {equipmentLabels[exercise.equipment]}
                      </span>
                    </label>
                  </li>
                );
              }}
            </ExerciseGroups>
          )}
        </section>
      )}

      <div className="action-bar">
        <button
          type="button"
          className="button button--primary"
          disabled={picked.length === 0}
          onClick={() => onAdd(picked)}
        >
          {picked.length === 0
            ? 'Tick exercises to add'
            : `Add ${picked.length} ${picked.length === 1 ? 'exercise' : 'exercises'}`}
        </button>
      </div>
    </main>
  );
}
