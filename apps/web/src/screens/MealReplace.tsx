import type { Food, Me, PlanMeal, PlanMealConfirmItem } from '@overload/api-contract';
import { useQuery } from '@tanstack/react-query';
import { useId, useRef, useState, type FormEvent } from 'react';
import {
  AppBar,
  CheckIcon,
  DataState,
  Notice,
  NumberField,
  parseFigure,
  TextField,
} from '../components';
import {
  confirmMeal,
  dateLabel,
  dayLocked,
  flashNext,
  useMealOnDay,
  useOnline,
} from '../confirming';
import { newId } from '../ids';
import { goBack, type Navigate } from '../navigation';
import {
  ConfirmNotice,
  confirmProblem,
  mealName,
  OfflineLine,
  type ConfirmProblem,
} from '../plan-day';
import { activePlanDay, dayRoutinesQuery, foodsQuery, useAccount } from '../query';
import { deviceTimezone } from '../timezones';

// Replaced (docs/10 §3, Actions; docs/09 F11): what was eaten instead, from the food list or typed
// by hand. Saving confirms the meal `replaced`, in place of any earlier confirmation; the planned
// foods stay on the meal at 0 g, so the plan stays readable. Photo and text estimates are M3 (F15).

const PICK_GRAMS = 100;
const SHOWN = 8;

/** What the API holds per 100 g (docs/07 §4, foods): a portion typed by hand is spread to fit. */
const PER_100G_MAX = { energyKcal: 900, proteinG: 100, carbG: 100, fatG: 100 };

type Picked = { id: string; food: Food; grams: number };
type Typed = { name: string; energyKcal: string; proteinG: string; carbG: string; fatG: string };

const hundredths = (value: number) => Math.round(value * 100) / 100;
const typedFigure = (text: string) => parseFigure(text) ?? 0;
const TYPED_KEYS = ['energyKcal', 'proteinG', 'carbG', 'fatG'] as const;

/**
 * A portion typed by hand as an item: its totals, as the weight that keeps each value per 100 g
 * inside what the API holds. The weight is never shown; a typed item reads as its calories.
 */
export function typedItem(name: string, totals: Omit<Typed, 'name'>): PlanMealConfirmItem {
  const figures = {
    energyKcal: typedFigure(totals.energyKcal),
    proteinG: typedFigure(totals.proteinG),
    carbG: typedFigure(totals.carbG),
    fatG: typedFigure(totals.fatG),
  };
  const portions = Math.max(
    1,
    ...TYPED_KEYS.map((key) => Math.ceil(figures[key] / PER_100G_MAX[key])),
  );
  const per = (figure: number) => hundredths(figure / portions);
  return {
    id: newId(),
    name: name.trim(),
    actualGrams: portions * 100,
    per100g: {
      energyKcal: per(figures.energyKcal),
      proteinG: per(figures.proteinG),
      carbG: per(figures.carbG),
      fatG: per(figures.fatG),
      fiberG: 0,
    },
  };
}

export function MealReplace({
  me,
  date,
  mealId,
  navigate,
}: {
  me: Me;
  date: string;
  mealId: string;
  navigate: Navigate;
}) {
  const { read, meal } = useMealOnDay(date, mealId);
  const back = () => goBack(navigate, '/');
  const bar = (title: string, subline?: string) => (
    <AppBar
      title={title}
      subline={subline}
      slot={<DataState at={read.dataUpdatedAt} />}
      back={{ label: 'Back', onClick: back }}
    />
  );
  if (meal === undefined) {
    return (
      <main>
        {bar('Replaced')}
        {read.isError && (
          <Notice tone="flag" word="Not loaded">
            Couldn’t reach Overload. Try again when you have signal.
          </Notice>
        )}
        {read.data !== undefined && (
          <Notice tone="flag" word="Not found" quiet>
            This meal is no longer in the plan. It may have been made again.
          </Notice>
        )}
      </main>
    );
  }
  return (
    <main className="m2">
      {bar(`Replace ${mealName(meal)}`, `${meal.plannedTime} · ${dateLabel(date).toUpperCase()}`)}
      <ReplaceForm key={meal.id} me={me} date={date} meal={meal} onSaved={back} />
    </main>
  );
}

function ReplaceForm({
  me,
  date,
  meal,
  onSaved,
}: {
  me: Me;
  date: string;
  meal: PlanMeal;
  onSaved: () => void;
}) {
  const account = useAccount();
  const foods = useQuery({ ...foodsQuery, enabled: account.status === 'confirmed' });
  const routines = useQuery({ ...dayRoutinesQuery, enabled: account.status === 'confirmed' });
  const timeZone = me.profile?.timezone ?? deviceTimezone();
  const today = activePlanDay(timeZone, me.profile?.trainingWeekdays ?? [], routines.data ?? []);
  const online = useOnline();
  const [mode, setMode] = useState<'list' | 'hand'>('list');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Picked[]>([]);
  const [typed, setTyped] = useState<Typed>({
    name: '',
    energyKcal: '',
    proteinG: '',
    carbG: '',
    fatG: '',
  });
  const [refused, setRefused] = useState<Map<string, string>>(new Map());
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<ConfirmProblem>();
  const modeName = useId();
  const form = useRef<HTMLFormElement>(null);
  const locked = dayLocked(date, today);

  const words = search.trim().toLowerCase();
  const listed = (foods.data ?? []).filter(
    (food) => food.archivedAt === null && food.name.toLowerCase().includes(words),
  );
  const matches = listed.slice(0, SHOWN);

  const pick = (food: Food) => {
    setRefused(new Map());
    setPicked((current) =>
      current.some((each) => each.food.id === food.id)
        ? current.map((each) =>
            each.food.id === food.id ? { ...each, grams: each.grams + PICK_GRAMS } : each,
          )
        : [...current, { id: newId(), food, grams: PICK_GRAMS }],
    );
  };

  const typedRefusals = () => {
    const found = new Map<string, string>();
    if (typed.name.trim() === '') found.set('name', 'Say what it was');
    for (const key of TYPED_KEYS) {
      const figure = parseFigure(typed[key]);
      if (key === 'energyKcal' && figure === null) found.set(key, 'Enter the calories');
      else if (figure !== null && (!Number.isFinite(figure) || figure < 0 || figure > 9000)) {
        found.set(key, 'A number from 0, in digits only');
      }
    }
    return found;
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const found =
      mode === 'list'
        ? new Map(
            picked.length === 0 ? [['list', 'Add what you ate instead, from your foods']] : [],
          )
        : typedRefusals();
    setRefused(found);
    if (found.size > 0) {
      // A refused field takes focus once drawn, so it is the next thing read and typed in.
      requestAnimationFrame(() =>
        form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
      return;
    }
    const items: PlanMealConfirmItem[] =
      mode === 'list'
        ? picked.map((each) => ({ id: each.id, foodId: each.food.id, actualGrams: each.grams }))
        : [typedItem(typed.name, typed)];
    setSaving(true);
    setProblem(undefined);
    try {
      await confirmMeal(meal.id, { status: 'replaced', items });
      flashNext('Saved as replaced. The planned meal no longer counts.');
      onSaved();
    } catch (error) {
      setProblem(confirmProblem(error));
      setSaving(false);
    }
  };

  const field = (key: keyof Typed) => ({
    value: typed[key],
    onChange: (value: string) => setTyped((current) => ({ ...current, [key]: value })),
    error: refused.get(key),
  });

  return (
    <form ref={form} noValidate onSubmit={(event) => void save(event)}>
      <p className="m2-lede">What did you eat instead? From your foods, or by hand.</p>
      {locked && (
        <Notice tone="flag" word="Read-only" quiet>
          This day is more than 7 days old, so its meals can no longer be changed.
        </Notice>
      )}
      <fieldset className="segments m2-seg-wrap">
        <legend className="visually-hidden">What you ate instead</legend>
        {(
          [
            ['list', 'From my foods'],
            ['hand', 'By hand'],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="segments__segment">
            <input
              type="radio"
              name={modeName}
              checked={mode === value}
              onChange={() => {
                setMode(value);
                setRefused(new Map());
              }}
            />
            {label}
          </label>
        ))}
      </fieldset>
      {mode === 'list' ? (
        <>
          <div className="m2-field-wrap">
            <TextField
              label="Search your foods"
              type="search"
              value={search}
              onChange={setSearch}
              placeholder="Salmon, tofu…"
            />
          </div>
          <ul className="pick">
            {matches.map((food) => (
              <li key={food.id}>
                <button
                  type="button"
                  className="pick__row pick__row--add"
                  disabled={locked}
                  onClick={() => pick(food)}
                >
                  <span className="pick__name">{food.name}</span>
                  <span className="pick__meta">
                    {Math.round(food.energyKcal)} kcal · {food.proteinG} g protein per 100 g
                  </span>
                  <span className="pick__add" aria-hidden="true">
                    ADD 100 G
                  </span>
                  <span className="visually-hidden">. Add 100 g</span>
                </button>
              </li>
            ))}
            {foods.data !== undefined && matches.length === 0 && (
              <li className="pick__none">No food on your list matches.</li>
            )}
            {listed.length > matches.length && (
              <li className="pick__none">
                {matches.length} of {listed.length} foods shown. Search to find the rest.
              </li>
            )}
          </ul>
          {picked.length > 0 && (
            <section className="today__section" aria-labelledby="eaten-instead">
              <h2 id="eaten-instead" className="section-label">
                Eaten instead
              </h2>
              <ul className="replace__list" aria-live="polite">
                {picked.map((each) => (
                  <li key={each.food.id} className="replace__picked">
                    <span>{each.food.name}</span>
                    <span className="meal__grams">
                      {each.grams}
                      <span className="meal__unit"> g</span>
                    </span>
                    <button
                      type="button"
                      className="button button--tertiary replace__remove"
                      onClick={() =>
                        setPicked((current) => current.filter((kept) => kept.id !== each.id))
                      }
                    >
                      Remove<span className="visually-hidden"> {each.food.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {refused.has('list') && (
            <Notice tone="error" word="Refused">
              <span className="notice__line">{refused.get('list')}, or switch to By hand.</span>
            </Notice>
          )}
        </>
      ) : (
        <div className="form">
          <TextField label="What it was" placeholder="Ramen at the station" {...field('name')} />
          <div className="form__pair">
            <NumberField label="Calories" unit="kcal" placeholder="0" {...field('energyKcal')} />
            <NumberField label="Protein" unit="g" decimal placeholder="0" {...field('proteinG')} />
          </div>
          <div className="form__pair">
            <NumberField label="Carbs" unit="g" decimal placeholder="0" {...field('carbG')} />
            <NumberField label="Fat" unit="g" decimal placeholder="0" {...field('fatG')} />
          </div>
          <p className="m2-hint">
            Your own numbers, saved as typed. A photo or a short description arrives in M3.
          </p>
        </div>
      )}
      <ConfirmNotice problem={problem} />
      {!locked && (
        <div className="section-actions">
          <button type="submit" className="button button--primary" disabled={saving || !online}>
            <CheckIcon size={18} color="currentColor" />
            Save as replaced
          </button>
          {!online && <OfflineLine confirmed={meal.status !== 'planned'} />}
        </div>
      )}
    </form>
  );
}
