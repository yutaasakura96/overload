import type { Batch, Food, Me } from '@overload/api-contract';
import { useQuery } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { api, expectOk, unwrap } from '../api';
import {
  AccountFooter,
  AppBar,
  CheckIcon,
  DataState,
  FieldError,
  FieldLabel,
  Notice,
  NumberField,
  parseFigure,
  ScreenTabs,
} from '../components';
import { newId } from '../ids';
import { goBack, useEntryNote, type Navigate } from '../navigation';
import { daysFrom, grams, longDay, yieldPercent } from '../prep';
import {
  batchesQuery,
  foodsQuery,
  forAccount,
  planToday,
  refreshBatches,
  useAccount,
} from '../query';
import {
  partlySaved,
  refusedOnDevice,
  saveProblem,
  SaveNotice,
  useFocusRefused,
  type SaveProblem,
} from '../saving';
import { deviceTimezone } from '../timezones';
import { FoodSections } from './Prep';

// Batches (S13; docs/10 §5, the M2 prototype's screens 13 and 14): one cook-up of a food, weighed
// raw and cooked. Its yield turns a cooked portion back into raw macros, and the newest batch of a
// food is the one plans made from then on use; past plans keep theirs.

/** A batch is due to be weighed again after this many days (docs/09 F12). */
const WEIGH_AFTER_DAYS = 7;
/** The yields the API takes: a tenth to ten times (docs/07 §4). */
const YIELD = { min: 0.1, max: 10 };

const batchCooked = (foods: Food[] | undefined) =>
  (foods ?? [])
    .filter((food) => food.archivedAt === null && food.keepsDays !== null)
    .toSorted((a, b) => a.name.localeCompare(b.name));

/** One food's batches, newest first, the newest marked as the one in use. */
export function BatchRows({ food, batches }: { food: Food; batches: Batch[] }) {
  return (
    <ul className="batch-list">
      {batches.map((batch, index) => (
        <li key={batch.id} className="batch-list__row">
          <div>
            <span className="batch-list__name">
              {food.name}
              {index === 0 && <span className="batch-list__current">CURRENT</span>}
            </span>
            <span className="batch-list__meta">
              {longDay(batch.cookedOn)} · {grams(batch.rawWeightG)} g raw →{' '}
              {grams(batch.cookedWeightG)} g cooked
            </span>
          </div>
          <span className="batch-list__yield">
            <span className="visually-hidden">Yield </span>
            {yieldPercent(batch.yield)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The flag line over a food's batches: none weighed, or the newest over a week old. */
export function weighLine(batches: Batch[], today: string) {
  const [newest] = batches;
  if (newest === undefined) return 'No batch weighed yet. Cooked amounts are approximate.';
  if (daysFrom(newest.cookedOn, today) > WEIGH_AFTER_DAYS)
    return 'Last weighed over a week ago. Weigh this week’s batch.';
  return undefined;
}

export function Batches({ me, navigate }: { me: Me; navigate: Navigate }) {
  const confirmed = useAccount().status === 'confirmed';
  const foods = useQuery({ ...foodsQuery, enabled: confirmed });
  const batches = useQuery({ ...batchesQuery, enabled: confirmed });
  const note = useEntryNote();
  const today = planToday(me.profile?.timezone ?? deviceTimezone());
  const listed = batchCooked(foods.data);
  const record = () => navigate('/food/batches/new', { returns: true });

  return (
    <main className="foods-screen">
      <AppBar title="Food" subline="BATCHES" slot={<DataState at={batches.dataUpdatedAt} />} />
      <ScreenTabs current="/food" navigate={navigate} />
      <FoodSections current="/food/batches" navigate={navigate} />
      {(foods.isError || batches.isError) && (
        <Notice tone="flag" word="Not updated">
          Couldn’t reach Overload.{' '}
          {batches.data === undefined
            ? 'Try again when you have signal.'
            : 'Showing the last copy.'}
        </Notice>
      )}
      {note === 'batch-saved' && (
        <output className="saved-line">
          <CheckIcon size={13} color="var(--done)" />
          Batch saved. Plans made from now on use its yield.
        </output>
      )}
      <p className="food-lede">
        A batch is one cook-up, weighed raw and cooked. Its yield turns a cooked portion back into
        raw macros. The newest batch of a food is the one in use.
      </p>
      <div className="section-actions section-actions--tight">
        <button type="button" className="button button--primary" onClick={record}>
          Record a batch
        </button>
      </div>
      {foods.data !== undefined && listed.length === 0 && (
        <section className="empty-state" aria-labelledby="no-batch-foods">
          <h2 id="no-batch-foods" className="empty-state__title">
            No batch-cooked foods
          </h2>
          <p className="empty-state__body">
            A food you cook ahead says how many days a cooked batch keeps. Set that on the food,
            under Foods, and its batches are listed here.
          </p>
        </section>
      )}
      {batches.data !== undefined &&
        listed.map((food) => {
          const own = batches.data.filter((batch) => batch.foodId === food.id);
          const flag = weighLine(own, today);
          return (
            <section
              key={food.id}
              className="today__section"
              aria-labelledby={`batches-${food.id}`}
            >
              <h2 id={`batches-${food.id}`} className="section-label">
                {food.name} · keeps {food.keepsDays} days
              </h2>
              {flag !== undefined && (
                <p className="cook__note cook__note--flag batch-flag">{flag}</p>
              )}
              <BatchRows food={food} batches={own} />
            </section>
          );
        })}
      <AccountFooter email={me.user.email} admin={me.isAdmin} navigate={navigate} />
    </main>
  );
}

export function RecordBatch({
  me,
  searchParams,
  navigate,
}: {
  me: Me;
  searchParams: URLSearchParams;
  navigate: Navigate;
}) {
  const confirmed = useAccount().status === 'confirmed';
  const foods = useQuery({ ...foodsQuery, enabled: confirmed });
  const fromPrep = searchParams.get('from') === 'prep';
  const fromFood = searchParams.get('from') === 'food';
  const foodParam = searchParams.get('food') ?? undefined;
  const parent = fromPrep
    ? '/food'
    : fromFood && foodParam !== undefined
      ? `/food/${foodParam}`
      : '/food/batches';
  const back = () => goBack(navigate, parent);
  const listed = batchCooked(foods.data);

  return (
    <main>
      <AppBar
        title="Record a batch"
        subline={fromPrep ? 'FROM THE PREP PLAN' : 'WEIGHED AFTER COOKING'}
        slot={<DataState at={foods.dataUpdatedAt} />}
        back={{ label: 'Back', onClick: back }}
      />
      {foods.isError && foods.data === undefined && (
        <Notice tone="flag" word="Not updated">
          Couldn’t reach Overload. Try again when you have signal.
        </Notice>
      )}
      {foods.data !== undefined && listed.length === 0 && (
        <section className="empty-state" aria-labelledby="no-batch-food">
          <h2 id="no-batch-food" className="empty-state__title">
            No batch-cooked foods
          </h2>
          <p className="empty-state__body">
            Set how many days a cooked batch keeps on a food first, under Foods.
          </p>
          <button type="button" className="button button--secondary" onClick={back}>
            Back
          </button>
        </section>
      )}
      {listed.length > 0 && (
        <BatchForm
          foods={listed}
          initial={{
            foodId: listed.some((food) => food.id === foodParam) ? foodParam : listed[0]?.id,
            raw: searchParams.get('raw') ?? '',
            on: searchParams.get('on') ?? planToday(me.profile?.timezone ?? deviceTimezone()),
          }}
          today={planToday(me.profile?.timezone ?? deviceTimezone())}
          onSaved={() => navigate(parent, { replace: true, note: 'batch-saved' })}
        />
      )}
    </main>
  );
}

function BatchForm({
  foods,
  initial,
  today,
  onSaved,
}: {
  foods: Food[];
  initial: { foodId: string | undefined; raw: string; on: string };
  today: string;
  onSaved: () => void;
}) {
  const [foodId, setFoodId] = useState(initial.foodId ?? '');
  const food = foods.find((each) => each.id === foodId);
  const [on, setOn] = useState(initial.on);
  const [raw, setRaw] = useState(initial.raw);
  const [cooked, setCooked] = useState('');
  const [keeps, setKeeps] = useState(String(food?.keepsDays ?? ''));
  // One id per batch being typed, so a retried save lands once (docs/07 §1.2).
  const [id] = useState(newId);
  const uncertain = useRef<{ id: string; fields: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<SaveProblem>();
  const form = useFocusRefused(problem);
  const foodField = useId();
  const dateField = useId();

  const refused = (path: string) =>
    problem?.kind === 'refused' ? problem.fields.get(path) : undefined;
  const rawG = parseFigure(raw);
  const cookedG = parseFigure(cooked);
  const ratio =
    rawG !== null && cookedG !== null && rawG > 0 && cookedG > 0 ? cookedG / rawG : undefined;

  const chooseFood = (next: string) => {
    setFoodId(next);
    setKeeps(String(foods.find((each) => each.id === next)?.keepsDays ?? ''));
  };

  const save = async () => {
    const keepsDays = parseFigure(keeps);
    const weights: [string, string][] =
      rawG === null || cookedG === null || !(rawG > 0) || !(cookedG > 0)
        ? [['cookedWeightG', 'Both weights must be above 0 g.']]
        : ratio === undefined || ratio < YIELD.min || ratio > YIELD.max
          ? [['cookedWeightG', 'Between a tenth of the raw weight and ten times it.']]
          : [];
    const onDevice = refusedOnDevice([
      ...weights,
      ...(on === '' || on > today
        ? ([['cookedOn', 'A day up to today.']] as [string, string][])
        : []),
      ...(keepsDays === null || !Number.isInteger(keepsDays) || keepsDays < 1 || keepsDays > 30
        ? ([['keepsDays', 'Whole days, 1 to 30.']] as [string, string][])
        : []),
    ]);
    if (onDevice !== undefined || food === undefined || rawG === null || cookedG === null) {
      setProblem(onDevice);
      return;
    }
    const fields = JSON.stringify([foodId, on, raw, cooked]);
    const saveId =
      uncertain.current === null
        ? id
        : uncertain.current.fields === fields
          ? uncertain.current.id
          : newId();
    setBusy(true);
    setProblem(undefined);
    let keptSaved = false;
    let answered = false;
    try {
      if (keepsDays !== food.keepsDays) {
        await forAccount(async () =>
          expectOk(
            await api.PATCH('/api/foods/{id}', {
              params: { path: { id: food.id } },
              body: { keepsDays },
            }),
          ),
        );
        keptSaved = true;
      }
      await forAccount(async () =>
        unwrap(
          await api.POST('/api/batches', {
            body: {
              id: saveId,
              foodId: food.id,
              rawWeightG: Math.round(rawG * 100) / 100,
              cookedWeightG: Math.round(cookedG * 100) / 100,
              cookedOn: on,
            },
          }),
        ),
      );
      answered = true;
      await refreshBatches();
      onSaved();
    } catch (error) {
      if (answered) {
        setProblem({ kind: 'plan_failed' });
        setBusy(false);
        return;
      }
      const next = saveProblem(error);
      if (next.kind === 'unreached') uncertain.current = { id: saveId, fields };
      setProblem(
        keptSaved ? partlySaved(next, `${food.name} now keeps ${keepsDays} days.`, 'batch') : next,
      );
      setBusy(false);
    }
  };

  return (
    <>
      <SaveNotice problem={problem} what="batch" />
      <form
        ref={form}
        className="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void save();
        }}
      >
        <div className="field">
          <FieldLabel htmlFor={foodField} label="Food" />
          <select
            id={foodField}
            className="field__input field__select"
            value={foodId}
            onChange={(event) => chooseFood(event.target.value)}
          >
            {foods.map((each) => (
              <option key={each.id} value={each.id}>
                {each.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <FieldLabel htmlFor={dateField} label="Cooked on" />
          <input
            id={dateField}
            type="date"
            className="field__input field__input--when"
            value={on}
            max={today}
            required
            autoComplete="off"
            aria-invalid={refused('cookedOn') === undefined ? undefined : true}
            aria-describedby={refused('cookedOn') === undefined ? undefined : `${dateField}-error`}
            onChange={(event) => setOn(event.target.value)}
          />
          {refused('cookedOn') !== undefined && (
            <FieldError id={`${dateField}-error`} message={refused('cookedOn') ?? ''} />
          )}
        </div>
        <div className="form__pair">
          <NumberField
            label="Raw weight"
            value={raw}
            onChange={setRaw}
            decimal
            unit="g"
            placeholder="0"
            error={refused('rawWeightG')}
          />
          <NumberField
            label="Cooked weight"
            value={cooked}
            onChange={setCooked}
            decimal
            unit="g"
            placeholder="0"
            error={refused('cookedWeightG')}
          />
        </div>
        <div className="yield-box" aria-live="polite">
          <span className="yield-box__label">Yield</span>
          <span className="yield-box__fig">{ratio === undefined ? '—' : yieldPercent(ratio)}</span>
          <span className="yield-box__text">
            {ratio === undefined
              ? 'Type both weights to see the yield.'
              : `100 g cooked counts as ${grams(100 / ratio)} g raw. Plans made from now on use it; past ones keep theirs.`}
          </span>
        </div>
        <NumberField
          label="Keeps for"
          note="EVERY BATCH OF THIS FOOD"
          value={keeps}
          onChange={setKeeps}
          unit="days"
          error={refused('keepsDays')}
        />
        <p className="food-hint">
          How many days a cooked batch keeps in the fridge. The plan puts it only on days a batch
          covers, and adds a second cook day when one batch can’t cover the week.
        </p>
        <button type="submit" className="button button--primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save batch'}
        </button>
      </form>
    </>
  );
}
