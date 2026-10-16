import type { Basis, Food, FoodState } from '@overload/api-contract';
import { useQuery } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { api, ApiError, unwrap } from '../api';
import {
  AppBar,
  DataState,
  FieldError,
  FieldLabel,
  Notice,
  NumberField,
  parseFigure,
  TextField,
} from '../components';
import {
  BASES,
  basisLabel,
  dropCandidate,
  figure,
  manualCandidate,
  nutrientFigure,
  NUTRIENTS,
  previewPer100g,
  sourceLine,
  useCandidateStore,
  type Candidate,
  type Given,
  type NutrientKey,
} from '../food';
import { newId } from '../ids';
import { goBack, type Navigate } from '../navigation';
import { foodsQuery, forAccount, refreshFoods, rotationGroupsQuery, useAccount } from '../query';
import {
  refusedOnDevice,
  saveProblem,
  SaveNotice,
  useFocusRefused,
  type SaveProblem,
} from '../saving';

// Check before saving (docs/09 F9 step 5; docs/10 §8.6, the prototype's screens 21 and 22): a
// candidate is not a record. After a label or a barcode, `As printed` gives the source's basis and
// values above the per-100 g fields that are saved (Q14); by hand, the packet's basis is chosen and
// the fields hold its numbers, converted below before saving. A value the source did not give is
// empty and says so, never guessed. The same form edits a saved food, per 100 g.

type Fields = Record<NutrientKey, string>;

/** A value as a field holds it: to the hundredth at most, and empty for none. */
const fieldText = (value: number | null) =>
  value === null ? '' : String(Math.round(value * 100) / 100);

const fieldsOf = (values: Given | null): Fields => ({
  energyKcal: fieldText(values?.energyKcal ?? null),
  proteinG: fieldText(values?.proteinG ?? null),
  carbG: fieldText(values?.carbG ?? null),
  fatG: fieldText(values?.fatG ?? null),
  fiberG: fieldText(values?.fiberG ?? null),
});

const MISSING_NOTES: Partial<Record<Candidate['source'], string>> = {
  label_photo: 'NOT ON THE LABEL: LEFT EMPTY',
  open_food_facts: 'NOT IN OPEN FOOD FACTS: LEFT EMPTY',
};

const PRINTED_NONE: Partial<Record<Candidate['source'], string>> = {
  label_photo: 'not printed',
  open_food_facts: 'not given',
};

const REFUSALS = {
  value: 'Enter a figure of 0 or more',
  impossible: 'More than 100 g of food can hold',
  grams: 'Give the weight of the piece, serving or package',
  piece: 'Grams above 0, or leave it empty',
  keeps: 'Whole days from 1 to 30, or leave it empty',
  name: 'Enter a name, up to 80 characters',
  group: 'No longer one of your rotation groups',
} as const;

/** The upper bounds the API holds a food to, per 100 g (docs/07 §4). */
const PER_100G_MAX: Record<NutrientKey, number> = {
  energyKcal: 900,
  proteinG: 100,
  carbG: 100,
  fatG: 100,
  fiberG: 100,
};

export function FoodCheck({ navigate }: { navigate: Navigate }) {
  // Opened without a candidate (a reload, a shared link): the form by hand, which needs none.
  const [candidate] = useState(() => useCandidateStore.getState().candidate ?? manualCandidate());
  const back = () => {
    dropCandidate();
    goBack(navigate, '/food/new');
  };
  return (
    <main>
      <AppBar
        title="Check before saving"
        subline={candidate.sourceLine}
        slot={<DataState at={0} />}
        back={{ label: 'Back, discarding it', onClick: back }}
      />
      <FoodForm
        mode={{ kind: 'add', candidate }}
        navigate={navigate}
        onDiscard={back}
        onSaved={() => {
          dropCandidate();
          navigate('/food', { replace: true, note: 'food-saved' });
        }}
      />
    </main>
  );
}

export function FoodEdit({ id, navigate }: { id: string; navigate: Navigate }) {
  const confirmed = useAccount().status === 'confirmed';
  const foods = useQuery({ ...foodsQuery, enabled: confirmed });
  const food = foods.data?.find((each) => each.id === id && each.archivedAt === null);
  const back = () => goBack(navigate, `/food/${id}`);
  return (
    <main>
      <AppBar
        title={food === undefined ? 'Edit food' : `Edit ${food.name}`}
        subline={food === undefined ? undefined : sourceLine(food)}
        slot={<DataState at={foods.dataUpdatedAt} />}
        back={{ label: 'Back to the food', onClick: back }}
      />
      {foods.isError && foods.data === undefined && (
        <Notice tone="flag" word="Not updated">
          Couldn’t reach Overload. Try again when you have signal.
        </Notice>
      )}
      {foods.data !== undefined && food === undefined && (
        <p className="foods__none">This food is not on your list.</p>
      )}
      {food !== undefined && (
        <FoodForm
          mode={{ kind: 'edit', food }}
          navigate={navigate}
          onDiscard={back}
          onSaved={() => navigate(`/food/${id}`, { replace: true })}
        />
      )}
    </main>
  );
}

type Mode = { kind: 'add'; candidate: Candidate } | { kind: 'edit'; food: Food };

/** To the hundredth, as the API keeps it. */
const round = (value: number | null) => (value === null ? null : Math.round(value * 100) / 100);

function FoodForm({
  mode,
  navigate,
  onDiscard,
  onSaved,
}: {
  mode: Mode;
  navigate: Navigate;
  onDiscard: () => void;
  onSaved: () => void;
}) {
  const confirmed = useAccount().status === 'confirmed';
  const groups = useQuery({ ...rotationGroupsQuery, enabled: confirmed });
  const candidate = mode.kind === 'add' ? mode.candidate : undefined;
  const food = mode.kind === 'edit' ? mode.food : undefined;
  const manual = candidate?.source === 'manual';

  const [name, setName] = useState(food?.name ?? candidate?.name ?? '');
  const [brand, setBrand] = useState(food?.brand ?? candidate?.brand ?? '');
  const [basisKind, setBasisKind] = useState<Basis['kind']>('per_100g');
  const [basisGrams, setBasisGrams] = useState('');
  const [fields, setFields] = useState<Fields>(() => fieldsOf(food ?? candidate?.per100g ?? null));
  const [state, setState] = useState<FoodState>(food?.state ?? candidate?.state ?? 'raw');
  const [piece, setPiece] = useState(fieldText(food?.pieceWeightG ?? null));
  const [keeps, setKeeps] = useState(
    food?.keepsDays === null || food === undefined ? '' : String(food.keepsDays),
  );
  const [groupId, setGroupId] = useState(food?.rotationGroupId ?? '');
  // One id per food being added, so a retried save lands once (docs/07 §1.2).
  const [id] = useState(newId);
  const uncertain = useRef<{ id: string; fields: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<SaveProblem>();
  const [existing, setExisting] = useState(candidate?.existingFoodId ?? null);
  const form = useFocusRefused(problem);
  const stateName = useId();
  const basisName = useId();
  const groupFieldId = useId();

  const refused = (path: string) =>
    problem?.kind === 'refused' ? problem.fields.get(path) : undefined;
  const printedBasis = manual && basisKind !== 'per_100g';
  const basis: Basis = manual
    ? { kind: basisKind, grams: basisKind === 'per_100g' ? null : parseFigure(basisGrams) }
    : { kind: 'per_100g', grams: null };
  const typed: Given = {
    energyKcal: parseFigure(fields.energyKcal),
    proteinG: parseFigure(fields.proteinG),
    carbG: parseFigure(fields.carbG),
    fatG: parseFigure(fields.fatG),
    fiberG: parseFigure(fields.fiberG),
  };
  const preview = printedBasis ? previewPer100g(typed, basis) : null;

  const save = async () => {
    const onDevice: [string, string][] = [];
    if (name.trim() === '' || name.trim().length > 80) onDevice.push(['name', REFUSALS.name]);
    for (const { key } of NUTRIENTS) {
      const value = typed[key];
      const optional = key === 'fiberG' && value === null;
      if (!optional && (value === null || !Number.isFinite(value) || value < 0)) {
        onDevice.push([key, REFUSALS.value]);
      }
    }
    const grams = parseFigure(basisGrams);
    if (printedBasis && (grams === null || !Number.isFinite(grams) || grams <= 0)) {
      onDevice.push(['basis.grams', REFUSALS.grams]);
    }
    const scaled = printedBasis ? previewPer100g(typed, basis) : typed;
    for (const { key } of NUTRIENTS) {
      const value = scaled?.[key];
      if (value !== null && value !== undefined && value > PER_100G_MAX[key]) {
        if (!onDevice.some(([path]) => path === key)) onDevice.push([key, REFUSALS.impossible]);
      }
    }
    const pieceWeight = parseFigure(piece);
    if (pieceWeight !== null && (!Number.isFinite(pieceWeight) || pieceWeight <= 0)) {
      onDevice.push(['pieceWeightG', REFUSALS.piece]);
    }
    const keepsDays = parseFigure(keeps);
    if (keepsDays !== null && (!Number.isInteger(keepsDays) || keepsDays < 1 || keepsDays > 30)) {
      onDevice.push(['keepsDays', REFUSALS.keeps]);
    }
    const refusal = refusedOnDevice(onDevice);
    if (refusal !== undefined) {
      setProblem(refusal);
      return;
    }
    const values = {
      energyKcal: round(typed.energyKcal) ?? 0,
      proteinG: round(typed.proteinG) ?? 0,
      carbG: round(typed.carbG) ?? 0,
      fatG: round(typed.fatG) ?? 0,
    };
    const shared = {
      name: name.trim(),
      brand: brand.trim() === '' ? null : brand.trim(),
      state,
      pieceWeightG: round(pieceWeight),
      keepsDays,
      rotationGroupId: groupId === '' ? null : groupId,
    };
    setBusy(true);
    setProblem(undefined);
    let answered = false;
    const sent = JSON.stringify([shared, values, typed.fiberG, basis]);
    const saveId =
      uncertain.current === null
        ? id
        : uncertain.current.fields === sent
          ? uncertain.current.id
          : newId();
    try {
      if (mode.kind === 'add') {
        await forAccount(async () =>
          unwrap(
            await api.POST('/api/foods', {
              body: {
                id: saveId,
                ...shared,
                ...values,
                fiberG: round(typed.fiberG),
                basis,
                source: mode.candidate.source,
                sourceRef: mode.candidate.sourceRef,
              },
            }),
          ),
        );
      } else {
        await forAccount(async () =>
          unwrap(
            await api.PATCH('/api/foods/{id}', {
              params: { path: { id: mode.food.id } },
              body: { ...shared, ...values, fiberG: round(typed.fiberG) ?? 0 },
            }),
          ),
        );
      }
      answered = true;
      await refreshFoods();
      onSaved();
    } catch (error) {
      const next = saveProblem(error);
      if (!answered && next.kind === 'unreached' && mode.kind === 'add') {
        uncertain.current = { id: saveId, fields: sent };
      }
      if (next.kind === 'refused' && next.code === 'food_exists') {
        setExisting(error instanceof ApiError ? (error.problem?.existingFoodId ?? null) : null);
      }
      for (const { key } of NUTRIENTS) {
        if (next.kind === 'refused' && next.fields.has(key)) {
          next.fields.set(key, REFUSALS.impossible);
        }
      }
      if (next.kind === 'refused' && next.fields.has('rotationGroupId')) {
        next.fields.set('rotationGroupId', REFUSALS.group);
      }
      setProblem(next);
      setBusy(false);
    }
  };

  const missingNote = (key: NutrientKey) => {
    if (candidate === undefined || candidate.per100g === null) return undefined;
    return candidate.per100g[key] === null ? MISSING_NOTES[candidate.source] : undefined;
  };
  const openExisting = (foodId: string) => navigate(`/food/${foodId}`);

  return (
    <>
      {existing !== null && (
        <Notice tone="flag" word="Already on your list">
          {problem?.kind === 'refused' && problem.code === 'food_exists'
            ? 'Nothing was saved: it is on your list already.'
            : food === undefined
              ? 'This food is saved already.'
              : 'Another food has this name.'}{' '}
          <a
            href={`/food/${existing}`}
            onClick={(event) => {
              event.preventDefault();
              openExisting(existing);
            }}
          >
            Open it
          </a>
        </Notice>
      )}
      {!(problem?.kind === 'refused' && problem.code === 'food_exists') && (
        <SaveNotice problem={problem} what="food" />
      )}
      <p className="food-lede">
        {mode.kind === 'edit'
          ? 'Values per 100 g. Plans made before keep the values they used.'
          : manual
            ? 'Type what the packet says. It is saved per 100 g.'
            : 'Nothing is saved until you press Save. Fix anything that was read wrong.'}
      </p>
      {candidate?.printed !== null && candidate?.printed !== undefined && (
        <section className="printed" aria-labelledby="as-printed">
          <div className="printed__head">
            <h2 id="as-printed" className="section-label">
              As printed
            </h2>
            <span className="printed__basis">{basisLabel(candidate.printed.basis)}</span>
          </div>
          <dl className="printed__grid">
            {NUTRIENTS.map((nutrient) => {
              const value = candidate.printed?.values[nutrient.key] ?? null;
              return (
                <div key={nutrient.key}>
                  <dt>{nutrient.printed}</dt>
                  <dd>
                    {value === null ? (
                      <span className="printed__none">{PRINTED_NONE[candidate.source]}</span>
                    ) : (
                      <>
                        {figure(value)}
                        <span className="values__unit"> {nutrient.unit}</span>
                      </>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
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
        <TextField
          label="Name"
          value={name}
          onChange={setName}
          placeholder="What you call it"
          error={refused('name')}
          focusOnOpen={manual}
        />
        <TextField
          label="Brand"
          note="OPTIONAL"
          value={brand}
          onChange={setBrand}
          placeholder="Optional"
          error={refused('brand')}
        />
        {manual && (
          <>
            <fieldset className="segments segments--four">
              <legend className="field__label">The packet gives values</legend>
              {BASES.map(({ kind, label }) => (
                <label key={kind} className="segments__segment">
                  <input
                    type="radio"
                    name={basisName}
                    value={kind}
                    checked={basisKind === kind}
                    onChange={() => setBasisKind(kind)}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
            {basisKind !== 'per_100g' && (
              <NumberField
                label="That amount weighs"
                value={basisGrams}
                onChange={setBasisGrams}
                decimal
                unit="g"
                placeholder="0"
                error={refused('basis.grams')}
              />
            )}
          </>
        )}
        <div className="food-subhead">
          <h2 className="section-label">
            {printedBasis ? 'As printed' : 'Per 100 g, as it will be saved'}
          </h2>
          {candidate?.printed !== null &&
            candidate?.printed !== undefined &&
            candidate.printed.basis.kind !== 'per_100g' && (
              <span className="food-subhead__note">
                converted from the {candidate.source === 'label_photo' ? 'label' : 'record'}
              </span>
            )}
        </div>
        <div className="form__pair">
          {NUTRIENTS.slice(0, 2).map((nutrient) => (
            <NumberField
              key={nutrient.key}
              label={nutrient.label}
              value={fields[nutrient.key]}
              onChange={(value) => setFields((current) => ({ ...current, [nutrient.key]: value }))}
              decimal
              unit={nutrient.unit}
              note={missingNote(nutrient.key)}
              placeholder={missingNote(nutrient.key) === undefined ? '0' : '—'}
              error={refused(nutrient.key)}
            />
          ))}
        </div>
        <div className="form__pair">
          {NUTRIENTS.slice(2, 4).map((nutrient) => (
            <NumberField
              key={nutrient.key}
              label={nutrient.label}
              value={fields[nutrient.key]}
              onChange={(value) => setFields((current) => ({ ...current, [nutrient.key]: value }))}
              decimal
              unit={nutrient.unit}
              note={missingNote(nutrient.key)}
              placeholder={missingNote(nutrient.key) === undefined ? '0' : '—'}
              error={refused(nutrient.key)}
            />
          ))}
        </div>
        <NumberField
          label="Fiber"
          value={fields.fiberG}
          onChange={(value) => setFields((current) => ({ ...current, fiberG: value }))}
          decimal
          unit="g"
          note={missingNote('fiberG') ?? 'EMPTY: SAVED AS 0'}
          placeholder="—"
          error={refused('fiberG')}
        />
        {printedBasis && (
          <section className="printed printed--inline" aria-labelledby="as-saved">
            <div className="printed__head">
              <h2 id="as-saved" className="section-label">
                Per 100 g, as it will be saved
              </h2>
            </div>
            <dl className="printed__grid">
              {NUTRIENTS.map((nutrient) => {
                const value = preview?.[nutrient.key] ?? null;
                return (
                  <div key={nutrient.key}>
                    <dt>{nutrient.label}</dt>
                    <dd>
                      {value === null || !Number.isFinite(value)
                        ? '—'
                        : nutrientFigure(nutrient.key, value)}
                      <span className="values__unit"> {nutrient.unit}</span>
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>
        )}
        <fieldset className="segments">
          <legend className="field__label">This food is</legend>
          {(['raw', 'cooked'] as const).map((value) => (
            <label key={value} className="segments__segment">
              <input
                type="radio"
                name={stateName}
                value={value}
                checked={state === value}
                onChange={() => setState(value)}
              />
              {value === 'raw' ? 'Raw' : 'Cooked'}
            </label>
          ))}
        </fieldset>
        <NumberField
          label="One piece weighs"
          note="EMPTY: COUNTED IN GRAMS"
          value={piece}
          onChange={setPiece}
          decimal
          unit="g"
          placeholder="—"
          error={refused('pieceWeightG')}
        />
        <NumberField
          label="A cooked batch keeps for"
          note="EMPTY: NOT BATCH-COOKED"
          value={keeps}
          onChange={setKeeps}
          unit="days"
          placeholder="—"
          error={refused('keepsDays')}
        />
        <div className="field">
          <FieldLabel htmlFor={groupFieldId} label="Rotation group" note="OPTIONAL" />
          <select
            id={groupFieldId}
            className="field__input field__select"
            value={groupId}
            aria-invalid={refused('rotationGroupId') === undefined ? undefined : true}
            onChange={(event) => setGroupId(event.target.value)}
          >
            <option value="">None</option>
            {(groups.data ?? []).map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
          {refused('rotationGroupId') !== undefined && (
            <FieldError message={refused('rotationGroupId') ?? ''} />
          )}
        </div>
        <div className="section-actions section-actions--flush">
          <button type="submit" className="button button--primary" disabled={busy}>
            {busy ? 'Saving…' : mode.kind === 'add' ? 'Save to my foods' : 'Save changes'}
          </button>
          <button
            type="button"
            className="button button--tertiary"
            disabled={busy}
            onClick={onDiscard}
          >
            Discard
          </button>
        </div>
      </form>
    </>
  );
}
