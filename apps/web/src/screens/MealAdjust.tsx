import type { Food, Me, PlanMeal, PlanMealConfirmItem } from '@overload/api-contract';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { AppBar, CheckIcon, DataState, InfoIcon, Notice, SwapIcon } from '../components';
import {
  confirmMeal,
  dateLabel,
  dayLocked,
  eatenItems,
  flashNext,
  mealTotals,
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

// Adjust (docs/10 §3, Actions; docs/09 F11): the meal as eaten, by changing a food's grams or
// pieces, or swapping it for another in its rotation group. Saving confirms the meal `adjusted`, in
// place of any earlier confirmation. The totals here are a preview; the API's are what count.

const whole = (value: number) => Math.round(value).toLocaleString('en-US');
const hundredths = (value: number) => Math.round(value * 100) / 100;
const GRAM_STEP = 5;

type Values = { energyKcal: number; proteinG: number; carbG: number; fatG: number; fiberG: number };

/** One food as eaten: the planned item it began as, and what it is now. */
type Row = {
  key: string;
  /** The planned item this row stands for, if it began as one. */
  plannedId: string | undefined;
  /** The item id sent: the planned item's while its food is the planned one, else a new one. */
  id: string;
  foodId: string | null;
  name: string;
  /** How the grams are weighed: cooked, in whole pieces, or as weighed. */
  cooked: boolean;
  pieceWeight: number | null;
  grams: number;
  per100g: Values;
  /** The food the row began with, so swapping back sends the planned item again. */
  original: {
    foodId: string | null;
    name: string;
    cooked: boolean;
    pieceWeight: number | null;
    per100g: Values;
  };
};

function rowsOf(meal: PlanMeal): Row[] {
  return eatenItems(meal).map(({ item, grams }) => {
    const planned = item.plannedGrams === null ? undefined : item.id;
    const pieceWeight =
      item.pieceCount !== null && item.pieceCount > 0 && item.plannedGrams !== null
        ? item.plannedGrams / item.pieceCount
        : null;
    const food = {
      foodId: item.foodId,
      name: item.name,
      cooked: item.cooked,
      pieceWeight,
      per100g: item.per100g,
    };
    return { key: item.id, plannedId: planned, id: item.id, grams, ...food, original: food };
  });
}

const valuesOf = (food: Food): Values => ({
  energyKcal: food.energyKcal,
  proteinG: food.proteinG,
  carbG: food.carbG,
  fatG: food.fatG,
  fiberG: food.fiberG,
});

const rowTotals = (rows: Row[]) =>
  rows.reduce(
    (sum, row) => ({
      energyKcal: sum.energyKcal + (row.grams * row.per100g.energyKcal) / 100,
      proteinG: sum.proteinG + (row.grams * row.per100g.proteinG) / 100,
    }),
    { energyKcal: 0, proteinG: 0 },
  );

export function MealAdjust({
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
        {bar('Adjust')}
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
      {bar(`Adjust ${mealName(meal)}`, `${meal.plannedTime} · ${dateLabel(date).toUpperCase()}`)}
      <AdjustForm key={meal.id} me={me} date={date} meal={meal} onSaved={back} onCancel={back} />
    </main>
  );
}

function AdjustForm({
  me,
  date,
  meal,
  onSaved,
  onCancel,
}: {
  me: Me;
  date: string;
  meal: PlanMeal;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const account = useAccount();
  const foods = useQuery({ ...foodsQuery, enabled: account.status === 'confirmed' });
  const routines = useQuery({ ...dayRoutinesQuery, enabled: account.status === 'confirmed' });
  const timeZone = me.profile?.timezone ?? deviceTimezone();
  const today = activePlanDay(timeZone, me.profile?.trainingWeekdays ?? [], routines.data ?? []);
  const online = useOnline();
  const [rows, setRows] = useState(() => rowsOf(meal));
  const [refused, setRefused] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<ConfirmProblem>();
  const locked = dayLocked(date, today);
  const before = meal.status === 'skipped' ? { energyKcal: 0, proteinG: 0 } : mealTotals(meal);
  const after = rowTotals(rows);
  const listed = (foods.data ?? []).filter((food) => food.archivedAt === null);

  const update = (key: string, change: (row: Row) => Row) =>
    setRows((current) => current.map((row) => (row.key === key ? change(row) : row)));

  const step = (row: Row, direction: 1 | -1) => {
    const next = row.grams + direction * (row.pieceWeight ?? GRAM_STEP);
    if (next <= 0) {
      setRefused(row.name);
      return;
    }
    setRefused(undefined);
    update(row.key, (each) => ({ ...each, grams: hundredths(next) }));
  };

  const swap = (row: Row, food: Food) => {
    setRefused(undefined);
    setRows((current) =>
      current.map((each) => {
        if (each.key !== row.key) return each;
        if (each.plannedId !== undefined && food.id === each.original.foodId) {
          return { ...each, ...each.original, id: each.plannedId };
        }
        const planned = meal.items.find(
          (item) =>
            item.plannedGrams !== null &&
            item.actualGrams === 0 &&
            item.foodId === food.id &&
            !current.some((other) => other.key !== each.key && other.id === item.id),
        );
        if (planned !== undefined) {
          const original = {
            foodId: planned.foodId,
            name: planned.name,
            cooked: planned.cooked,
            pieceWeight:
              planned.pieceCount === null || planned.pieceCount <= 0
                ? null
                : (planned.plannedGrams ?? 0) / planned.pieceCount,
            per100g: planned.per100g,
          };
          return { ...each, ...original, original, plannedId: planned.id, id: planned.id };
        }
        const pieceWeight = food.pieceWeightG;
        const grams =
          pieceWeight === null
            ? each.grams
            : Math.max(1, Math.round(each.grams / pieceWeight)) * pieceWeight;
        return {
          ...each,
          id: newId(),
          foodId: food.id,
          name: food.name,
          cooked: food.state === 'cooked',
          pieceWeight,
          grams,
          per100g: valuesOf(food),
        };
      }),
    );
  };

  const save = async () => {
    setSaving(true);
    setProblem(undefined);
    const items: PlanMealConfirmItem[] = [];
    // Every planned item is named: at what was eaten of it, or at 0 g once swapped away.
    for (const item of meal.items.filter((each) => each.plannedGrams !== null)) {
      const row = rows.find((each) => each.id === item.id);
      items.push({ id: item.id, actualGrams: row === undefined ? 0 : hundredths(row.grams) });
    }
    for (const row of rows.filter((each) => each.id !== each.plannedId)) {
      items.push(
        row.foodId === null
          ? { id: row.id, name: row.name, actualGrams: hundredths(row.grams), per100g: row.per100g }
          : { id: row.id, foodId: row.foodId, actualGrams: hundredths(row.grams) },
      );
    }
    try {
      await confirmMeal(meal.id, { status: 'adjusted', items });
      flashNext('Saved as eaten, adjusted. It replaces the plan for this meal.');
      onSaved();
    } catch (error) {
      setProblem(confirmProblem(error));
      setSaving(false);
    }
  };

  return (
    <>
      <p className="m2-lede">
        Change the grams, or swap a food for one in its rotation group. Saving confirms the meal as
        eaten, adjusted.
      </p>
      {locked && (
        <Notice tone="flag" word="Read-only" quiet>
          This day is more than 7 days old, so its meals can no longer be changed.
        </Notice>
      )}
      <ul className="adjust">
        {rows.map((row) => {
          const own = listed.find((food) => food.id === row.foodId);
          const original = listed.find((food) => food.id === row.original.foodId);
          const group = own?.rotationGroupId ?? original?.rotationGroupId ?? null;
          const swaps =
            group === null
              ? []
              : listed.filter((food) => food.rotationGroupId === group && food.id !== row.foodId);
          const unit = row.pieceWeight === null ? 'g' : 'pc';
          const amount =
            row.pieceWeight === null
              ? whole(row.grams)
              : String(hundredths(row.grams / row.pieceWeight));
          return (
            <li key={row.key} className="adjust__row">
              <div>
                <span className="adjust__name">{row.name}</span>
                <span className="adjust__meta">
                  {row.pieceWeight !== null
                    ? 'whole pieces'
                    : row.cooked
                      ? 'cooked weight'
                      : 'as weighed'}
                </span>
                {swaps.length > 0 && (
                  <div className="adjust__swaps">
                    {swaps.map((food) => (
                      <button
                        key={food.id}
                        type="button"
                        className="adjust__swap"
                        disabled={locked}
                        onClick={() => swap(row, food)}
                      >
                        <SwapIcon size={12} />
                        <span className="visually-hidden">Swap {row.name} for </span>
                        {food.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="stepper">
                <button
                  type="button"
                  className="stepper__btn"
                  aria-label={`Less ${row.name}`}
                  disabled={locked}
                  onClick={() => step(row, -1)}
                >
                  −
                </button>
                <output className="stepper__value" aria-live="polite">
                  {amount}
                  <span className="stepper__unit" aria-hidden="true">
                    {' '}
                    {unit === 'pc' ? 'pc' : 'g'}
                  </span>
                  <span className="visually-hidden">
                    {unit === 'pc' ? ' pieces' : ' grams'} of {row.name}
                  </span>
                </output>
                <button
                  type="button"
                  className="stepper__btn"
                  aria-label={`More ${row.name}`}
                  disabled={locked}
                  onClick={() => step(row, 1)}
                >
                  +
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {refused !== undefined && (
        <div className="notice notice--error" role="alert">
          <InfoIcon color="var(--error)" />
          <div>
            <div className="notice__word">Refused</div>
            <p className="notice__line">
              {refused} at 0 g isn’t a portion. Remove it with Replaced instead. The meal stays as
              {meal.status === 'planned' ? ' planned' : ' it was'}.
            </p>
          </div>
        </div>
      )}
      <ConfirmNotice problem={problem} />
      <section className="adjust__sum" aria-label="This meal before and after">
        <div className="adjust__sum-row">
          <span>This meal</span>
          <span className="adjust__sum-fig">
            {whole(before.energyKcal)} → <b>{whole(after.energyKcal)}</b> kcal
          </span>
        </div>
        <div className="adjust__sum-row">
          <span>Protein</span>
          <span className="adjust__sum-fig">
            {whole(before.proteinG)} → <b>{whole(after.proteinG)}</b> g
          </span>
        </div>
      </section>
      {!locked && (
        <div className="section-actions">
          <button
            type="button"
            className="button button--primary"
            disabled={saving || !online}
            onClick={() => void save()}
          >
            <CheckIcon size={18} color="currentColor" />
            Save as eaten, adjusted
          </button>
          <button type="button" className="button button--tertiary" onClick={onCancel}>
            Cancel
          </button>
          {!online && <OfflineLine confirmed={meal.status !== 'planned'} />}
        </div>
      )}
    </>
  );
}
