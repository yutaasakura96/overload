import type { Me, Progress as ProgressData, Span, WeightUnit } from '@overload/api-contract';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../api';
import {
  E1RM_CHART,
  axisDates,
  dateLabel,
  dateX,
  gridValues,
  nearestIndex,
  valueScale,
  valueY,
} from '../chart';
import { AppBar, Chevron, DataState, Notice } from '../components';
import { allExercisesQuery, progressQuery, useAccount } from '../query';
import { formatWeight, fromKg } from '../units';

// Screen 2 (docs/10 §2, S7): one exercise's e1RM per workout over a span, with the span's top set
// and volume load. Every number is the API's (docs/07 §3); this screen only draws them. The S20
// overlays and their chips arrive with their data, in M2 and M3.

const SPANS: { span: Span; label: string; name: string; over: string }[] = [
  { span: '4w', label: '4W', name: '4 weeks', over: 'Over 4W' },
  { span: '12w', label: '12W', name: '12 weeks', over: 'Over 12W' },
  { span: '6m', label: '6M', name: '6 months', over: 'Over 6M' },
  { span: '1y', label: '1Y', name: '1 year', over: 'Over 1Y' },
  { span: 'all', label: 'ALL', name: 'All time', over: 'All time' },
];

/** The span the screen opens on, and the API's own default (docs/07 §3). */
const DEFAULT_SPAN: Span = '12w';

const unitName = (unit: WeightUnit) => (unit === 'lb' ? 'pounds' : 'kilograms');

/** An e1RM, or a change in one, as the screen prints it: in the user's unit, to the tenth. */
const e1rmIn = (kg: number, unit: WeightUnit) => Math.round(fromKg(kg, unit) * 10) / 10;

/** A volume load in the user's unit, to the whole number, with thousands separated. */
const volumeIn = (kg: number, unit: WeightUnit) =>
  Math.round(fromKg(kg, unit)).toLocaleString('en-US');

export function Progress({
  id,
  me,
  searchParams,
  navigate,
}: {
  id: string;
  me: Me;
  searchParams: URLSearchParams;
  navigate: (path: string, options?: { replace?: boolean }) => void;
}) {
  // The saved copy shows until /api/me confirms the account; no fetch runs under an unconfirmed one.
  const confirmed = useAccount().status === 'confirmed';
  // The span is part of the address, so a reload or a shared link opens the same chart.
  const span = SPANS.find((each) => each.span === searchParams.get('span'))?.span ?? DEFAULT_SPAN;
  const setSpan = (next: Span) =>
    navigate(`/exercises/${id}/progress${next === DEFAULT_SPAN ? '' : `?span=${next}`}`, {
      replace: true,
    });
  const [listed, setListed] = useState(false);
  // The workout picked out on the chart, by its place in the span's points.
  const [picked, setPicked] = useState<number>();
  const exercises = useQuery({ ...allExercisesQuery, enabled: confirmed });
  const hasProfile = me.profile != null;
  // The last chart stays while another span loads, so the screen keeps its frame.
  const progress = useQuery({
    ...progressQuery(id, span),
    enabled: confirmed && hasProfile,
    placeholderData: keepPreviousData,
  });
  const unit = me.profile?.weightUnit ?? 'kg';
  const exercise = exercises.data?.find((candidate) => candidate.id === id);
  const back = { label: 'Back to the exercise', onClick: () => navigate(`/exercises/${id}`) };
  const slot = <DataState at={progress.dataUpdatedAt} />;
  const unknown =
    (progress.error instanceof ApiError && progress.error.status === 404) ||
    (exercises.data !== undefined && exercise === undefined);

  if (unknown) {
    return (
      <main>
        <AppBar title="Progress" slot={slot} back={back} />
        <p className="empty">This exercise is not in your library.</p>
      </main>
    );
  }

  const data = progress.data;
  const shown = SPANS.find((each) => each.span === (data?.span ?? span));
  return (
    <main className="progress">
      <AppBar title={exercise?.name ?? 'Progress'} slot={slot} back={back} />

      {!hasProfile && (
        <Notice tone="flag" word="Set up first">
          The chart dates each workout in your time zone. Save your profile on{' '}
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
      {progress.isError && (
        <Notice tone="flag" word="Not updated">
          Couldn’t reach Overload.{' '}
          {data === undefined ? 'Try again when you have signal.' : 'Showing the last copy.'}
        </Notice>
      )}

      <Headline
        data={data}
        picked={picked === undefined ? undefined : data?.points[picked]}
        unit={unit}
        over={shown?.over ?? ''}
      />

      <fieldset className="segments segments--spans">
        <legend className="visually-hidden">Time span</legend>
        {SPANS.map((each) => (
          <label key={each.span} className="segments__segment">
            <input
              type="radio"
              name="span"
              checked={span === each.span}
              onChange={() => {
                setSpan(each.span);
                setPicked(undefined);
              }}
            />
            <span aria-hidden="true">{each.label}</span>
            <span className="visually-hidden">{each.name}</span>
          </label>
        ))}
      </fieldset>

      {data !== undefined && (
        <div
          className={
            progress.isPlaceholderData ? 'progress__body progress__body--stale' : 'progress__body'
          }
          aria-busy={progress.isPlaceholderData}
        >
          {data.points.length < 2 || data.from === null || data.from === data.to ? (
            <div className="progress__empty">
              <h2 className="empty-state__title">Not enough data yet</h2>
              <p className="empty-state__body">
                {data.points.length < 2
                  ? `The chart needs two workouts with a working set of this exercise${
                      data.span === 'all' ? '.' : ' in this span.'
                    }`
                  : 'The chart needs workouts with a working set of this exercise on two days.'}
              </p>
            </div>
          ) : (
            <E1rmChart
              points={data.points}
              from={data.from}
              to={data.to}
              unit={unit}
              picked={picked !== undefined && picked < data.points.length ? picked : undefined}
              onPick={setPicked}
            />
          )}

          <dl className="progress__stats">
            <div className="progress__stat">
              <dt className="progress__stat-label">Top set</dt>
              <dd className="progress__stat-value">
                {data.stats.topSetKg === null || data.stats.topSetReps === null ? (
                  <Nothing />
                ) : (
                  <>
                    <span className="progress__stat-figure">
                      {formatWeight(data.stats.topSetKg, unit)}
                    </span>
                    <span className="visually-hidden"> {unitName(unit)} for </span>
                    <span className="progress__stat-unit">
                      <span aria-hidden="true">× </span>
                      {data.stats.topSetReps}
                    </span>
                    <span className="visually-hidden"> reps</span>
                  </>
                )}
              </dd>
            </div>
            <div className="progress__stat">
              <dt className="progress__stat-label">Volume load</dt>
              <dd className="progress__stat-value">
                {data.points.length === 0 ? (
                  <Nothing />
                ) : (
                  <>
                    <span className="progress__stat-figure">
                      {volumeIn(data.stats.volumeKg, unit)}
                    </span>{' '}
                    <span className="progress__stat-unit" aria-hidden="true">
                      {unit}
                    </span>
                    <span className="visually-hidden">{unitName(unit)}</span>
                  </>
                )}
              </dd>
            </div>
          </dl>

          {data.points.length > 0 && (
            <>
              <div className="section-actions">
                <button
                  type="button"
                  className="button button--tertiary"
                  aria-expanded={listed}
                  aria-controls="progress-workouts"
                  onClick={() => setListed((open) => !open)}
                >
                  Workouts in this span
                  <Chevron direction={listed ? 'up' : 'down'} />
                </button>
              </div>
              {listed && <WorkoutTable points={data.points} unit={unit} />}
            </>
          )}
        </div>
      )}

      <footer className="footnote">
        <span>e1RM from the best working set</span>
        <span className="footnote__formula">Epley · w × (1 + r/30)</span>
      </footer>
    </main>
  );
}

/** An em dash where there is no value yet, said as words. */
function Nothing() {
  return (
    <>
      <span className="progress__stat-unit" aria-hidden="true">
        —
      </span>
      <span className="visually-hidden">No workouts</span>
    </>
  );
}

/**
 * The latest e1RM in the span, and how far it has moved since the span's first workout. While a
 * workout is picked out on the chart it reads that workout instead: its e1RM, top set and date.
 * The chart's slider says the same to a screen reader, so nothing here is announced.
 */
function Headline({
  data,
  picked,
  unit,
  over,
}: {
  data: ProgressData | undefined;
  picked: Points[number] | undefined;
  unit: WeightUnit;
  over: string;
}) {
  const latest = picked ?? data?.points.at(-1);
  const changeKg = data?.stats.changeKg;
  const change = picked !== undefined || changeKg == null ? undefined : e1rmIn(changeKg, unit);
  return (
    <section className="progress__headline" aria-labelledby="progress-headline">
      <div>
        <h2 id="progress-headline" className="section-label">
          Estimated 1RM
        </h2>
        <p className="progress__e1rm">
          {latest === undefined ? (
            <>
              <span className="progress__e1rm-unit" aria-hidden="true">
                —
              </span>
              <span className="visually-hidden">{data === undefined ? '' : 'No workouts'}</span>
            </>
          ) : (
            <>
              <span className="progress__e1rm-figure">
                {e1rmIn(latest.e1rmKg, unit).toFixed(1)}
              </span>{' '}
              <span className="progress__e1rm-unit" aria-hidden="true">
                {unit}
              </span>
              <span className="visually-hidden">{unitName(unit)}</span>
            </>
          )}
        </p>
      </div>
      {picked !== undefined && (
        <p className="progress__change" aria-hidden="true">
          <span className="progress__change-figure progress__change-figure--set">
            {formatWeight(picked.topSetKg, unit)} × {picked.topSetReps}
          </span>
          <span className="progress__change-span">{dateLabel(picked.date, true)}</span>
        </p>
      )}
      {change !== undefined && (
        <p className="progress__change">
          <span
            className={
              change > 0
                ? 'progress__change-figure progress__change-figure--up'
                : 'progress__change-figure'
            }
          >
            <span aria-hidden="true">
              {change > 0 ? '+' : change < 0 ? '−' : ''}
              {Math.abs(change).toFixed(1)}
            </span>
            <span className="visually-hidden">
              {change > 0 ? 'Up' : change < 0 ? 'Down' : 'No change:'} {Math.abs(change).toFixed(1)}{' '}
              {unitName(unit)}
            </span>
          </span>{' '}
          <span className="progress__change-span">{over}</span>
        </p>
      )}
    </section>
  );
}

/** Rings on every workout only while they all stay this far apart; closer, the line carries them. */
const RING_GAP = 7;
type Points = ProgressData['points'];

const spokenDate = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/**
 * docs/05 §5's e1RM chart, drawn at the width it is given. One workout at a time can be picked
 * out, which the headline then reads: by pointer, as the nearest in time, or from the keyboard
 * through the slider laid over it. The chart draws no value the list under it does not also hold.
 */
function E1rmChart({
  points,
  from,
  to,
  unit,
  picked,
  onPick,
}: {
  points: Points;
  from: string;
  to: string;
  unit: WeightUnit;
  picked: number | undefined;
  onPick: (index: number | undefined) => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(358);
  useEffect(() => {
    const element = frame.current;
    if (element === null) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined && entry.contentRect.width > 0) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const plot = { left: E1RM_CHART.plotLeft, right: width - E1RM_CHART.endGutter };
  const values = points.map((point) => e1rmIn(point.e1rmKg, unit));
  const scale = valueScale(values);
  const xs = points.map((point) => dateX(point.date, from, to, plot));
  const ys = values.map((value) => valueY(value, scale));
  const last = points.length - 1;
  const ringed = xs.every((x, index) => index === 0 || x - (xs[index - 1] ?? x) >= RING_GAP);
  const [start, middle, end] = axisDates(from, to);
  const said = (index: number) => {
    const point = points[index];
    if (point === undefined) return '';
    return (
      `${spokenDate.format(new Date(`${point.date}T00:00:00Z`))}: ${e1rmIn(point.e1rmKg, unit).toFixed(1)} ${unitName(unit)}, ` +
      `top set ${formatWeight(point.topSetKg, unit)} for ${point.topSetReps} reps`
    );
  };
  const pickNearest = (event: React.PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    onPick(nearestIndex(xs, event.clientX - bounds.left));
  };

  return (
    <div className="chart" ref={frame}>
      <svg
        className="chart__canvas"
        width={width}
        height={E1RM_CHART.height}
        viewBox={`0 0 ${width} ${E1RM_CHART.height}`}
        fill="none"
        aria-hidden="true"
        onPointerDown={pickNearest}
        onPointerMove={pickNearest}
        onPointerLeave={(event) => {
          // A finger lifting leaves the workout picked out; a mouse moving off puts it back.
          if (event.pointerType === 'mouse') onPick(undefined);
        }}
      >
        {E1RM_CHART.gridlines.map((y) => (
          <line key={y} x1={0} y1={y} x2={width} y2={y} className="chart__gridline" />
        ))}
        <line
          x1={0}
          y1={E1RM_CHART.baseline}
          x2={width}
          y2={E1RM_CHART.baseline}
          className="chart__baseline"
        />
        {gridValues(scale).map((value, index) => (
          <text
            key={value}
            x={0}
            y={(E1RM_CHART.gridlines[index] ?? 0) - 4}
            className="chart__label"
          >
            {value}
          </text>
        ))}

        {picked !== undefined && (
          <line
            x1={xs[picked]}
            y1={8}
            x2={xs[picked]}
            y2={E1RM_CHART.baseline}
            className="chart__crosshair"
          />
        )}
        <polyline
          points={xs.map((x, index) => `${x.toFixed(1)},${(ys[index] ?? 0).toFixed(1)}`).join(' ')}
          className="chart__line"
        />
        {ringed &&
          points
            .slice(0, last)
            .map((point, index) => (
              <circle
                key={point.workoutId}
                cx={xs[index]}
                cy={ys[index]}
                r={2.5}
                className="chart__ring"
              />
            ))}
        <circle cx={xs[last]} cy={ys[last]} r={3.5} className="chart__latest" />
        {picked !== undefined && picked !== last && (
          <circle cx={xs[picked]} cy={ys[picked]} r={3.5} className="chart__picked" />
        )}

        <text x={plot.left} y={E1RM_CHART.dateLabels} className="chart__label">
          {start}
        </text>
        <text
          x={(plot.left + plot.right) / 2}
          y={E1RM_CHART.dateLabels}
          textAnchor="middle"
          className="chart__label"
        >
          {middle}
        </text>
        <text x={plot.right} y={E1RM_CHART.dateLabels} textAnchor="end" className="chart__label">
          {end}
        </text>
      </svg>

      <input
        type="range"
        className="chart__scrub"
        aria-label="Workout on the chart"
        min={0}
        max={last}
        step={1}
        value={picked ?? last}
        aria-valuetext={said(picked ?? last)}
        onChange={(event) => onPick(Number(event.target.value))}
        onFocus={() => onPick(picked ?? last)}
        onBlur={() => onPick(undefined)}
      />
    </div>
  );
}

/** The chart's values as a table, newest first: every number the chart draws, and the volume. */
function WorkoutTable({ points, unit }: { points: Points; unit: WeightUnit }) {
  return (
    <table id="progress-workouts" className="progress__table">
      <caption className="visually-hidden">
        Workouts in this span, newest first, in {unitName(unit)}
      </caption>
      <thead>
        <tr>
          <th scope="col">Date</th>
          <th scope="col">e1RM</th>
          <th scope="col">Top set</th>
          <th scope="col">Volume</th>
        </tr>
      </thead>
      <tbody>
        {points.toReversed().map((point) => (
          <tr key={point.workoutId}>
            <th scope="row">{dateLabel(point.date, true)}</th>
            <td>{e1rmIn(point.e1rmKg, unit).toFixed(1)}</td>
            <td>
              {formatWeight(point.topSetKg, unit)} × {point.topSetReps}
            </td>
            <td>{volumeIn(point.volumeKg, unit)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
