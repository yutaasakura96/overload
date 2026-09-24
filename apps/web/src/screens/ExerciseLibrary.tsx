import type { Me } from '@overload/api-contract';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { AppBar, Notice, SyncedAt } from '../components';
import { exercisesQuery } from '../query';
import { signOut } from '../sign-out';

// S8, read-only: the seeded library plus the user's own, with their effective settings. docs/10 §8
// lists this screen as undrawn; it is built from docs/05's data table and nothing new.

const formatKg = (kg: number) => (Number.isInteger(kg) ? String(kg) : kg.toFixed(1));

export function ExerciseLibrary({ me, navigate }: { me: Me; navigate: (path: string) => void }) {
  const exercises = useQuery(exercisesQuery);
  const [signingOut, setSigningOut] = useState(false);
  const items = exercises.data ?? [];

  return (
    <main>
      <AppBar
        title="Exercises"
        subline={exercises.data === undefined ? undefined : `${items.length} IN LIBRARY`}
        slot={<SyncedAt at={exercises.dataUpdatedAt} />}
      />

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
          <h2 id="library-heading" className="visually-hidden">
            Exercise library
          </h2>
          <div className="library__head" aria-hidden="true">
            <span>Exercise</span>
            <span>Step</span>
            <span>Reps</span>
            <span>Rest</span>
          </div>
          <ul className="library__list">
            {items.map((exercise) => (
              <li key={exercise.id} className="library__row">
                <span className="library__name">{exercise.name}</span>
                <span className="library__figure">
                  <span className="visually-hidden">increment </span>
                  {formatKg(exercise.incrementKg)}
                  <span className="visually-hidden"> kilograms</span>
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
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="footer">
        <span className="footer__account">{me.user.email}</span>
        <button
          type="button"
          className="button button--tertiary"
          disabled={signingOut}
          onClick={() => {
            setSigningOut(true);
            void signOut(navigate);
          }}
        >
          Sign out
        </button>
      </footer>
    </main>
  );
}
