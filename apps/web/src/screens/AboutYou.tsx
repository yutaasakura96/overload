import type { Me } from '@overload/api-contract';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { api, unwrap } from '../api';
import { AppBar, DataState, FieldError, FieldLabel, NumberField, parseFigure } from '../components';
import { dayLabel } from '../dates';
import { newId } from '../ids';
import { goBack, type Navigate } from '../navigation';
import {
  confirmedAccountData,
  forAccount,
  refreshWeighIns,
  regeneratePlan,
  setProfile,
  useAccount,
  weighInsQuery,
} from '../query';
import {
  refusedOnDevice,
  saveProblem,
  SaveNotice,
  useFocusRefused,
  type SaveProblem,
} from '../saving';
import { deviceTimezone } from '../timezones';
import { fromKg, toKg } from '../units';

// About you (docs/10 §8.6, docs/09 F10 step 0): the facts the provisional calories and protein are
// worked out from, asked once. The weight is the latest weigh-in when there is one; a weight typed
// here is saved as a weigh-in now, so the trend has it too.

const HEIGHT_CM = { min: 100, max: 250 };
const WEIGHT_KG = { min: 20, max: 300 };

export function AboutYou({ me, navigate }: { me: Me; navigate: Navigate }) {
  const confirmed = useAccount().status === 'confirmed';
  const profile = me.profile;
  const weighIns = useQuery({ ...weighInsQuery, enabled: confirmed && profile != null });
  const unit = profile?.weightUnit ?? 'kg';
  const latest = weighIns.data?.days[0];
  const complete =
    profile != null &&
    profile.heightCm !== null &&
    profile.sex !== null &&
    profile.birthDate !== null;
  const back = () => goBack(navigate, '/');
  const ready = profile == null || weighIns.data !== undefined || weighIns.isError;

  return (
    <main>
      <AppBar
        title="About you"
        subline={complete && latest !== undefined ? undefined : 'STEP 1 OF 4'}
        slot={<DataState at={weighIns.dataUpdatedAt} />}
        back={{ label: 'Back', onClick: back }}
      />
      <p className="m2-lede">
        Used only to work out starting calories and protein. You can change any of it later.
      </p>
      {ready && (
        <AboutForm
          me={me}
          latest={
            latest === undefined
              ? undefined
              : {
                  weight: (Math.round(fromKg(latest.weightKg, unit) * 10) / 10).toFixed(1),
                  date: latest.date,
                }
          }
          onSaved={() => navigate('/', { replace: true, note: 'plan-saved' })}
        />
      )}
    </main>
  );
}

function AboutForm({
  me,
  latest,
  onSaved,
}: {
  me: Me;
  latest: { weight: string; date: string } | undefined;
  onSaved: () => void;
}) {
  const profile = me.profile;
  const unit = profile?.weightUnit ?? 'kg';
  const timeZone = profile?.timezone ?? deviceTimezone();
  const [weight, setWeight] = useState(latest?.weight ?? '');
  const [height, setHeight] = useState(profile?.heightCm == null ? '' : String(profile.heightCm));
  const [birthDate, setBirthDate] = useState(profile?.birthDate ?? '');
  const [sex, setSex] = useState(profile?.sex ?? null);
  // A weigh-in typed here keeps its id across a retried save, so it lands once (docs/07 §1.2).
  const [weighInId] = useState(newId);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<SaveProblem>();
  const form = useFocusRefused(problem);
  const birthId = useId();
  const sexName = useId();
  const refused = (path: string) =>
    problem?.kind === 'refused' ? problem.fields.get(path) : undefined;

  const save = async () => {
    const typedWeight = parseFigure(weight);
    const typedHeight = parseFigure(height);
    const weightKg =
      typedWeight === null || !Number.isFinite(typedWeight) ? undefined : toKg(typedWeight, unit);
    const onDevice = refusedOnDevice([
      ...(weightKg === undefined || weightKg < WEIGHT_KG.min || weightKg > WEIGHT_KG.max
        ? ([
            [
              'weightKg',
              unit === 'lb'
                ? 'A weight between 44.1 and 661.3 lb.'
                : 'A weight between 20 and 300 kg.',
            ],
          ] as [string, string][])
        : []),
      ...(typedHeight === null ||
      !Number.isFinite(typedHeight) ||
      typedHeight < HEIGHT_CM.min ||
      typedHeight > HEIGHT_CM.max
        ? ([['heightCm', 'A height between 100 and 250 cm.']] as [string, string][])
        : []),
      ...(birthDate === ''
        ? ([['birthDate', 'Choose your birth date.']] as [string, string][])
        : []),
      ...(sex === null
        ? ([['sex', 'Choose one. It is used only by the formula.']] as [string, string][])
        : []),
    ]);
    if (onDevice !== undefined || weightKg === undefined || typedHeight === null || sex === null) {
      setProblem(onDevice);
      return;
    }
    setBusy(true);
    setProblem(undefined);
    try {
      const saved = await confirmedAccountData(() =>
        api.PATCH('/api/me/profile', {
          body: {
            ...(profile == null ? { timezone: timeZone } : {}),
            heightCm: Math.round(typedHeight * 10) / 10,
            sex,
            birthDate,
          },
        }),
      );
      setProfile(saved);
      // An unchanged weight is the weigh-in already there; a new one is weighed now.
      if (weight !== latest?.weight) {
        await forAccount(async () =>
          unwrap(
            await api.POST('/api/weigh-ins', {
              body: {
                id: weighInId,
                measuredAt: new Date().toISOString(),
                weightKg: Math.round(weightKg * 100) / 100,
              },
            }),
          ),
        );
        await refreshWeighIns();
      }
      await regeneratePlan();
      onSaved();
    } catch (error) {
      setProblem(saveProblem(error));
      setBusy(false);
    }
  };

  return (
    <>
      <SaveNotice problem={problem} what="details" />
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
          note={
            latest === undefined
              ? undefined
              : `From your weigh-in of ${dayLabel(`${latest.date}T12:00:00Z`, 'UTC')}`
          }
          value={weight}
          onChange={setWeight}
          decimal
          unit={unit}
          placeholder="0.0"
          error={refused('weightKg')}
        />
        <div className="form__pair">
          <NumberField
            label="Height"
            value={height}
            onChange={setHeight}
            decimal
            unit="cm"
            placeholder="0"
            error={refused('heightCm')}
          />
          <div className="field">
            <FieldLabel htmlFor={birthId} label="Birth date" />
            <input
              id={birthId}
              type="date"
              className="field__input field__input--when"
              value={birthDate}
              max={new Date().toISOString().slice(0, 10)}
              required
              autoComplete="bday"
              aria-invalid={refused('birthDate') === undefined ? undefined : true}
              aria-describedby={refused('birthDate') === undefined ? undefined : `${birthId}-error`}
              onChange={(event) => setBirthDate(event.target.value)}
            />
            {refused('birthDate') !== undefined && (
              <FieldError id={`${birthId}-error`} message={refused('birthDate') ?? ''} />
            )}
          </div>
        </div>
        <fieldset
          className="segments"
          aria-invalid={refused('sex') === undefined ? undefined : true}
          aria-describedby={refused('sex') === undefined ? undefined : `${sexName}-error`}
        >
          <legend className="field__label">Sex, for the formula only</legend>
          {(['male', 'female'] as const).map((each) => (
            <label key={each} className="segments__segment">
              <input
                type="radio"
                name={sexName}
                value={each}
                checked={sex === each}
                onChange={() => setSex(each)}
              />
              {each === 'male' ? 'Male' : 'Female'}
            </label>
          ))}
        </fieldset>
        {refused('sex') !== undefined && (
          <FieldError id={`${sexName}-error`} message={refused('sex') ?? ''} />
        )}
        <button type="submit" className="button button--primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </form>
    </>
  );
}
