import type {
  Balance as BalanceData,
  BalanceView,
  Me,
  MuscleBalance,
} from '@overload/api-contract';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { balanceOnDevice } from '../balance';
import { AccountFooter, AppBar, DataState, Notice, ScreenTabs } from '../components';
import { dayLabel } from '../dates';
import { EVIDENCE, EvidenceTag } from '../evidence';
import { muscleGroupLabels } from '../exercise-list';
import type { Navigate } from '../navigation';
import { allExercisesQuery, balanceQuery, useAccount } from '../query';
import { recordsOf, useWorkoutStore } from '../workout';
import { ProgressSections } from './History';

// Muscle balance (docs/10 §9, issue #50): working sets a week for each muscle group against one
// range, the four-week average first (Q13, Q14). Every figure and status is the API's (docs/07
// §3), with this week's sets still on the device laid over them (balance.ts); this screen draws
// them, and opens a row on where its sets came from.

const VIEWS: { view: BalanceView; label: string }[] = [
  { view: '4w', label: '4-week average' },
  { view: 'week', label: 'This week' },
];

/** The view the screen opens on, and the API's own default (docs/07 §3). */
const DEFAULT_VIEW: BalanceView = '4w';

type Status = MuscleBalance['status'];

const STATUS_WORD: Record<Status, string> = {
  in_range: 'In range',
  low: 'Low',
  none: 'Not trained',
  high: 'High',
};

/** The meter's scale runs to 25 sets a week; more fills it. */
const SCALE_MAX = 25;
const pos = (sets: number) => `${Math.min(100, (sets / SCALE_MAX) * 100)}%`;

/** Sets a week as printed: to the tenth, and a whole number without its `.0`. */
const figure = (sets: number) => String(Math.round(sets * 10) / 10);

/** A local date as `Sun 13 Sep`. */
const day = (date: string) => dayLabel(`${date}T12:00:00Z`, 'UTC');
/** The same without its weekday. */
const date = (local: string) => day(local).split(' ').slice(1).join(' ');

/** `13 Sep – 10 Oct`, or `Mon 5 Oct – today`, from the view's local dates. */
function spanLabel(data: BalanceData) {
  return data.view === 'week'
    ? `${day(data.from)} – today`
    : `${date(data.from)} – ${date(data.to)}`;
}

export function Balance({
  me,
  searchParams,
  navigate,
}: {
  me: Me;
  searchParams: URLSearchParams;
  navigate: Navigate;
}) {
  // The saved copy shows until /api/me confirms the account; no fetch runs under an unconfirmed one.
  const confirmed = useAccount().status === 'confirmed';
  // The view is part of the address, so a reload opens the same one.
  const view = VIEWS.find((each) => each.view === searchParams.get('view'))?.view ?? DEFAULT_VIEW;
  const hasProfile = me.profile != null;
  // The last copy stays while the other view loads, so the screen keeps its frame.
  const balance = useQuery({
    ...balanceQuery(view),
    enabled: confirmed && hasProfile,
    placeholderData: keepPreviousData,
  });
  // A workout may name an exercise since hidden, and its groups still count.
  const exercises = useQuery({ ...allExercisesQuery, enabled: confirmed });
  const records = useWorkoutStore((state) => recordsOf(state, me.user.id));
  const data =
    balance.data === undefined || me.profile == null
      ? balance.data
      : balanceOnDevice(balance.data, records, exercises.data ?? [], me.profile.timezone);
  const [open, setOpen] = useState<string>();
  const count = (...statuses: Status[]) =>
    data?.groups.filter((group) => statuses.includes(group.status)).length ?? 0;

  return (
    <main className="progress">
      <AppBar
        title="Progress"
        subline={data === undefined ? undefined : spanLabel(data).toUpperCase()}
        slot={<DataState at={balance.dataUpdatedAt} />}
      />
      <ScreenTabs current="/progress" navigate={navigate} />
      <ProgressSections current="/progress/balance" navigate={navigate} />

      <fieldset className="segments segments--view">
        <legend className="visually-hidden">Weeks</legend>
        {VIEWS.map((each) => (
          <label key={each.view} className="segments__segment">
            <input
              type="radio"
              name="view"
              checked={view === each.view}
              onChange={() =>
                navigate(
                  `/progress/balance${each.view === DEFAULT_VIEW ? '' : `?view=${each.view}`}`,
                  { replace: true },
                )
              }
            />
            {each.label}
          </label>
        ))}
      </fieldset>

      {!hasProfile && (
        <Notice tone="flag" word="Set up first">
          A week is counted in your time zone. Save your profile on{' '}
          <a
            href="/"
            onClick={(event) => {
              event.preventDefault();
              navigate('/');
            }}
          >
            Today
          </a>{' '}
          first.
        </Notice>
      )}
      {balance.isError && (
        <Notice tone="flag" word="Not updated">
          Couldn’t reach Overload.{' '}
          {data === undefined ? 'Try again when you have signal.' : 'Showing the last copy.'}
        </Notice>
      )}

      <div className="range-line">
        <span>Working sets a week, per muscle group. Range:</span>
        <EvidenceTag evidence={EVIDENCE.volume} />
      </div>

      {data !== undefined && (
        <div
          className={`progress__body${balance.isPlaceholderData ? ' progress__body--stale' : ''}`}
          aria-busy={balance.isPlaceholderData}
        >
          <dl className="tally">
            <div className="tally__cell tally__cell--gaining">
              <dt className="progress__stat-label">In range</dt>
              <dd className="tally__figure">{count('in_range', 'high')}</dd>
            </div>
            <div className="tally__cell tally__cell--losing">
              <dt className="progress__stat-label">Low</dt>
              <dd className="tally__figure">{count('low')}</dd>
            </div>
            <div className="tally__cell tally__cell--losing">
              <dt className="progress__stat-label">Not trained</dt>
              <dd className="tally__figure">{count('none')}</dd>
            </div>
          </dl>
          <ul className="muscles">
            {data.groups.map((group) => (
              <MuscleRow
                key={group.muscleGroup}
                group={group}
                view={data.view}
                range={data.range}
                open={open === group.muscleGroup}
                onToggle={() => setOpen(open === group.muscleGroup ? undefined : group.muscleGroup)}
              />
            ))}
          </ul>
          <div className="scale" aria-hidden="true">
            <span style={{ left: 0, transform: 'none' }}>0</span>
            <span style={{ left: pos(data.range.low) }}>{data.range.low}</span>
            <span style={{ left: pos(data.range.high) }}>{data.range.high}</span>
          </div>
          <div className="legend" aria-hidden="true">
            <span className="legend__item">
              <span className="legend__swatch" />
              Sets on the muscle
            </span>
            <span className="legend__item">
              <span className="legend__swatch legend__swatch--half" />
              Half sets, trained indirectly
            </span>
            <span className="legend__item">
              <span className="legend__swatch legend__swatch--band" />
              {data.range.low}–{data.range.high} a week
            </span>
          </div>
        </div>
      )}

      <AccountFooter email={me.user.email} admin={me.isAdmin} navigate={navigate} />
    </main>
  );
}

/**
 * One muscle group: its figure and status over a meter of its whole and half sets against the
 * range. A tap opens where the sets came from. The meter repeats the figure, so it is hidden from a
 * screen reader.
 */
function MuscleRow({
  group,
  view,
  range,
  open,
  onToggle,
}: {
  group: MuscleBalance;
  view: BalanceView;
  range: BalanceData['range'];
  open: boolean;
  onToggle: () => void;
}) {
  const from = `muscle-from-${group.muscleGroup}`;
  const sources = group.sources.map(
    (source) => `${source.name}${source.indirect ? ' (half)' : ''} ${figure(source.sets)}`,
  );
  return (
    <li>
      <button
        type="button"
        className={`muscles__row muscles__row--${group.status}`}
        aria-label={`${muscleGroupLabels[group.muscleGroup]}, ${figure(group.sets)} sets a week, ${STATUS_WORD[group.status]}`}
        aria-expanded={open}
        aria-controls={open ? from : undefined}
        onClick={onToggle}
      >
        <span className="muscles__top">
          <span className="muscles__name">{muscleGroupLabels[group.muscleGroup]}</span>
          <span className="muscles__value">
            {figure(group.sets)}
            <span className="muscles__status">{STATUS_WORD[group.status]}</span>
          </span>
        </span>
        <span className="meter" aria-hidden="true">
          <span
            className="meter__band"
            style={{ left: pos(range.low), right: `calc(100% - ${pos(range.high)})` }}
          />
          <span className="meter__direct" style={{ width: pos(group.directSets) }} />
          <span
            className="meter__indirect"
            style={{
              left: pos(group.directSets),
              width: `calc(${pos(group.sets)} - ${pos(group.directSets)})`,
            }}
          />
        </span>
      </button>
      {open && (
        <p id={from} className="muscles__from">
          {sources.length === 0
            ? view === 'week'
              ? 'No exercise this week trains it.'
              : 'No exercise in the last four weeks trains it.'
            : sources.join(' · ')}
        </p>
      )}
    </li>
  );
}
