import type { Exercise, Me } from '@overload/api-contract';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  AccountFooter,
  AppBar,
  Chevron,
  Notice,
  ScreenTabs,
  DataState,
  TextField,
} from '../components';
import { ExerciseGroups, matchedAlias, searchExercises } from '../exercise-list';
import { allExercisesQuery, currentWeightUnit, exercisesQuery, useAccount } from '../query';
import { formatWeight } from '../units';

// S8: the seeded library plus the user's own, with their effective settings. Built from docs/05's
// data table; each row opens the exercise to edit it or set the user's own values (docs/10 §8.1).

export function ExerciseLibrary({ me, navigate }: { me: Me; navigate: (path: string) => void }) {
  // The saved copy shows until /api/me confirms the account; no fetch runs under an unconfirmed one.
  const confirmed = useAccount().status === 'confirmed';
  const exercises = useQuery({ ...exercisesQuery, enabled: confirmed });
  const [search, setSearch] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const everything = useQuery({ ...allExercisesQuery, enabled: confirmed && showHidden });
  const items = useMemo(() => exercises.data ?? [], [exercises.data]);
  const hidden = (everything.data ?? []).filter((exercise) => exercise.hidden);
  const shown = useMemo(() => searchExercises(items, search), [items, search]);

  return (
    <main>
      <AppBar
        title="Exercises"
        subline={exercises.data === undefined ? undefined : `${items.length} IN LIBRARY`}
        slot={<DataState at={exercises.dataUpdatedAt} />}
      />
      <ScreenTabs current="/exercises" navigate={navigate} />

      {exercises.isError && (
        <Notice tone="flag" word="Not updated">
          Couldn’t reach Overload.{' '}
          {exercises.data === undefined
            ? 'Try again when you have signal.'
            : 'Showing the last copy.'}
        </Notice>
      )}

      {exercises.data !== undefined && (
        <section className="library" aria-labelledby="library-heading">
          <div className="exercise-tools">
            <TextField
              label="Search"
              type="search"
              value={search}
              onChange={setSearch}
              placeholder="Bench, RDL, pec deck…"
            />
            <button
              type="button"
              className="button button--secondary"
              onClick={() => navigate('/exercises/new')}
            >
              New exercise
            </button>
          </div>
          <h2
            id="library-heading"
            className={search === '' ? 'visually-hidden' : 'section-label section-label--gutter'}
            aria-live="polite"
          >
            {search === '' ? 'Exercise library' : `${shown.length} matching`}
          </h2>
          {shown.length === 0 ? (
            <p className="empty">
              Nothing matches. Check the spelling, or make it with <em>New exercise</em>.
            </p>
          ) : (
            <>
              <div className="library__head" aria-hidden="true">
                <span>Exercise</span>
                <span>Step</span>
                <span>Reps</span>
                <span>Rest</span>
              </div>
              <ExerciseGroups exercises={shown} listClassName="library__list">
                {(exercise) => (
                  <LibraryRow
                    key={exercise.id}
                    exercise={exercise}
                    alias={matchedAlias(exercise, search)}
                    navigate={navigate}
                  />
                )}
              </ExerciseGroups>
            </>
          )}
          <div className="section-actions">
            <button
              type="button"
              className="button button--tertiary"
              aria-expanded={showHidden}
              aria-controls="hidden-exercises"
              onClick={() => setShowHidden((open) => !open)}
            >
              Hidden exercises
              <Chevron direction={showHidden ? 'up' : 'down'} />
            </button>
          </div>
        </section>
      )}

      {showHidden && (
        <section id="hidden-exercises" className="library" aria-labelledby="hidden-heading">
          <h2 id="hidden-heading" className="section-label section-label--gutter">
            Hidden from pickers
          </h2>
          {everything.isError && (
            <Notice tone="flag" word="Not updated">
              Couldn’t reach Overload. Try again when you have signal.
            </Notice>
          )}
          {everything.data !== undefined && hidden.length === 0 && (
            <p className="empty">Nothing hidden.</p>
          )}
          {hidden.length > 0 && (
            <ul className="library__list">
              {hidden.map((exercise) => (
                <LibraryRow key={exercise.id} exercise={exercise} navigate={navigate} />
              ))}
            </ul>
          )}
        </section>
      )}

      <AccountFooter email={me.user.email} navigate={navigate} />
    </main>
  );
}

function LibraryRow({
  exercise,
  alias,
  navigate,
}: {
  exercise: Exercise;
  /** The other name a search matched it by, shown so the match explains itself. */
  alias?: string | undefined;
  navigate: (path: string) => void;
}) {
  const path = `/exercises/${exercise.id}`;
  const unit = currentWeightUnit();
  return (
    <li>
      <a
        href={path}
        className="library__row"
        onClick={(event) => {
          event.preventDefault();
          navigate(path);
        }}
      >
        <span className="library__name">
          {exercise.name}
          {exercise.custom && <span className="library__tag"> · Yours</span>}
          {alias !== undefined && <span className="library__tag"> · {alias}</span>}
        </span>
        <span className="library__figure">
          <span className="visually-hidden">increment </span>
          {formatWeight(exercise.incrementKg, unit)}
          <span className="visually-hidden"> {unit === 'lb' ? 'pounds' : 'kilograms'}</span>
        </span>
        <span className="library__figure">
          <span className="visually-hidden">reps </span>
          {exercise.repLow}–{exercise.repHigh}
        </span>
        <span className="library__figure">
          <span className="visually-hidden">rest </span>
          {exercise.restSeconds}
          <span className="library__unit" aria-hidden="true">
            s
          </span>
          <span className="visually-hidden"> seconds</span>
        </span>
      </a>
    </li>
  );
}
