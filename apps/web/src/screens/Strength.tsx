import type {
  Me,
  StrengthLift,
  StrengthOverview,
  StrengthSpan,
  WeightUnit,
} from '@overload/api-contract';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AccountFooter, AppBar, DataState, Notice, ScreenTabs } from '../components';
import type { Navigate } from '../navigation';
import { strengthQuery, useAccount } from '../query';
import { fromKg, unitLabel, unitName } from '../units';
import { ProgressSections } from './History';

// The strength overview (docs/10 §9, issue #49): whether every lift together, and each on its
// own, is gaining, holding or losing over a span. Every figure and verdict is the API's (docs/07
// §3); this screen groups the lifts by the status they came with and draws them.

const SPANS: { span: StrengthSpan; label: string; over: string }[] = [
  { span: '4w', label: '4 weeks', over: '4 weeks' },
  { span: '12w', label: '12 weeks', over: '12 weeks' },
  { span: '1y', label: '1 year', over: 'a year' },
];

/** The span the screen opens on, and the API's own default (docs/07 §3). */
const DEFAULT_SPAN: StrengthSpan = '12w';

type Status = StrengthLift['status'];

const GROUPS: { status: Status; label: string }[] = [
  { status: 'gaining', label: 'Gaining' },
  { status: 'holding', label: 'Holding' },
  { status: 'losing', label: 'Losing' },
  { status: 'too_few', label: 'Too few workouts in this span' },
  { status: 'no_weight', label: 'No weight logged in this span' },
];

/** What all the lifts together read as: the same three verdicts, in the headline's words. */
const OVERALL = { gaining: 'Stronger', holding: 'Holding', losing: 'Weaker' } as const;

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const sign = (value: number) => (value > 0 ? '+' : value < 0 ? '−' : '');
const signed = (value: number) => `${sign(value)}${Math.abs(value).toFixed(1)}`;
/** A change said aloud, where the screen prints only its sign. */
const spoken = (value: number) =>
  `${value > 0 ? 'Up' : value < 0 ? 'Down' : 'No change:'} ${Math.abs(value).toFixed(1)}`;
/** A weight in the user's unit, to the tenth, as every e1RM is printed. */
const tenth = (kg: number, unit: WeightUnit) => Math.round(fromKg(kg, unit) * 10) / 10;

export function Strength({
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
  // The span is part of the address, so a reload, or Back from a lift's chart, opens the same one.
  const span = SPANS.find((each) => each.span === searchParams.get('span'))?.span ?? DEFAULT_SPAN;
  const hasProfile = me.profile != null;
  // The last overview stays while another span loads, so the screen keeps its frame.
  const strength = useQuery({
    ...strengthQuery(span),
    enabled: confirmed && hasProfile,
    placeholderData: keepPreviousData,
  });
  const unit = me.profile?.weightUnit ?? 'kg';
  const data = strength.data;
  const shown = SPANS.find((each) => each.span === (data?.span ?? span));

  return (
    <main className="progress">
      <AppBar
        title="Progress"
        subline={data === undefined ? undefined : count(data.lifts.length, 'lift').toUpperCase()}
        slot={<DataState at={strength.dataUpdatedAt} />}
      />
      <ScreenTabs current="/progress" navigate={navigate} />
      <ProgressSections current="/progress/strength" navigate={navigate} />

      <fieldset className="segments segments--three segments--mono">
        <legend className="visually-hidden">Time span</legend>
        {SPANS.map((each) => (
          <label key={each.span} className="segments__segment">
            <input
              type="radio"
              name="span"
              checked={span === each.span}
              onChange={() =>
                navigate(
                  `/progress/strength${each.span === DEFAULT_SPAN ? '' : `?span=${each.span}`}`,
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
          A trend dates each workout in your time zone. Save your profile on{' '}
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
      {strength.isError && (
        <Notice tone="flag" word="Not updated">
          Couldn’t reach Overload.{' '}
          {data === undefined ? 'Try again when you have signal.' : 'Showing the last copy.'}
        </Notice>
      )}

      <div
        className={`progress__body progress__body--flush${
          strength.isPlaceholderData ? ' progress__body--stale' : ''
        }`}
        aria-busy={strength.isPlaceholderData}
      >
        <Headline overall={data?.overall} over={shown?.over ?? ''} />
        {data !== undefined && (
          <>
            <dl className="tally">
              {GROUPS.slice(0, 3).map((group) => (
                <div key={group.status} className={`tally__cell tally__cell--${group.status}`}>
                  <dt className="progress__stat-label">{group.label}</dt>
                  <dd className="tally__figure">
                    {data.lifts.filter((lift) => lift.status === group.status).length}
                  </dd>
                </div>
              ))}
            </dl>
            {data.lifts.length === 0 && (
              <section className="empty-state" aria-labelledby="no-lifts">
                <h2 id="no-lifts" className="empty-state__title">
                  No lifts in this span
                </h2>
                <p className="empty-state__body">
                  A lift is listed here once a workout in the span has a working set of it.
                </p>
              </section>
            )}
            {GROUPS.map((group) => (
              <Lifts
                key={group.status}
                status={group.status}
                label={group.label}
                lifts={data.lifts.filter((lift) => lift.status === group.status)}
                span={data.span}
                unit={unit}
                navigate={navigate}
              />
            ))}
          </>
        )}
      </div>

      <footer className="footnote footnote--after">
        <span>Trend of each lift’s e1RM across the span</span>
        <span className="footnote__formula">gaining ≥ +2% · losing ≤ −2%</span>
      </footer>
      <AccountFooter email={me.user.email} navigate={navigate} />
    </main>
  );
}

/** All the lifts together: the average change of their trends, and the verdict it reads as. */
function Headline({
  overall,
  over,
}: {
  overall: StrengthOverview['overall'] | undefined;
  over: string;
}) {
  const change = overall?.changePct ?? null;
  const status = overall?.status ?? null;
  return (
    <section className="progress__headline" aria-labelledby="strength-headline">
      <div>
        <h2 id="strength-headline" className="section-label">
          All lifts · trend over {over}
        </h2>
        <p className="progress__e1rm">
          {change === null ? (
            <>
              <span className="progress__e1rm-unit" aria-hidden="true">
                —
              </span>
              <span className="visually-hidden">
                {overall === undefined ? '' : 'No lift has a trend yet'}
              </span>
            </>
          ) : (
            <>
              <span className="progress__e1rm-figure" aria-hidden="true">
                {signed(change)}
              </span>{' '}
              <span className="progress__e1rm-unit" aria-hidden="true">
                %
              </span>
              <span className="visually-hidden">{spoken(change)} percent</span>
            </>
          )}
        </p>
      </div>
      {overall !== undefined && (
        <p className="progress__change">
          <span
            className={
              status === 'gaining'
                ? 'progress__change-figure progress__change-figure--up'
                : 'progress__change-figure'
            }
          >
            {status === null ? '' : OVERALL[status].toUpperCase()}
          </span>
          <span className="progress__change-span">{count(overall.lifts, 'lift')} averaged</span>
        </p>
      )}
    </section>
  );
}

/** One status and its lifts, in the order the API gave them. A status with no lift is not drawn. */
function Lifts({
  status,
  label,
  lifts,
  span,
  unit,
  navigate,
}: {
  status: Status;
  label: string;
  lifts: StrengthLift[];
  span: StrengthSpan;
  unit: WeightUnit;
  navigate: Navigate;
}) {
  if (lifts.length === 0) return null;
  const heading = `lifts-${status}`;
  return (
    <section aria-labelledby={heading}>
      <h2 id={heading} className="section-label section-label--gutter group-label">
        {label} · {lifts.length}
      </h2>
      <ul className="lifts">
        {lifts.map((lift) => {
          const path = `/exercises/${lift.exerciseId}/progress${
            span === DEFAULT_SPAN ? '' : `?span=${span}`
          }`;
          const latest = lift.points.at(-1);
          return (
            <li key={lift.exerciseId}>
              <a
                href={path}
                className={`lifts__row lifts__row--${status}`}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(path, { returns: true });
                }}
              >
                <span>
                  <span className="lifts__name">{lift.name}</span>
                  <span className="lifts__now">
                    {lift.trend === null || latest === undefined ? (
                      count(
                        lift.status === 'no_weight' ? lift.workoutCount : lift.points.length,
                        'workout',
                      ).toUpperCase()
                    ) : (
                      <>
                        <span className="visually-hidden">: estimated 1RM </span>
                        <span aria-hidden="true">E1RM </span>
                        {tenth(latest.e1rmKg, unit).toFixed(1)}
                        <span aria-hidden="true"> {unitLabel(unit)}</span>
                        <span className="visually-hidden"> {unitName(unit)}</span>
                      </>
                    )}
                  </span>
                </span>
                {lift.status === 'no_weight' ? null : lift.points.length > 1 ? (
                  <Spark points={lift.points} />
                ) : (
                  <span />
                )}
                <span className="lifts__change">
                  {lift.status === 'no_weight' ? (
                    <span className="lifts__kg">No weight logged · no trend</span>
                  ) : lift.trend === null ? (
                    <>
                      <span className="lifts__pct" aria-hidden="true">
                        —
                      </span>
                      <span className="visually-hidden">, no trend yet</span>
                    </>
                  ) : (
                    <>
                      <span className="lifts__pct">
                        <span aria-hidden="true">{signed(lift.trend.changePct)}%</span>
                        <span className="visually-hidden">
                          , {spoken(lift.trend.changePct)} percent
                        </span>
                      </span>
                      <span className="lifts__kg">
                        <span aria-hidden="true">
                          {signed(tenth(lift.trend.changeKg, unit))} {unit}
                        </span>
                        <span className="visually-hidden">
                          , {spoken(tenth(lift.trend.changeKg, unit))} {unitName(unit)}
                        </span>
                      </span>
                    </>
                  )}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;
const dayOf = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;

/**
 * A lift's e1RM across the span in 64 × 24: its workouts by date, the latest marked. It only draws
 * the line the figures beside it sum up, so it is hidden from a screen reader.
 */
function Spark({ points }: { points: StrengthLift['points'] }) {
  const values = points.map((point) => point.e1rmKg);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const first = dayOf(points[0]?.date ?? '');
  const days = Math.max(1, dayOf(points.at(-1)?.date ?? '') - first);
  const xy = points.map((point) => ({
    x: 2 + (58 * (dayOf(point.date) - first)) / days,
    y: max === min ? 12 : 20 - (16 * (point.e1rmKg - min)) / (max - min),
  }));
  const last = xy.at(-1);
  return (
    <svg
      className="spark"
      width="64"
      height="24"
      viewBox="0 0 64 24"
      fill="none"
      aria-hidden="true"
    >
      <polyline
        points={xy.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}
        className="spark__line"
      />
      {last !== undefined && <circle cx={last.x} cy={last.y} r={2} className="spark__latest" />}
    </svg>
  );
}
