import type { Me, WeightUnit } from '@overload/api-contract';
import { useId, useRef, useState } from 'react';
import { api, unwrap } from '../api';
import {
  AppBar,
  DataState,
  FieldError,
  FieldLabel,
  NumberField,
  Notice,
  parseFigure,
} from '../components';
import { nowIn, zonedInstant } from '../dates';
import { newId } from '../ids';
import { goBack, type Navigate } from '../navigation';
import { forAccount, refreshWeighIns } from '../query';
import {
  refusedOnDevice,
  saveProblem,
  SaveNotice,
  useFocusRefused,
  type SaveProblem,
} from '../saving';
import { toKg } from '../units';

// Type a weight (docs/10 §8.6, S11): a permanent way in next to the scale, not only a fallback
// (docs/06, 2026-10-16). Typed in the profile's unit and saved in kg, at a date and time read in the
// profile's time zone, under an id made here so a retried save lands once (docs/07 §1.2).

/** What the API takes (docs/07 §5), in kg. */
const WEIGHT_KG = { min: 20, max: 300 };
const BODY_FAT = { min: 1, max: 75 };
/** Before this local time a reading is the morning's weigh-in (S11). */
const MORNING_ENDS = '10:00';

const range = (unit: WeightUnit) =>
  unit === 'lb' ? 'A weight between 44.1 and 661.3 lb.' : 'A weight between 20 and 300 kg.';

export function WeighIn({ me, navigate }: { me: Me; navigate: Navigate }) {
  const profile = me.profile;
  const back = () => goBack(navigate, '/progress/weight');
  return (
    <main>
      <AppBar
        title="Type a weight"
        slot={<DataState at={0} />}
        back={{ label: 'Back to weight', onClick: back }}
      />
      {profile == null ? (
        <Notice tone="flag" word="Set up first">
          A weigh-in’s time is read in your time zone. Save your profile on{' '}
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
      ) : (
        <WeighInForm
          unit={profile.weightUnit}
          timeZone={profile.timezone}
          onSaved={() => navigate('/progress/weight', { replace: true, note: 'weighed' })}
        />
      )}
    </main>
  );
}

function WeighInForm({
  unit,
  timeZone,
  onSaved,
}: {
  unit: WeightUnit;
  timeZone: string;
  onSaved: () => void;
}) {
  // Date and time start at now and can be changed (Q15).
  const [opened] = useState(() => ({ at: Date.now(), ...nowIn(timeZone) }));
  const [weight, setWeight] = useState('');
  const [date, setDate] = useState(opened.date);
  const [time, setTime] = useState(opened.time);
  const [bodyFat, setBodyFat] = useState('');
  // One id per weigh-in being typed, so a retried save lands once (docs/07 §1.2).
  const [id] = useState(newId);
  const uncertain = useRef<{ id: string; fields: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<SaveProblem>();
  const form = useFocusRefused(problem);
  const dateId = useId();
  const timeId = useId();
  const hintId = useId();

  const refused = (path: string) =>
    problem?.kind === 'refused' ? problem.fields.get(path) : undefined;
  const whenError =
    refused('measuredAt') ??
    (problem?.kind === 'refused' && problem.code === 'weigh_in_exists'
      ? 'You already typed a weigh-in at this time.'
      : undefined);

  const save = async () => {
    const typed = parseFigure(weight);
    const fat = parseFigure(bodyFat);
    // Untouched, the weigh-in is now to the millisecond; a time typed is that minute.
    const measuredAt =
      date === opened.date && time === opened.time
        ? new Date(opened.at)
        : date === '' || time === ''
          ? undefined
          : zonedInstant(date, time, timeZone);
    const weightKg = typed === null || !Number.isFinite(typed) ? undefined : toKg(typed, unit);
    const onDevice = refusedOnDevice([
      ...(weightKg === undefined || weightKg < WEIGHT_KG.min || weightKg > WEIGHT_KG.max
        ? ([['weightKg', range(unit)]] as [string, string][])
        : []),
      ...(measuredAt === undefined
        ? ([['measuredAt', 'Choose a date and a time.']] as [string, string][])
        : measuredAt.getTime() > Date.now() + 60 * 1000
          ? ([['measuredAt', 'That time hasn’t come yet.']] as [string, string][])
          : []),
      ...(fat !== null && (!Number.isFinite(fat) || fat < BODY_FAT.min || fat > BODY_FAT.max)
        ? ([['bodyFatPct', 'Body fat between 1 and 75%, or leave it empty.']] as [string, string][])
        : []),
    ]);
    if (onDevice !== undefined || weightKg === undefined || measuredAt === undefined) {
      setProblem(onDevice);
      return;
    }
    const fields = JSON.stringify([weight, date, time, bodyFat]);
    const saveId =
      uncertain.current === null
        ? id
        : uncertain.current.fields === fields
          ? uncertain.current.id
          : newId();
    setBusy(true);
    setProblem(undefined);
    let answered = false;
    try {
      await forAccount(async () =>
        unwrap(
          await api.POST('/api/weigh-ins', {
            body: {
              id: saveId,
              measuredAt: measuredAt.toISOString(),
              weightKg,
              bodyFatPct: fat === null ? null : Math.round(fat * 10) / 10,
            },
          }),
        ),
      );
      answered = true;
      await refreshWeighIns();
      onSaved();
    } catch (error) {
      const next = saveProblem(error);
      if (!answered && next.kind === 'unreached') uncertain.current = { id: saveId, fields };
      // The server's own words for a weight are in kg; the field says it in the user's unit.
      if (next.kind === 'refused' && next.fields.has('weightKg'))
        next.fields.set('weightKg', range(unit));
      if (next.kind === 'refused' && next.fields.has('bodyFatPct')) {
        next.fields.set('bodyFatPct', 'Body fat between 1 and 75%, or leave it empty.');
      }
      setProblem(next);
      setBusy(false);
    }
  };

  const morning = time !== '' && time < MORNING_ENDS;

  return (
    <>
      <SaveNotice problem={problem} what="weigh-in" />
      <form
        ref={form}
        className="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void save();
        }}
      >
        <NumberField
          label="Weight"
          value={weight}
          onChange={setWeight}
          decimal
          unit={unit}
          placeholder="0.0"
          error={refused('weightKg')}
        />
        <div className="form__pair">
          <div className="field">
            <FieldLabel htmlFor={dateId} label="Date" />
            <input
              id={dateId}
              type="date"
              className="field__input field__input--when"
              value={date}
              max={nowIn(timeZone).date}
              required
              autoComplete="off"
              aria-invalid={whenError === undefined ? undefined : true}
              aria-describedby={whenError === undefined ? hintId : `${timeId}-error ${hintId}`}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
          <div className="field">
            <FieldLabel htmlFor={timeId} label="Time" />
            <input
              id={timeId}
              type="time"
              className="field__input field__input--when"
              value={time}
              required
              autoComplete="off"
              aria-invalid={whenError === undefined ? undefined : true}
              aria-describedby={whenError === undefined ? hintId : `${timeId}-error ${hintId}`}
              onChange={(event) => setTime(event.target.value)}
            />
          </div>
        </div>
        {whenError !== undefined && <FieldError id={`${timeId}-error`} message={whenError} />}
        <p className="weigh__hint" id={hintId} aria-live="polite">
          {morning
            ? 'Before 10:00, so it counts as this morning’s weigh-in, unless the scale sent an earlier one.'
            : 'After 10:00. It counts for the day only if there is no reading before 10:00, and is marked as not a morning weigh-in.'}
        </p>
        <NumberField
          label="Body fat"
          note="Optional"
          value={bodyFat}
          onChange={setBodyFat}
          decimal
          unit="%"
          placeholder="—"
          error={refused('bodyFatPct')}
        />
        <button type="submit" className="button button--primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save weigh-in'}
        </button>
      </form>
      <p className="weigh__hint weigh__hint--gutter">
        Typing is always here, next to the scale. A typed weigh-in can be deleted; one from the
        scale cannot, because the scale would send it again.
      </p>
    </>
  );
}
