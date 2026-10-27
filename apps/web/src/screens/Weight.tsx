import type {
  GoalPhase,
  Me,
  WeighIn,
  WeighIns,
  WeightDay,
  WeightUnit,
} from '@overload/api-contract';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { api, expectOk } from '../api';
import {
  AccountFooter,
  AppBar,
  CheckIcon,
  Chevron,
  DataState,
  Notice,
  ScreenTabs,
} from '../components';
import { axisDates, dateX } from '../chart';
import { clockLabel, dayLabel, localDate } from '../dates';
import { useEntryNote, type Navigate } from '../navigation';
import { phaseLine, shortDate } from '../plan';
import {
  forAccount,
  goalPhasesQuery,
  planToday,
  refreshWeighIns,
  useAccount,
  weighInsQuery,
} from '../query';
import { saveProblem, SaveNotice, type SaveProblem } from '../saving';
import { fromKg, unitName } from '../units';
import { ProgressSections } from './History';
import { MaintenanceCard } from './MaintenanceCheck';

// Weight, the fourth section of Progress (docs/10 §6, S11; approved in the M2 prototype). The daily
// weights, the trend and the week's change are the API's (docs/07 §5, docs/03 §8.3); this screen
// draws them in the profile's unit, and types or deletes a weigh-in by hand, a permanent way in
// next to the scale (docs/02 S11).

/** The chart's first span: the last 30 local days, today included. The second is the phase's (Q16). */
const SPAN_DAYS = 30;
/** How many of the newest readings the list shows. */
const RECENT = 6;
/** The trend needs this many weighed days (docs/02, Empty states). */
const TREND_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A weight in the user's unit, to the tenth, as the screen prints every weight. */
const tenth = (kg: number, unit: WeightUnit) => (Math.round(fromKg(kg, unit) * 10) / 10).toFixed(1);
const unitWord = (unit: WeightUnit) => (unit === 'lb' ? 'lb' : 'kg');

/** `−0.29`: a change to the hundredth, with a real minus sign. */
function signed(kg: number, unit: WeightUnit) {
  const value = Math.round(fromKg(kg, unit) * 100) / 100;
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(2)}`;
}
const spoken = (kg: number, unit: WeightUnit) => {
  const value = Math.round(fromKg(kg, unit) * 100) / 100;
  return `${value > 0 ? 'Up' : value < 0 ? 'Down' : 'No change:'} ${Math.abs(value).toFixed(2)} ${unitName(unit)}`;
};

export function Weight({ me, navigate }: { me: Me; navigate: Navigate }) {
  // The saved copy shows until /api/me confirms the account; no fetch runs under an unconfirmed one.
  const confirmed = useAccount().status === 'confirmed';
  const profile = me.profile;
  const weighIns = useQuery({ ...weighInsQuery, enabled: confirmed && profile != null });
  const phases = useQuery({ ...goalPhasesQuery, enabled: confirmed });
  const phase = phases.data?.find((each) => each.endedOn === null);
  const weighed = useEntryNote() === 'weighed';
  const [deleted, setDeleted] = useState(false);
  const [problem, setProblem] = useState<SaveProblem>();
  const data = weighIns.data;
  const typeOne = () => navigate('/progress/weight/new', { returns: true });

  return (
    <main className="progress">
      <AppBar title="Progress" subline="WEIGHT" slot={<DataState at={weighIns.dataUpdatedAt} />} />
      <ScreenTabs current="/progress" navigate={navigate} />
      <ProgressSections current="/progress/weight" navigate={navigate} />

      {profile == null && (
        <Notice tone="flag" word="Set up first">
          A day’s weight is read in your time zone. Save your profile on{' '}
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
      {weighIns.isError && (
        <Notice tone="flag" word="Not updated">
          Couldn’t reach Overload.{' '}
          {data === undefined ? 'Try again when you have signal.' : 'Showing the last copy.'}
        </Notice>
      )}
      <SaveNotice problem={problem} what="weigh-in" />
      {(weighed || deleted) && problem === undefined && (
        <output className="saved-line">
          <CheckIcon size={13} color="var(--done)" />
          {deleted ? 'Weigh-in deleted.' : 'Weigh-in saved.'}
        </output>
      )}

      {profile != null && data !== undefined && data.weighIns.length === 0 && (
        <section className="empty-state" aria-labelledby="no-weigh-ins">
          <h2 id="no-weigh-ins" className="empty-state__title">
            No weigh-ins yet
          </h2>
          <p className="empty-state__body">
            Type your weight here, best in the morning before 10:00. The trend line starts from your
            third day.
          </p>
          <button type="button" className="button button--primary" onClick={typeOne}>
            Type a weight
          </button>
        </section>
      )}

      {profile != null && data !== undefined && data.weighIns.length > 0 && (
        <WeightBody
          data={data}
          unit={profile.weightUnit}
          timeZone={profile.timezone}
          phase={phase}
          navigate={navigate}
          onType={typeOne}
          onDeleted={() => {
            setProblem(undefined);
            setDeleted(true);
          }}
          onProblem={(next) => {
            setDeleted(false);
            setProblem(next);
          }}
        />
      )}

      {profile != null && (
        <div className="today__section">
          <MaintenanceCard
            unit={profile.weightUnit}
            timeZone={profile.timezone}
            phase={phase}
            onType={typeOne}
          />
        </div>
      )}

      <AccountFooter email={me.user.email} admin={me.isAdmin} navigate={navigate} />
    </main>
  );
}

function WeightBody({
  data,
  unit,
  timeZone,
  phase,
  navigate,
  onType,
  onDeleted,
  onProblem,
}: {
  data: WeighIns;
  unit: WeightUnit;
  timeZone: string;
  phase: GoalPhase | undefined;
  navigate: Navigate;
  onType: () => void;
  onDeleted: () => void;
  onProblem: (problem: SaveProblem) => void;
}) {
  // The day the screen opened on: the chart's span ends on it.
  const [today] = useState(() => localDate(Date.now(), timeZone));
  const [span, setSpan] = useState<'30' | 'phase'>('30');
  const spanName = useId();
  // Since the phase began, when one is open and began before today; else the last 30 days.
  const sincePhase = phase !== undefined && phase.startedOn < today ? phase : undefined;
  const from =
    span === 'phase' && sincePhase !== undefined
      ? sincePhase.startedOn
      : localDate(Date.parse(`${today}T12:00:00Z`) - (SPAN_DAYS - 1) * DAY_MS, 'UTC');
  const spanWords =
    span === 'phase' && sincePhase !== undefined
      ? `since ${shortDate(sincePhase.startedOn)}`
      : 'over the last 30 days';
  // Oldest first, inside the span: what the chart plots.
  // oxlint-disable-next-line unicorn/no-array-reverse -- toReversed is unavailable on supported iOS Safari 15; this array is new.
  const shown = data.days.filter((day) => day.date >= from && day.date <= today).reverse();
  const latest = data.days[0];
  const trend = data.trendAvailable;
  const ringInView = shown.some((day) => !day.morning);
  const recent = data.weighIns.slice(0, RECENT);

  return (
    <>
      <section className="whead" aria-label={trend ? 'Trend' : 'Latest weigh-in'}>
        {latest !== undefined && (
          <div>
            <span className="whead__label">{trend ? 'Trend' : 'Latest weigh-in'}</span>
            <span className="whead__fig">
              {tenth(trend ? (latest.trendKg ?? latest.weightKg) : latest.weightKg, unit)}
              <span className="whead__unit"> {unitWord(unit)}</span>
            </span>
          </div>
        )}
        {trend ? (
          data.weekChangeKg !== null && (
            <p className="whead__rate">
              <span className="whead__rate-fig" aria-hidden="true">
                {signed(data.weekChangeKg, unit)} {unitWord(unit)}
              </span>
              <span className="visually-hidden">{spoken(data.weekChangeKg, unit)}</span>
              <span className="whead__rate-words">in the last week</span>
            </p>
          )
        ) : (
          <p className="whead__rate">
            <span className="whead__rate-words">
              The trend starts from your third day of weigh-ins. {TREND_DAYS - data.days.length} to
              go.
            </span>
          </p>
        )}
      </section>

      {trend && sincePhase !== undefined && (
        <fieldset className="segments segments--top segments--mono">
          <legend className="visually-hidden">Chart span</legend>
          {(
            [
              ['30', '30 days'],
              ['phase', `Since ${shortDate(sincePhase.startedOn)}`],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="segments__segment">
              <input
                type="radio"
                name={spanName}
                checked={span === value}
                onChange={() => setSpan(value)}
              />
              {label}
            </label>
          ))}
        </fieldset>
      )}
      {shown.length === 0 ? (
        <p className="wchart__none">No weigh-ins {spanWords}.</p>
      ) : (
        <WeightChart
          days={shown}
          from={from}
          to={today}
          unit={unit}
          trend={trend}
          spanWords={spanWords}
        />
      )}
      <div className="legend" aria-hidden="true">
        {trend && (
          <span className="legend__item">
            <span className="legend__swatch wlegend__trend" />
            Trend
          </span>
        )}
        <span className="legend__item">
          <span className="wlegend__dot" />
          Morning weigh-in
        </span>
        {ringInView && (
          <span className="legend__item">
            <span className="wlegend__ring" />
            Not a morning weigh-in
          </span>
        )}
      </div>

      <div className="section-actions">
        <button type="button" className="button button--secondary" onClick={onType}>
          Type a weight
        </button>
      </div>

      <section className="today__section" aria-labelledby="recent-weigh-ins">
        <h2 id="recent-weigh-ins" className="section-label">
          Recent weigh-ins
        </h2>
        <ul className="weighins">
          {recent.map((weighIn) => (
            <WeighInRow
              key={weighIn.id}
              weighIn={weighIn}
              day={data.days.find((day) => day.weighInId === weighIn.id)}
              unit={unit}
              timeZone={timeZone}
              onDeleted={onDeleted}
              onProblem={onProblem}
            />
          ))}
        </ul>
      </section>

      {phase !== undefined && (
        <a
          href="/plan/phase"
          className="link-row"
          onClick={(event) => {
            event.preventDefault();
            navigate('/plan/phase', { returns: true });
          }}
        >
          <span>
            <span className="link-row__name">{phaseLine(phase, planToday(timeZone))}</span>
            <span className="link-row__meta">
              {phase.type === 'maintain' || phase.targetRatePctPerWeek === null
                ? 'Target: maintain your weight'
                : `Target: ${phase.type === 'cut' ? 'lose' : 'gain'} ${phase.targetRatePctPerWeek}% a week${latest === undefined ? '' : `, about ${tenth(((latest.trendKg ?? latest.weightKg) * phase.targetRatePctPerWeek) / 100, unit)} ${unitWord(unit)}`}`}
            </span>
          </span>
          <Chevron direction="forward" />
        </a>
      )}

      <footer className="footnote footnote--after">
        <span>The trend smooths each day’s weight</span>
        <span className="footnote__formula">10% a day</span>
      </footer>
    </>
  );
}

/** The canvas: the prototype's 358 × 186, scaled to the column. */
const W = 358;
const H = 186;
const PLOT = { left: 30, right: W - 8, top: 10, bottom: H - 24 };
const STEPS = [1, 2, 5, 10, 20];

/**
 * Daily weights as discs, a weight that was not a morning weigh-in as a ring, and the trend over
 * them with its latest point solid (docs/10 §6). Drawing only: every value is the API's.
 */
function WeightChart({
  days,
  from,
  to,
  unit,
  trend,
  spanWords,
}: {
  days: WeightDay[];
  from: string;
  to: string;
  unit: WeightUnit;
  trend: boolean;
  /** `over the last 30 days`, or `since 4 Sep`. */
  spanWords: string;
}) {
  const values = days.flatMap((day) => [
    fromKg(day.weightKg, unit),
    ...(day.trendKg === null ? [] : [fromKg(day.trendKg, unit)]),
  ]);
  const pad = fromKg(0.3, unit);
  const low = Math.min(...values) - pad;
  const high = Math.max(...values) + pad;
  // The smallest round step that keeps the axis to five gridlines.
  const step = STEPS.find((each) => Math.ceil(high / each) - Math.floor(low / each) <= 4) ?? 50;
  const lo = Math.floor(low / step) * step;
  const hi = Math.max(Math.ceil(high / step) * step, lo + step);
  const x = (date: string) => (from === to ? PLOT.right : dateX(date, from, to, PLOT));
  const y = (value: number) => PLOT.top + ((hi - value) / (hi - lo)) * (PLOT.bottom - PLOT.top);
  const grid: number[] = [];
  for (let value = lo; value <= hi + step / 2; value += step) grid.push(value);
  const trended = trend ? days.filter((day) => day.trendKg !== null) : [];
  const last = trended.at(-1);
  const dates = axisDates(from, to);
  const latest = days.at(-1);
  const summary =
    latest === undefined
      ? `Daily weights ${spanWords}.`
      : `Daily weights ${spanWords}${trend ? ', and the trend' : ''}: ${days.length} weighed ${days.length === 1 ? 'day' : 'days'}, the latest ${tenth(latest.weightKg, unit)} ${unitName(unit)}${latest.trendKg === null ? '' : `, trend ${tenth(latest.trendKg, unit)}`}.`;

  return (
    <figure className="chart wchart">
      <figcaption className="visually-hidden">{summary}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" aria-hidden="true">
        {grid.map((value) => (
          <g key={value}>
            <line className="chart__gridline" x1={PLOT.left} x2={W} y1={y(value)} y2={y(value)} />
            <text className="chart__label" x={0} y={y(value) + 3}>
              {Number.isInteger(value) ? value : value.toFixed(1)}
            </text>
          </g>
        ))}
        {trended.length > 0 && (
          <path
            className="chart__line wchart__trend"
            d={trended
              .map(
                (day, index) =>
                  `${index === 0 ? 'M' : 'L'}${x(day.date).toFixed(1)} ${y(fromKg(day.trendKg ?? 0, unit)).toFixed(1)}`,
              )
              .join(' ')}
          />
        )}
        {days.map((day) =>
          day.morning ? (
            <circle
              key={day.date}
              className="wchart__dot"
              cx={x(day.date)}
              cy={y(fromKg(day.weightKg, unit))}
              r={2.5}
            />
          ) : (
            <circle
              key={day.date}
              className="wchart__ring"
              cx={x(day.date)}
              cy={y(fromKg(day.weightKg, unit))}
              r={2.2}
            />
          ),
        )}
        {last !== undefined && last.trendKg !== null && (
          <circle
            className="chart__latest"
            cx={x(last.date)}
            cy={y(fromKg(last.trendKg, unit))}
            r={3.5}
          />
        )}
        <text className="chart__label" x={PLOT.left} y={H - 6}>
          {dates[0]}
        </text>
        <text
          className="chart__label"
          x={(PLOT.left + PLOT.right) / 2}
          y={H - 6}
          textAnchor="middle"
        >
          {dates[1]}
        </text>
        <text className="chart__label" x={W} y={H - 6} textAnchor="end">
          {dates[2]}
        </text>
      </svg>
    </figure>
  );
}

/**
 * One reading: when, how much, and whether it stands for its day. A typed one can be deleted; one
 * from Apple Health is deleted there, since the next export would send it again (docs/07 §5).
 */
function WeighInRow({
  weighIn,
  day,
  unit,
  timeZone,
  onDeleted,
  onProblem,
}: {
  weighIn: WeighIn;
  day: WeightDay | undefined;
  unit: WeightUnit;
  timeZone: string;
  onDeleted: () => void;
  onProblem: (problem: SaveProblem) => void;
}) {
  const [busy, setBusy] = useState(false);
  const date = dayLabel(weighIn.measuredAt, timeZone);
  const time = clockLabel(weighIn.measuredAt, timeZone);
  const note = day === undefined ? ' · stored, not in trend' : day.morning ? '' : ' · not morning';

  const remove = async () => {
    setBusy(true);
    try {
      await forAccount(async () =>
        expectOk(await api.DELETE('/api/weigh-ins/{id}', { params: { path: { id: weighIn.id } } })),
      );
      await refreshWeighIns();
      onDeleted();
    } catch (error) {
      onProblem(saveProblem(error));
      setBusy(false);
    }
  };

  return (
    <li className="weighins__row">
      <span className="weighins__date">{date}</span>
      <span className="weighins__time">
        {time}
        {note}
      </span>
      <span className="weighins__kg">
        {tenth(weighIn.weightKg, unit)}
        <span className="weighins__unit"> {unitWord(unit)}</span>
      </span>
      <span className="weighins__src">
        {weighIn.source === 'manual' ? (
          <button
            type="button"
            className="button button--tertiary weighins__del"
            disabled={busy}
            onClick={() => void remove()}
          >
            Delete
            <span className="visually-hidden">
              {' '}
              the weigh-in of {date}, {time}
            </span>
          </button>
        ) : (
          'Scale'
        )}
      </span>
    </li>
  );
}
