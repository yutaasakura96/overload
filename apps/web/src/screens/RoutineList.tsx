import type { Exercise, Me } from '@overload/api-contract';
import { useQuery } from '@tanstack/react-query';
import { AccountFooter, AppBar, Chevron, Notice, ScreenTabs, DataState } from '../components';
import { allExercisesQuery, routinesQuery, useAccount } from '../query';

// S4's routine list (docs/10 §8.1). A routine opens its editor here; a workout starts from Today.

export function RoutineList({ me, navigate }: { me: Me; navigate: (path: string) => void }) {
  const confirmed = useAccount().status === 'confirmed';
  const routines = useQuery({ ...routinesQuery, enabled: confirmed });
  const exercises = useQuery({ ...allExercisesQuery, enabled: confirmed });
  const names = new Map((exercises.data ?? []).map((e: Exercise) => [e.id, e.name]));
  const items = routines.data ?? [];

  return (
    <main>
      <AppBar
        title="Routines"
        subline={
          routines.data === undefined
            ? undefined
            : `${items.length} ${items.length === 1 ? 'ROUTINE' : 'ROUTINES'}`
        }
        slot={<DataState at={routines.dataUpdatedAt} />}
      />
      <ScreenTabs current="/routines" navigate={navigate} />

      {routines.isError && (
        <Notice tone="flag" word="Not updated">
          Couldn’t reach Overload.{' '}
          {routines.data === undefined
            ? 'Try again when you have signal.'
            : 'Showing the last copy.'}
        </Notice>
      )}

      {routines.data !== undefined && items.length === 0 && (
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

      {items.length > 0 && (
        <section aria-labelledby="routines-heading">
          <h2 id="routines-heading" className="visually-hidden">
            Your routines
          </h2>
          <ul className="routines">
            {items.map((routine) => {
              const sets = routine.exercises.reduce((sum, slot) => sum + slot.targetSets, 0);
              const firstNames = routine.exercises
                .slice(0, 3)
                .map((slot) => names.get(slot.exerciseId))
                .filter((name) => name !== undefined);
              return (
                <li key={routine.id}>
                  <a
                    href={`/routines/${routine.id}`}
                    className="routines__row"
                    onClick={(event) => {
                      event.preventDefault();
                      navigate(`/routines/${routine.id}`);
                    }}
                  >
                    <span className="routines__text">
                      <span className="routines__name">{routine.name}</span>
                      <span className="routines__meta">
                        {routine.exercises.length}{' '}
                        {routine.exercises.length === 1 ? 'EXERCISE' : 'EXERCISES'} · {sets} SETS
                      </span>
                      {firstNames.length > 0 && (
                        <span className="routines__preview">
                          {firstNames.join(', ')}
                          {routine.exercises.length > firstNames.length ? ', …' : ''}
                        </span>
                      )}
                    </span>
                    <span className="routines__go" aria-hidden="true">
                      <Chevron direction="forward" />
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
          <div className="section-actions">
            <button
              type="button"
              className="button button--secondary"
              onClick={() => navigate('/routines/new')}
            >
              New routine
            </button>
          </div>
        </section>
      )}

      <AccountFooter email={me.user.email} navigate={navigate} />
    </main>
  );
}
