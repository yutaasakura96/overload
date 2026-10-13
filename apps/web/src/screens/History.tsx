import type { Me, WeightUnit, WorkoutSummary } from '@overload/api-contract';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  AccountFooter,
  AppBar,
  CheckIcon,
  Chevron,
  DataState,
  Notice,
  ScreenTabs,
} from '../components';
import { dayLabel, minutesBetween, monthLabel } from '../dates';
import { historyOnDevice } from '../history';
import { useEntryNote, type Navigate } from '../navigation';
import { useAccount, workoutsQuery } from '../query';
import { deviceTimezone } from '../timezones';
import { formatWeight } from '../units';
import { recordsOf, useWorkoutStore } from '../workout';

// The Progress tab (docs/10 §9): History, Strength and Balance behind one tab, since five do not
// fit 390px. History is the finished workouts by date, newest first, each opening its own page.

const SECTIONS = [
  { path: '/progress', label: 'History' },
  { path: '/progress/strength', label: 'Strength' },
  { path: '/progress/balance', label: 'Balance' },
] as const;

type Section = (typeof SECTIONS)[number]['path'];

/** 4.8, the three sections of Progress. Links, like the tabs above them: each has an address. */
export function ProgressSections({ current, navigate }: { current: Section; navigate: Navigate }) {
  return (
    <nav className="segments segments--three" aria-label="Progress">
      {SECTIONS.map((section) => (
        <a
          key={section.path}
          href={section.path}
          className="segments__segment"
          aria-current={section.path === current ? 'page' : undefined}
          onClick={(event) => {
            event.preventDefault();
            navigate(section.path);
          }}
        >
          {section.label}
        </a>
      ))}
    </nav>
  );
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 'S'}`;

/** `Barbell Bench Press 80 × 10 · Cable Lat Pulldown 65 × 9`: the top set of each exercise. */
const preview = (workout: WorkoutSummary, unit: WeightUnit) =>
  workout.exercises
    .map((each) => `${each.name} ${formatWeight(each.topSetKg, unit)} × ${each.topSetReps}`)
    .join(' · ');

export function History({ me, navigate }: { me: Me; navigate: Navigate }) {
  // The saved copy shows until /api/me confirms the account; no fetch runs under an unconfirmed one.
  const confirmed = useAccount().status === 'confirmed';
  const list = useInfiniteQuery({ ...workoutsQuery, enabled: confirmed });
  const records = useWorkoutStore((state) => recordsOf(state, me.user.id));
  const removed = useEntryNote() === 'removed';
  const unit = me.profile?.weightUnit ?? 'kg';
  const timeZone = me.profile?.timezone ?? deviceTimezone();

  const pages = list.data?.pages;
  const history =
    pages === undefined
      ? undefined
      : historyOnDevice(
          {
            items: pages.flatMap((page) => page.items),
            total: pages[0]?.total ?? 0,
            more: list.hasNextPage,
          },
          records,
        );
  // One list per month, in the order the workouts come.
  const months: { id: string; label: string; workouts: WorkoutSummary[] }[] = [];
  for (const workout of history?.items ?? []) {
    const label = monthLabel(workout.startedAt, timeZone);
    const last = months.at(-1);
    if (last?.label === label) last.workouts.push(workout);
    // An id holds no space: `month-October-2026`.
    else months.push({ id: `month-${label.replaceAll(' ', '-')}`, label, workouts: [workout] });
  }

  return (
    <main>
      <AppBar
        title="Progress"
        subline={history === undefined ? undefined : count(history.total, 'WORKOUT')}
        slot={<DataState at={list.dataUpdatedAt} />}
      />
      <ScreenTabs current="/progress" navigate={navigate} />
      <ProgressSections current="/progress" navigate={navigate} />

      {list.isError && (
        <Notice tone="flag" word="Not updated">
          Couldn’t reach Overload.{' '}
          {history === undefined ? 'Try again when you have signal.' : 'Showing the last copy.'}
        </Notice>
      )}
      {removed && (
        <output className="saved-line">
          <CheckIcon size={13} color="var(--done)" />
          That was its last set, so the workout was removed.
        </output>
      )}

      {history !== undefined && history.items.length === 0 && (
        <section className="empty-state" aria-labelledby="no-workouts">
          <h2 id="no-workouts" className="empty-state__title">
            No workouts yet
          </h2>
          <p className="empty-state__body">
            A finished workout is listed here by date, with every set open to correction.
          </p>
        </section>
      )}

      {months.map((month) => (
        <section key={month.label} aria-labelledby={month.id}>
          <h2 id={month.id} className="section-label section-label--gutter month-label">
            {month.label}
          </h2>
          <ul className="routines routines--flush">
            {month.workouts.map((workout) => (
              <li key={workout.id}>
                <a
                  href={`/workouts/${workout.id}`}
                  className="routines__row"
                  onClick={(event) => {
                    event.preventDefault();
                    navigate(`/workouts/${workout.id}`, { returns: true });
                  }}
                >
                  <span className="routines__text">
                    <span className="routines__name">{workout.name}</span>
                    <span className="routines__meta">
                      {dayLabel(workout.startedAt, timeZone).toUpperCase()} ·{' '}
                      {minutesBetween(workout.startedAt, workout.endedAt)} MIN ·{' '}
                      {count(workout.workingSets, 'SET')}
                    </span>
                    <span className="routines__preview">{preview(workout, unit)}</span>
                  </span>
                  <span className="routines__go" aria-hidden="true">
                    <Chevron direction="forward" />
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {list.hasNextPage && (
        <div className="section-actions">
          <button
            type="button"
            className="button button--tertiary"
            disabled={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            Show earlier workouts
          </button>
        </div>
      )}

      <AccountFooter email={me.user.email} navigate={navigate} />
    </main>
  );
}

/**
 * Balance, until it is built (#50): the section is there, as the tab is laid out, and says plainly
 * that it holds nothing yet.
 */
export function ProgressSection({ me, navigate }: { me: Me; navigate: Navigate }) {
  const syncedAt = useWorkoutStore((state) => state.lastSyncedAt);
  return (
    <main>
      <AppBar title="Progress" slot={<DataState at={syncedAt} />} />
      <ScreenTabs current="/progress" navigate={navigate} />
      <ProgressSections current="/progress/balance" navigate={navigate} />
      <section className="empty-state" aria-labelledby="not-built">
        <h2 id="not-built" className="empty-state__title">
          Balance is not here yet
        </h2>
        <p className="empty-state__body">
          Weekly working sets for each muscle group will be shown here.
        </p>
      </section>
      <AccountFooter email={me.user.email} navigate={navigate} />
    </main>
  );
}
