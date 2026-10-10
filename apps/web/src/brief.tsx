import type { WeightUnit } from '@overload/api-contract';
import type { WorkoutExerciseRecord } from './set-store';
import { formatWeight, unitLabel } from './units';

// The two lines an exercise opens with on the workout screen (docs/05 §4.19, docs/10 §1): what was
// done last time, and today's target with its reason, in words. The target is the API's suggestion
// (CONTEXT.md); this only says it. Nothing here decides a weight.

const DAY_MS = 86_400_000;
const dayOf = (isoDate: string) => new Date(`${isoDate}T00:00:00Z`).getTime();

const dateLabel = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

/** `Mon 5 Oct · 5 days ago`, counted in days of the profile's time zone. */
function when(isoDate: string, timeZone: string) {
  // en-CA writes a date as YYYY-MM-DD.
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const days = Math.round((dayOf(today) - dayOf(isoDate)) / DAY_MS);
  const ago =
    days <= 0
      ? 'today'
      : days === 1
        ? 'yesterday'
        : days < 14
          ? `${days} days ago`
          : `${Math.round(days / 7)} weeks ago`;
  return `${dateLabel.format(dayOf(isoDate)).replace(',', '')} · ${ago}`;
}

const range = (exercise: WorkoutExerciseRecord) =>
  exercise.row.repLow === exercise.row.repHigh
    ? String(exercise.row.repLow)
    : `${exercise.row.repLow}–${exercise.row.repHigh}`;

function why(exercise: WorkoutExerciseRecord, unit: WeightUnit, riseKg: number) {
  const { lastTime, suggestion, equipment } = exercise.local;
  if (suggestion === null) return '';
  const { repLow, repHigh, incrementKg } = exercise.row;
  // A no-break space: the figure and its unit never part at the end of a line.
  const kg = (value: number) =>
    `${formatWeight(value, unit)}\u00a0${unitLabel(unit).toLowerCase()}`;
  const count = lastTime.length;
  const priorHighText = suggestion.reason.match(
    suggestion.rule === 'top_of_range_hit' ? /\bhit (\d+)\b/ : /\bof (\d+)\b/,
  )?.[1];
  const priorHigh = priorHighText === undefined ? undefined : Number(priorHighText);
  const priorTarget = priorHigh === undefined ? 'the top of the rep range' : `${priorHigh} reps`;

  if (suggestion.rule === 'top_of_range_hit') {
    const reached = `You reached ${priorTarget} on ${count === 1 ? 'your only set' : 'every set'} last time`;
    return riseKg > 0
      ? `${reached}, so the weight goes up by ${kg(riseKg)}. Aim for ${repLow} or more.`
      : `${reached}. This exercise has no increment, so the weight stays the same.`;
  }

  const short = lastTime.filter((set) => priorHigh !== undefined && set.reps < priorHigh).length;
  const stopped =
    count === 1
      ? 'Your set'
      : priorHigh === undefined
        ? 'Some sets'
      : short === count
        ? `All ${count} sets`
        : `${short} ${short === 1 ? 'set' : 'sets'} of ${count}`;
  const head = `${stopped} stopped short of ${priorTarget} last time.`;
  const reach = count === 1 ? `Reach ${repHigh}` : `Reach ${repHigh} on all ${count}`;
  if (riseKg > 0) {
    return `${head} The weight rounds up by ${kg(riseKg)} to a makeable weight. ${reach} this time.`;
  }
  if (incrementKg <= 0) return `${head} ${reach} this time.`;
  // The weight the rule moves to is the API's to work out: a dumbbell rack does not make every
  // weight (docs/06, 2026-09-23), so only a class that makes what its increment adds is named.
  const makesEveryStep = equipment !== undefined && equipment !== 'dumbbell';
  return makesEveryStep
    ? `${head} ${reach} and next time goes up to ${kg(suggestion.weightKg + incrementKg)}.`
    : `${head} ${reach} and next time the weight goes up.`;
}

export function Brief({
  exercise,
  unit,
  timeZone,
}: {
  exercise: WorkoutExerciseRecord;
  unit: WeightUnit;
  timeZone: string;
}) {
  const { name, bodyweight, lastTime, lastTimeOn, lastTimeKnown, suggestion } = exercise.local;
  const reps = range(exercise);
  const unitWord = unitLabel(unit).toLowerCase();

  if (lastTime.length === 0 && !lastTimeKnown) {
    return (
      <div className="brief">
        <div className="brief__row">
          <div className="brief__head">
            <span className="brief__label">Last time</span>
          </div>
          <p className="brief__why">Last time is not available offline.</p>
        </div>
      </div>
    );
  }

  // The first workout of an exercise says so, instead of showing nothing.
  if (lastTime.length === 0) {
    return (
      <div className="brief">
        <div className="brief__row">
          <div className="brief__head">
            <span className="brief__label">Last time</span>
          </div>
          <div className="brief__figures">None yet</div>
          <p className="brief__why">
            This is your first time logging {name}, so there is nothing to compare with.
          </p>
        </div>
        <div className="brief__row brief__row--target">
          <div className="brief__head">
            <span className="brief__label">Today’s target</span>
            <span className="brief__tag">First workout</span>
          </div>
          <div className="brief__figures">
            {bodyweight ? 'Bodyweight' : 'Find your weight'}{' '}
            <span className="brief__unit">× {reps}</span>
          </div>
          <p className="brief__why">
            {bodyweight
              ? `Do ${reps} reps with one to three left in you.`
              : `Pick a weight you can lift for ${reps} reps with one to three left in you.`}{' '}
            From the next workout, this line shows what you did and what to aim for.
          </p>
        </div>
      </div>
    );
  }

  const sameWeight = lastTime.every((set) => set.weightKg === lastTime[0]?.weightKg);
  const lastKg = Math.max(...lastTime.map((set) => set.weightKg));
  const riseKg = suggestion === null ? 0 : Math.round((suggestion.weightKg - lastKg) * 100) / 100;
  const up = riseKg > 0;
  return (
    <div className="brief">
      <div className="brief__row">
        <div className="brief__head">
          <span className="brief__label">Last time</span>
          {lastTimeOn != null && <span className="brief__when">{when(lastTimeOn, timeZone)}</span>}
        </div>
        <div className="brief__figures">
          {sameWeight ? (
            <>
              {formatWeight(lastTime[0]?.weightKg ?? 0, unit)}{' '}
              <span className="brief__unit">{unitWord} ×</span>{' '}
              {lastTime.map((set) => set.reps).join(' · ')}
            </>
          ) : (
            lastTime.map((set) => `${formatWeight(set.weightKg, unit)}×${set.reps}`).join(' · ')
          )}
        </div>
      </div>
      {suggestion !== null && (
        <div className="brief__row brief__row--target">
          <div className="brief__head">
            <span className="brief__label">Today’s target</span>
            <span className="brief__tag">
              {up ? `+${formatWeight(riseKg, unit)} ${unitWord}` : 'Same weight'}
            </span>
          </div>
          <div className="brief__figures">
            {formatWeight(suggestion.weightKg, unit)}{' '}
            <span className="brief__unit">{unitWord} ×</span> {reps}
          </div>
          <p className="brief__why">{why(exercise, unit, riseKg)}</p>
        </div>
      )}
    </div>
  );
}
