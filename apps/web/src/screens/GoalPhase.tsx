import type {
  GoalPhase,
  GoalPhaseType,
  Me,
  PhaseDefaults,
  WeightUnit,
} from '@overload/api-contract';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { api, ApiError, unwrap } from '../api';
import { AppBar, DataState, Notice, NumberField, parseFigure } from '../components';
import { EVIDENCE, EvidenceTag } from '../evidence';
import { newId } from '../ids';
import { goBack, type Navigate } from '../navigation';
import { phaseLine } from '../plan';
import {
  forAccount,
  goalPhasesQuery,
  phaseDefaultsQuery,
  planToday,
  queryClient,
  regeneratePlan,
  useAccount,
} from '../query';
import {
  refusedOnDevice,
  saveProblem,
  SaveNotice,
  useFocusRefused,
  type SaveProblem,
} from '../saving';
import { deviceTimezone } from '../timezones';
import { fromKg } from '../units';

// Goal phase and targets (S14, docs/10 §8.6): cut, maintain or bulk, and the targets that follow,
// each default with its source and what it means in plain figures. The calories are a formula's
// estimate, labelled provisional, until the maintenance check is applied. Every figure is the API's
// (docs/07 §4); this screen multiplies them out for the lines under the fields only.

const TYPES: { type: GoalPhaseType; label: string }[] = [
  { type: 'cut', label: 'Cut' },
  { type: 'maintain', label: 'Maintain' },
  { type: 'bulk', label: 'Bulk' },
];
const LIMITS = {
  rate: { min: 0.05, max: 2, message: 'A rate between 0.05 and 2% a week.' },
  protein: { min: 1, max: 4, message: 'Between 1 and 4 g per kg.' },
  fat: { min: 10, max: 60, message: 'Between 10 and 60% of calories.' },
  kcal: { min: 1000, max: 6000, message: 'Between 1,000 and 6,000 kcal, in whole kcal.' },
};

const outside = (figure: number | null, limit: { min: number; max: number }) =>
  figure === null || !Number.isFinite(figure) || figure < limit.min || figure > limit.max;

const kcal = (value: number) => Math.round(value).toLocaleString('en-US');
const typeWord = (type: GoalPhaseType) =>
  type === 'cut' ? 'cut' : type === 'bulk' ? 'bulk' : 'maintenance phase';

export function GoalPhaseScreen({ me, navigate }: { me: Me; navigate: Navigate }) {
  const confirmed = useAccount().status === 'confirmed';
  const phases = useQuery({ ...goalPhasesQuery, enabled: confirmed });
  const open = phases.data?.find((phase) => phase.endedOn === null);
  const timeZone = me.profile?.timezone ?? deviceTimezone();
  const today = planToday(timeZone);
  const back = () => goBack(navigate, '/');

  return (
    <main>
      <AppBar
        title="Goal phase"
        subline={open === undefined ? 'STEP 3 OF 4' : phaseLine(open, today).toUpperCase()}
        slot={<DataState at={phases.dataUpdatedAt} />}
        back={{ label: 'Back', onClick: back }}
      />
      {phases.isError && phases.data === undefined && (
        <Notice tone="flag" word="Not updated">
          Couldn’t reach Overload. Try again when you have signal.
        </Notice>
      )}
      {open?.calorieTargetStale === true && (
        <Notice tone="flag" word="Not updated">
          Calories weren’t updated for your new training days. Log a weigh-in to recalculate.
        </Notice>
      )}
      {phases.data !== undefined && (
        <PhaseForm
          key={open?.id ?? 'new'}
          open={open}
          today={today}
          unit={me.profile?.weightUnit ?? 'kg'}
          navigate={navigate}
          onSaved={() => navigate('/', { replace: true, note: 'plan-saved' })}
        />
      )}
    </main>
  );
}

function PhaseForm({
  open,
  today,
  unit,
  navigate,
  onSaved,
}: {
  open: GoalPhase | undefined;
  today: string;
  unit: WeightUnit;
  navigate: Navigate;
  onSaved: () => void;
}) {
  const confirmed = useAccount().status === 'confirmed';
  const [type, setType] = useState<GoalPhaseType>(open?.type ?? 'cut');
  // Each field holds what was typed; empty means the default for the type, shown as placeholder.
  const sameType = open !== undefined && open.type === type;
  const [typed, setTyped] = useState<Record<GoalPhaseType, Fields>>(() => ({
    cut: fieldsOf(open?.type === 'cut' ? open : undefined),
    maintain: fieldsOf(open?.type === 'maintain' ? open : undefined),
    bulk: fieldsOf(open?.type === 'bulk' ? open : undefined),
  }));
  const [caloriesEdited, setCaloriesEdited] = useState(false);
  const fields = typed[type];
  const setField = (key: keyof Fields, value: string) =>
    setTyped((all) => ({ ...all, [type]: { ...all[type], [key]: value } }));
  const rateTyped = parseFigure(fields.rate);
  const rateForCalories =
    type === 'maintain' ||
    rateTyped === null ||
    !Number.isFinite(rateTyped) ||
    rateTyped < 0.05 ||
    rateTyped > 2
      ? undefined
      : rateTyped;
  const defaults = useQuery({
    ...phaseDefaultsQuery(type, rateForCalories),
    enabled: confirmed,
    placeholderData: (previous) => (previous?.type === type ? previous : undefined),
    retry: (count, error) => !(error instanceof ApiError && error.status === 422) && count < 2,
  });
  const [id] = useState(newId);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<SaveProblem>();
  const form = useFocusRefused(problem);
  const typeName = useId();
  const refused = (path: string) =>
    problem?.kind === 'refused' ? problem.fields.get(path) : undefined;

  // The phase choice stays put while a type's defaults load, so the radio in focus keeps it.
  const segments = (
    <fieldset className="segments segments--three segments--top">
      <legend className="visually-hidden">Phase</legend>
      {TYPES.map((each) => (
        <label key={each.type} className="segments__segment">
          <input
            type="radio"
            name={typeName}
            checked={type === each.type}
            onChange={() => {
              setType(each.type);
              setProblem(undefined);
            }}
          />
          {each.label}
        </label>
      ))}
    </fieldset>
  );

  if (defaults.error instanceof ApiError && defaults.error.code === 'setup_incomplete') {
    return (
      <Notice tone="flag" word="Set up first">
        The defaults are worked out from your height, weight, age and sex.{' '}
        <a
          href="/plan/about"
          onClick={(event) => {
            event.preventDefault();
            navigate('/plan/about', { returns: true });
          }}
        >
          Add your details
        </a>{' '}
        first.
      </Notice>
    );
  }
  const d = defaults.data;
  if (d === undefined) {
    return (
      <>
        {segments}
        {defaults.isError && (
          <Notice tone="flag" word="Not updated">
            Couldn’t reach Overload. Try again when you have signal.
          </Notice>
        )}
      </>
    );
  }

  // What each field stands at: the typed figure, else the phase's own, else the default.
  const value = (key: keyof Fields, fallback: number | null) => {
    const figure = parseFigure(fields[key]);
    return figure === null ? fallback : figure;
  };
  const rate = type === 'maintain' ? null : value('rate', d.targetRatePctPerWeek?.value ?? null);
  const protein = value('protein', d.proteinGPerKg.value) ?? d.proteinGPerKg.value;
  const fat = value('fat', d.fatPctCalories.value) ?? d.fatPctCalories.value;
  // Calories typed are yours. An open phase's measured or own figure stays until the field is
  // changed; an empty field follows the formula, whose figure the API works out again as it saves.
  const kcalTyped = parseFigure(fields.kcal);
  const yours = kcalTyped !== null && (!sameType || caloriesEdited);
  const ownKept = sameType && open.calorieBasis !== 'provisional_formula' && !caloriesEdited;
  const calories = yours ? kcalTyped : ownKept ? open.calorieTargetKcal : d.calories.value;
  const basis = yours ? 'manual' : ownKept ? open.calorieBasis : 'provisional_formula';
  const provisional = basis === 'provisional_formula';
  const weightKg = d.bodyweight.weightKg;
  const proteinG = Math.round(protein * weightKg);
  // Protein stays per kg, as the sources give it; a weight is said in the user's unit.
  const weight = (kg: number) => `${fromKg(kg, unit).toFixed(1)} ${unit}`;
  const fatG = Math.round((calories * fat) / 100 / 9);
  const carbG = Math.max(0, Math.round((calories - proteinG * 4 - fatG * 9) / 4));
  const changingType = open !== undefined && open.type !== type;
  // The defaults for the rate before the latest edit, shown while the new rate's load: never saved.
  const stale = defaults.isPlaceholderData;

  const save = async () => {
    if (stale) return;
    const onDevice = refusedOnDevice([
      ...(type !== 'maintain' && outside(rate, LIMITS.rate)
        ? ([['targetRatePctPerWeek', LIMITS.rate.message]] as [string, string][])
        : []),
      ...(outside(protein, LIMITS.protein)
        ? ([['proteinGPerKg', LIMITS.protein.message]] as [string, string][])
        : []),
      ...(outside(fat, LIMITS.fat)
        ? ([['fatPctCalories', LIMITS.fat.message]] as [string, string][])
        : []),
      ...(outside(calories, LIMITS.kcal) || !Number.isInteger(calories)
        ? ([['calorieTargetKcal', LIMITS.kcal.message]] as [string, string][])
        : []),
    ]);
    if (onDevice !== undefined) {
      setProblem(onDevice);
      return;
    }
    const targets = {
      targetRatePctPerWeek: rate === null ? null : Math.round(rate * 100) / 100,
      proteinGPerKg: Math.round(protein * 100) / 100,
      fatPctCalories: Math.round(fat * 10) / 10,
    };
    setBusy(true);
    setProblem(undefined);
    try {
      await forAccount(async () => {
        if (sameType) {
          // A measured or own target is sent only when it changed, so it keeps its basis.
          const sendCalories =
            provisional || calories !== open.calorieTargetKcal || basis !== open.calorieBasis;
          return unwrap(
            await api.PATCH('/api/goal-phases/{id}', {
              params: { path: { id: open.id } },
              body: {
                ...targets,
                ...(sendCalories
                  ? {
                      calorieTargetKcal: calories,
                      calorieBasis: provisional ? 'provisional_formula' : 'manual',
                    }
                  : {}),
              },
            }),
          );
        }
        return unwrap(
          await api.POST('/api/goal-phases', {
            body: {
              id,
              type,
              startedOn: today,
              ...targets,
              calorieTargetKcal: calories,
              calorieBasis: provisional ? 'provisional_formula' : 'manual',
              endPrevious: open !== undefined,
            },
          }),
        );
      });
      await queryClient.invalidateQueries({ queryKey: ['plan'] });
      try {
        await regeneratePlan();
        onSaved();
      } catch {
        setProblem({ kind: 'plan_failed' });
        setBusy(false);
      }
    } catch (error) {
      setProblem(saveProblem(error));
      setBusy(false);
    }
  };

  return (
    <>
      {segments}
      {changingType && (
        <Notice tone="flag" word={`A ${typeWord(open.type)} is open`}>
          {open.startedOn === today
            ? 'This phase began today. A new phase can start tomorrow.'
            : `Saving ends the ${typeWord(open.type)} yesterday and starts a ${typeWord(type)} from today. The ${typeWord(open.type)} is kept, with what it did.`}
        </Notice>
      )}
      {problem?.kind === 'refused' && problem.fields.has('startedOn') ? (
        <Notice tone="error" word="Refused">
          This goal phase must start after the open phase began.
        </Notice>
      ) : (
        <SaveNotice problem={problem} what="targets" />
      )}
      <form
        ref={form}
        className="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void save();
        }}
      >
        {type !== 'maintain' && d.targetRatePctPerWeek !== null && (
          <>
            <NumberField
              label={`Target rate, ${type === 'cut' ? 'loss' : 'gain'} a week`}
              note={rate === d.targetRatePctPerWeek.value ? 'Default' : 'Yours'}
              value={fields.rate}
              onChange={(next) => setField('rate', next)}
              decimal
              unit="% bodyweight"
              placeholder={String(
                sameType
                  ? (open?.targetRatePctPerWeek ?? d.targetRatePctPerWeek.value)
                  : d.targetRatePctPerWeek.value,
              )}
              error={refused('targetRatePctPerWeek')}
            />
            {rate !== null && Number.isFinite(rate) && (
              <p className="m2-derived">
                That is about <b>{weight((rate / 100) * weightKg)} a week</b> at {weight(weightKg)}.
              </p>
            )}
            <div className="m2-source-line">
              Default {d.targetRatePctPerWeek.value}%, the slow end of{' '}
              {d.targetRatePctPerWeek.range[0]}–{d.targetRatePctPerWeek.range[1]}% a week.{' '}
              <EvidenceTag evidence={EVIDENCE[d.targetRatePctPerWeek.sourceKey]} />
            </div>
          </>
        )}
        <NumberField
          label="Protein"
          note={protein === d.proteinGPerKg.value ? 'Default' : 'Yours'}
          value={fields.protein}
          onChange={(next) => setField('protein', next)}
          decimal
          unit="g per kg"
          placeholder={String(
            sameType ? (open?.proteinGPerKg ?? d.proteinGPerKg.value) : d.proteinGPerKg.value,
          )}
          error={refused('proteinGPerKg')}
        />
        <p className="m2-derived">
          <b>{proteinG} g a day</b> at {weight(weightKg)}.
          {type === 'cut' &&
            ' A cut starts at the top of the range, because needs rise in a deficit. You can go higher.'}
        </p>
        <div className="m2-source-line">
          Range {d.proteinGPerKg.range[0]}–{d.proteinGPerKg.range[1]} g per kg.{' '}
          <EvidenceTag evidence={EVIDENCE[d.proteinGPerKg.sourceKey]} />
        </div>
        <NumberField
          label="Fat"
          note={fat === d.fatPctCalories.value ? 'Default' : 'Yours'}
          value={fields.fat}
          onChange={(next) => setField('fat', next)}
          decimal
          unit="% of calories"
          placeholder={String(
            sameType ? (open?.fatPctCalories ?? d.fatPctCalories.value) : d.fatPctCalories.value,
          )}
          error={refused('fatPctCalories')}
        />
        <p className="m2-derived">
          <b>{fatG} g a day.</b> Carbohydrate is what remains: <b>{carbG} g</b>.
        </p>
        <div className="m2-source-line">
          Default {d.fatPctCalories.value}%, inside {d.fatPctCalories.range[0]}–
          {d.fatPctCalories.range[1]}% of calories.{' '}
          <EvidenceTag evidence={EVIDENCE[d.fatPctCalories.sourceKey]} />
        </div>
        <NumberField
          label="Calories"
          note={provisional ? 'Provisional' : basis === 'measured' ? 'Measured' : 'Yours'}
          value={
            sameType && open.calorieBasis === 'provisional_formula' && !caloriesEdited
              ? ''
              : fields.kcal
          }
          onChange={(next) => {
            if (sameType) setCaloriesEdited(true);
            setField('kcal', next);
          }}
          unit="kcal a day"
          placeholder={String(d.calories.value)}
          error={refused('calorieTargetKcal')}
        />
        <Provisional defaults={d} type={type} basis={basis} />
        <button
          type="submit"
          className="button button--primary"
          disabled={busy}
          aria-disabled={stale || undefined}
        >
          {busy
            ? 'Saving…'
            : changingType
              ? `End the ${typeWord(open.type)} and start a ${typeWord(type)}`
              : 'Save targets'}
        </button>
      </form>
    </>
  );
}

/** The provisional box: what the calories are, until the maintenance check replaces them. */
function Provisional({
  defaults,
  type,
  basis,
}: {
  defaults: PhaseDefaults;
  type: GoalPhaseType;
  basis: GoalPhase['calorieBasis'];
}) {
  const { calories } = defaults;
  if (basis !== 'provisional_formula') {
    return (
      <p className="m2-derived">
        {basis === 'measured' ? 'Set from your maintenance check.' : 'Your own figure.'} The formula
        gives {kcal(calories.value)} kcal.
      </p>
    );
  }
  const adjustment =
    type === 'cut'
      ? `less ${kcal(-calories.adjustmentKcal)} kcal for your rate`
      : type === 'bulk'
        ? `plus ${kcal(calories.adjustmentKcal)} kcal for your rate`
        : 'with nothing added or taken off';
  return (
    <div className="provisional">
      <span className="provisional__word">Provisional</span>
      <p>
        A formula’s estimate from your height, weight, age and sex: resting energy of{' '}
        {kcal(calories.restingKcal)} kcal, times {calories.activityLevel.toFixed(2)} for{' '}
        {calories.trainingDaysPerWeek} training{' '}
        {calories.trainingDaysPerWeek === 1 ? 'day' : 'days'} a week, {adjustment}. It is replaced
        when you apply the maintenance check, after 14 complete days.
      </p>
      <span className="provisional__src">
        <EvidenceTag evidence={EVIDENCE[calories.sourceKey]} />
      </span>
    </div>
  );
}

type Fields = { rate: string; protein: string; fat: string; kcal: string };

/** The fields start empty for a new phase, showing the defaults; an open phase's own figures fill them. */
function fieldsOf(phase: GoalPhase | undefined): Fields {
  if (phase === undefined) return { rate: '', protein: '', fat: '', kcal: '' };
  return {
    rate: phase.targetRatePctPerWeek === null ? '' : String(phase.targetRatePctPerWeek),
    protein: String(phase.proteinGPerKg),
    fat: String(phase.fatPctCalories),
    kcal: String(phase.calorieTargetKcal),
  };
}
