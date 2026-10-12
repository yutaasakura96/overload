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
import { AppBar, DataState, Notice } from '../components';
import { dayLabel } from '../dates';
import { goBack, type Navigate } from '../navigation';
import { allExercisesQuery, progressQuery, useAccount } from '../query';
import { formatVolume, formatWeight, fromKg, unitName } from '../units';

// Screen 2 (docs/10 §2, S7): one exercise's e1RM per workout over a span, with the span's top set
// and volume load, and under them the sets of each of those workouts, each opening its workout in
// History. Every number is the API's (docs/07 §3); this screen only draws them. The S20 overlays
// and their chips arrive with their data, in M2 and M3.

const SPANS: { span: Span; label: string; name: string; over: string }[] = [
  { span: '4w', label: '4W', name: '4 weeks', over: 'Over 4W' },
  { span: '12w', label: '12W', name: '12 weeks', over: 'Over 12W' },
  { span: '6m', label: '6M', name: '6 months', over: 'Over 6M' },
  { span: '1y', label: '1Y', name: '1 year', over: 'Over 1Y' },
  { span: 'all', label: 'ALL', name: 'All time', over: 'All time' },
];

/** The span the screen opens on, and the API's own default (docs/07 §3). */
const DEFAULT_SPAN: Span = '12w';

/** An e1RM, or a change in one, as the screen prints it: in the user's unit, to the tenth. */
const e1rmIn = (kg: number, unit: WeightUnit) => Math.round(fromKg(kg, unit) * 10) / 10;

export function Progress({
  id,
  me,
  searchParams,
  navigate,
}: {
  id: string;
  me: Me;
  searchParams: URLSearchParams;
  navigate: Navigate;
}) {
  // The saved copy shows until /api/me confirms the account; no fetch runs under an unconfirmed one.
  const confirmed = useAccount().status === 'confirmed';
  // The span is part of the address, so a reload or a shared link opens the same chart.
  const span = SPANS.find((each) => each.span === searchParams.get('span'))?.span ?? DEFAULT_SPAN;
  const setSpan = (next: Span) =>
    navigate(`/exercises/${id}/progress${next === DEFAULT_SPAN ? '' : `?span=${next}`}`, {
      replace: true,
    });
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
  // Reached from the exercise's form and from a workout in History: Back is where it came from.
  const back = { label: 'Back', onClick: () => goBack(navigate, `/exercises/${id}`) };
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
          {data.from === null || data.points[0]?.date === data.points.at(-1)?.date ? (
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
                      {formatVolume(data.stats.volumeKg, unit)}
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

          <PastSets points={data.points} unit={unit} navigate={navigate} />
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

/** `80 × 10 · 10 · 9` at one weight; `80×10 · 82.5×8` where the weight changed. */
function setsLine(sets: Points[number]['sets'], unit: WeightUnit) {
  const [first] = sets;
  if (first === undefined) return '';
  if (sets.every((set) => set.weightKg === first.weightKg)) {
    return `${formatWeight(first.weightKg, unit)} × ${sets.map((set) => set.reps).join(' · ')}`;
  }
  return sets.map((set) => `${formatWeight(set.weightKg, unit)}×${set.reps}`).join(' · ');
}

/**
 * The exercise's past sets, newest first: one row for each workout the chart draws, with its
 * working sets and the e1RM the chart plots for it. A row opens that workout in History, where a
 * set is corrected.
 */
function PastSets({
  points,
  unit,
  navigate,
}: {
  points: Points;
  unit: WeightUnit;
  navigate: Navigate;
}) {
  return (
    <section aria-labelledby="past-sets">
      <h2 id="past-sets" className="section-label section-label--gutter past-label">
        Past sets · {points.length} {points.length === 1 ? 'workout' : 'workouts'}
      </h2>
      {points.length === 0 ? (
        <p className="empty">No sets logged in this span.</p>
      ) : (
        <ul className="past">
          {points.toReversed().map((point) => (
            <li key={point.workoutId}>
              <a
                href={`/workouts/${point.workoutId}`}
                className="past__row"
                onClick={(event) => {
                  event.preventDefault();
                  navigate(`/workouts/${point.workoutId}`, { returns: true });
                }}
              >
                <span className="past__date">
                  {dayLabel(`${point.date}T00:00:00Z`, 'UTC')} · {point.workoutName}
                </span>
                <span className="past__e1rm">
                  <span className="visually-hidden">: estimated 1RM </span>
                  {e1rmIn(point.e1rmKg, unit).toFixed(1)}
                  <small aria-hidden="true">E1RM</small>
                  <span className="visually-hidden"> {unitName(unit)}, sets </span>
                </span>
                {/* A chart saved by a build before points carried their sets is drawn without them
                    until the answer asked for on opening replaces it. */}
                <span className="past__sets">{setsLine(point.sets ?? [], unit)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
