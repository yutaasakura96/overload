import type { PlanDay, PlanItem, PlanMeal, PlanShortfall } from '@overload/api-contract';
import { useEffect, useRef, type ReactNode } from 'react';
import { InfoIcon, Notice } from './components';
import { EVIDENCE, EvidenceTag } from './evidence';
import type { Navigate } from './navigation';

// Today, the whole day (docs/10 §3; the approved M2 prototype, screens 01 to 08): the day's totals,
// what the plan could not reach, and the timeline of meals with the workout marked in it. Confirming
// a meal arrives with slice 5 (#80); until then a meal is shown, not acted on. Every figure is the
// API's; this file adds up a meal's items for its line and words the meters.

const whole = (value: number) => Math.round(value).toLocaleString('en-US');

/** A meal's calories and protein, from its planned items. */
export function mealTotals(meal: PlanMeal) {
  return meal.items.reduce(
    (sum, item) => ({
      energyKcal: sum.energyKcal + ((item.plannedGrams ?? 0) * item.per100g.energyKcal) / 100,
      proteinG: sum.proteinG + ((item.plannedGrams ?? 0) * item.per100g.proteinG) / 100,
    }),
    { energyKcal: 0, proteinG: 0 },
  );
}

/** `on target` within 2 g, else how far over or how far to go, uncoloured (Q8). */
const meterWord = (value: number, target: number) => {
  const diff = Math.round(value - target);
  if (Math.abs(diff) <= 2) return 'on target';
  return diff > 0 ? `${diff} g over` : `${-diff} g to go`;
};

function Meter({ label, value, target }: { label: string; value: number; target: number | null }) {
  const pct = target === null || target <= 0 ? 0 : Math.min(100, (value / target) * 100);
  return (
    <div className="macro">
      <div className="macro__head">
        <span className="macro__label">{label}</span>
        <span className="macro__value">
          {whole(value)}
          {target !== null && <span className="macro__of"> / {whole(target)}</span>}
          <span className="visually-hidden"> g</span>
        </span>
      </div>
      <span className="macro__track" aria-hidden="true">
        {target !== null && <span className="macro__fill" style={{ width: `${pct}%` }} />}
      </span>
      <span className="macro__word">
        {target === null ? 'no target' : meterWord(value, target)}
      </span>
    </div>
  );
}

/** The day's planned calories against the target, what is eaten so far, and the four macros. */
export function DayTotals({ day }: { day: PlanDay }) {
  const { planned, targets, confirmed } = day;
  const off = ((planned.energyKcal - targets.energyKcal) / targets.energyKcal) * 100;
  const offShown = Math.round(off * 10) / 10;
  const sign = offShown > 0 ? '+' : offShown < 0 ? '−' : '';
  const flagged = Math.abs(off) > 5;
  // Today keeps what takes focus clear of the totals by their height (html:has(.m2-stick)).
  const stick = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = stick.current;
    if (element === null) return undefined;
    const observer = new ResizeObserver(() =>
      document.documentElement.style.setProperty('--stick-height', `${element.offsetHeight}px`),
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--stick-height');
    };
  }, []);
  return (
    <div ref={stick} className="m2-stick">
      <section className="totals" aria-label="The day’s totals">
        <div className="totals__row">
          <div>
            <span className="totals__kcal">{whole(planned.energyKcal)}</span>
            <span className="totals__of"> of {whole(targets.energyKcal)} kcal planned</span>
          </div>
          <span className={flagged ? 'totals__off totals__off--flag' : 'totals__off'}>
            {flagged && <InfoIcon size={12} color="var(--flag)" />}
            {sign}
            {Math.abs(offShown).toFixed(1)}%
            <span className="visually-hidden">
              {flagged ? ' against the target, outside the 5% band' : ' against the target'}
            </span>
          </span>
        </div>
        <div className="totals__eaten">
          Eaten so far: <b>{whole(confirmed.energyKcal)} kcal</b>, {whole(confirmed.proteinG)} g
          protein
        </div>
        <div className="macros">
          <Meter label="Protein" value={planned.proteinG} target={targets.proteinG} />
          <Meter label="Carbs" value={planned.carbG} target={targets.carbG} />
          <Meter label="Fat" value={planned.fatG} target={targets.fatG} />
          <Meter label="Fiber" value={planned.fiberG} target={null} />
        </div>
      </section>
    </div>
  );
}

/** What the plan could not reach, said under the totals and never padded (docs/02, Edge cases). */
export function Shortfalls({ day, navigate }: { day: PlanDay; navigate: Navigate }) {
  const addFood = () => navigate('/food/new', { returns: true });
  return day.shortfalls.map((shortfall: PlanShortfall) => {
    if (shortfall.target === 'protein') {
      return (
        <Notice key="protein" tone="flag" word={`Protein ${shortfall.missingG} g short`}>
          <span className="notice__line">
            Your foods can’t reach {whole(day.targets.proteinG)} g today without going over
            calories, so the plan stops at {whole(day.planned.proteinG)} g. Nothing else was padded
            to hide it.
          </span>
          <button
            type="button"
            className="button button--secondary notice__action"
            onClick={addFood}
          >
            Add a protein source
          </button>
        </Notice>
      );
    }
    return (
      <Notice key="energy" tone="flag" word={`Calories ${whole(shortfall.missingKcal)} short`}>
        <span className="notice__line">
          {shortfall.cause === 'portion_cap'
            ? 'A portion would have to grow beyond its sensible cap to close the gap. The plan leaves the gap visible instead.'
            : 'Your foods can’t fill the day without padding one past what it is for. The plan leaves the gap visible instead.'}
        </span>
        {shortfall.suggestion === 'add_food' && (
          <button
            type="button"
            className="button button--secondary notice__action"
            onClick={addFood}
          >
            Add a food
          </button>
        )}
      </Notice>
    );
  });
}

/** `120 g`, or `3 pieces` for a unit food. */
function Amount({ item }: { item: PlanItem }) {
  if (item.pieceCount !== null) {
    return (
      <span className="meal__grams">
        {item.pieceCount}
        <span className="meal__unit"> {item.pieceCount === 1 ? 'piece' : 'pieces'}</span>
      </span>
    );
  }
  return (
    <span className="meal__grams">
      {whole(item.plannedGrams ?? 0)}
      <span className="meal__unit"> g</span>
    </span>
  );
}

function Foods({ meal, dim }: { meal: PlanMeal; dim: boolean }) {
  if (meal.items.length === 0) return <p className="meal__none">Nothing planned for this meal.</p>;
  return (
    <ul className={dim ? 'meal__foods meal__foods--dim' : 'meal__foods'}>
      {meal.items.map((item) => (
        <li key={item.id} className="meal__food">
          <span className="meal__name">
            {item.name}{' '}
            {item.cooked && (
              <span className="meal__qual"> cooked{item.approximate ? ', approx.' : ''}</span>
            )}
            {item.noCookedMatch && <span className="meal__qual"> raw, no cooked match</span>}
          </span>
          <Amount item={item} />
        </li>
      ))}
    </ul>
  );
}

/** A meal's card: the next one due is open, as `05` §4.5's active card; the others are quieter. */
function MealCard({ meal, due }: { meal: PlanMeal; due: boolean }) {
  const totals = mealTotals(meal);
  const macros = (
    <span className="meal__macros">
      {whole(totals.energyKcal)} kcal · {whole(totals.proteinG)} g protein
    </span>
  );
  const tag =
    meal.evidence[0] === undefined ? undefined : (
      <EvidenceTag evidence={EVIDENCE[meal.evidence[0].sourceKey]} />
    );
  if (!due) {
    return (
      <>
        <article className="meal">
          <div className="meal__head">
            <h3 className="meal__title">{meal.label ?? `Meal ${meal.position}`}</h3>
            {macros}
          </div>
          <Foods meal={meal} dim />
        </article>
        {tag !== undefined && <div className="meal__tag-row">{tag}</div>}
      </>
    );
  }
  return (
    <article className="meal meal--active">
      <div className="meal__head">
        <h3 className="meal__title">
          {meal.label ?? `Meal ${meal.position}`}
          <span className="visually-hidden">, next</span>
        </h3>
      </div>
      <div className="meal__sub">
        {macros}
        {tag}
      </div>
      <Foods meal={meal} dim={false} />
    </article>
  );
}

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/**
 * The day's meals in time order with the workout at its training time. The meal due is the first
 * not more than an hour past; before slice 5 nothing is confirmed, so the time alone says it.
 */
export function Timeline({
  day,
  now,
  wakeTime,
  workout,
}: {
  day: PlanDay;
  /** The local time now, `HH:MM`. */
  now: string;
  wakeTime: string;
  workout: { time: string; node: ReactNode } | undefined;
}) {
  const wake = minutes(wakeTime);
  const wakingMinute = (time: string) => {
    const minute = minutes(time);
    return minute < wake ? minute + 1440 : minute;
  };
  const meals = day.meals.toSorted(
    (a, b) => wakingMinute(a.plannedTime) - wakingMinute(b.plannedTime),
  );
  const due = meals.find((meal) => wakingMinute(meal.plannedTime) + 60 >= wakingMinute(now));
  type Entry = { time: string; meal?: PlanMeal; workout?: ReactNode };
  const entries: Entry[] = [
    ...meals.map((meal): Entry => ({ time: meal.plannedTime, meal })),
    ...(workout === undefined ? [] : [{ time: workout.time, workout: workout.node }]),
  ].toSorted(
    (a, b) => wakingMinute(a.time) - wakingMinute(b.time) || (a.workout === undefined ? -1 : 1),
  );

  return (
    <ol className="timeline">
      {entries.map((entry, index) => {
        const last = index === entries.length - 1;
        if (entry.meal === undefined) {
          return (
            <li key="workout" className="timeline__entry timeline__entry--workout">
              <div className="timeline__rail">
                <span className="timeline__time">{entry.time}</span>
                <span className="timeline__square" aria-hidden="true" />
                {!last && <span className="timeline__line" aria-hidden="true" />}
              </div>
              <div className="timeline__body">{entry.workout}</div>
            </li>
          );
        }
        const isDue = due?.id === entry.meal.id;
        return (
          <li key={entry.meal.id} className="timeline__entry">
            <div className="timeline__rail">
              <span className="timeline__time">{entry.time}</span>
              <span
                className={isDue ? 'timeline__dot timeline__dot--active' : 'timeline__dot'}
                aria-hidden="true"
              />
              {!last && <span className="timeline__line" aria-hidden="true" />}
            </div>
            <div className="timeline__body">
              <MealCard meal={entry.meal} due={isDue} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** While the day is made: the totals and four entries as skeletons, said in words. */
export function PlanSkeleton() {
  return (
    <div aria-busy="true">
      <div className="totals totals--skeleton">
        <span className="skeleton skeleton--figure" />
        <span className="skeleton" />
      </div>
      <p className="m2-generating">Making today’s plan from your foods…</p>
      {[1, 2, 3, 4].map((each) => (
        <div key={each} className="skeleton-row">
          <span className="skeleton skeleton--time" />
          <span className="skeleton skeleton--card" />
        </div>
      ))}
    </div>
  );
}
