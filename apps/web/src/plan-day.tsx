import type { PlanDay, PlanMeal, PlanShortfall } from '@overload/api-contract';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CheckIcon, InfoIcon, Notice, SwapIcon } from './components';
import { eatenItems, mealTotals, type Eaten } from './confirming';
import { EVIDENCE, EvidenceTag } from './evidence';
import type { Navigate } from './navigation';
import { saveProblem } from './saving';

// Today, the whole day (docs/10 §3; the approved M2 prototype, screens 01 to 08): the day's totals,
// what the plan could not reach, and the timeline of meals with the workout marked in it, each meal
// confirmed from its card (S18). Every figure is the API's; this file adds up a meal's items for its
// line and words the meters.

const whole = (value: number) => Math.round(value).toLocaleString('en-US');

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
export function DayTotals({ day, proteinTargetG }: { day: PlanDay; proteinTargetG: number }) {
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
          <Meter label="Protein" value={planned.proteinG} target={proteinTargetG} />
          <Meter label="Carbs" value={planned.carbG} target={targets.carbG} />
          <Meter label="Fat" value={planned.fatG} target={targets.fatG} />
          <Meter label="Fiber" value={planned.fiberG} target={null} />
        </div>
      </section>
    </div>
  );
}

/** What the plan could not reach, said under the totals and never padded (docs/02, Edge cases). */
export function Shortfalls({
  day,
  proteinTargetG,
  navigate,
}: {
  day: PlanDay;
  proteinTargetG: number;
  navigate: Navigate;
}) {
  const addFood = () => navigate('/food/new', { returns: true });
  const missingProteinG = proteinTargetG - day.planned.proteinG;
  return (
    <>
      {missingProteinG > 5 && (
        <Notice tone="flag" word={`Protein ${Math.round(missingProteinG)} g short`}>
          <span className="notice__line">
            The plan stops at {whole(day.planned.proteinG)} g, below today’s target of{' '}
            {whole(proteinTargetG)} g. Nothing else was padded to hide it.
          </span>
          <button
            type="button"
            className="button button--secondary notice__action"
            onClick={addFood}
          >
            Add a protein source
          </button>
        </Notice>
      )}
      {day.shortfalls
        .filter((shortfall: PlanShortfall) => shortfall.target === 'energy')
        .map((shortfall) => (
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
        ))}
    </>
  );
}

/** `120 g`, `3 pieces` for a unit food, or the calories of a food typed by hand. */
function Amount({ eaten }: { eaten: Eaten }) {
  const { item, grams, pieces } = eaten;
  if (item.foodId === null && item.plannedGrams === null) {
    return (
      <span className="meal__grams">
        {whole((grams * item.per100g.energyKcal) / 100)}
        <span className="meal__unit"> kcal</span>
      </span>
    );
  }
  if (pieces !== null) {
    return (
      <span className="meal__grams">
        {pieces}
        <span className="meal__unit"> {pieces === 1 ? 'piece' : 'pieces'}</span>
      </span>
    );
  }
  return (
    <span className="meal__grams">
      {whole(grams)}
      <span className="meal__unit"> g</span>
    </span>
  );
}

/** A food named for how it is cooked ("White rice, cooked", "Sweet potato, steamed"). */
const NAMES_ITS_COOKING = /\b(cooked|steamed|boiled|baked|roasted|grilled|fried)\b/i;

/** The state tag after a food's name; left off the words when the name already says it. */
const cookedQualifier = (item: { name: string; approximate: boolean }) => {
  if (!NAMES_ITS_COOKING.test(item.name)) return `cooked${item.approximate ? ', approx.' : ''}`;
  return item.approximate ? 'approx.' : undefined;
};

export function Foods({ meal, dim }: { meal: PlanMeal; dim: boolean }) {
  const eaten = eatenItems(meal);
  if (eaten.length === 0) return <p className="meal__none">Nothing planned for this meal.</p>;
  return (
    <ul className={dim ? 'meal__foods meal__foods--dim' : 'meal__foods'}>
      {eaten.map((each) => (
        <li key={each.item.id} className="meal__food">
          <span className="meal__name">
            {each.item.name}{' '}
            {each.item.cooked && cookedQualifier(each.item) !== undefined && (
              <span className="meal__qual"> {cookedQualifier(each.item)}</span>
            )}
            {each.item.noCookedMatch && <span className="meal__qual"> raw, no cooked match</span>}
          </span>
          <Amount eaten={each} />
        </li>
      ))}
    </ul>
  );
}

const STATUS_WORD = {
  as_planned: 'Eaten as planned',
  adjusted: 'Eaten, adjusted',
  replaced: 'Replaced',
  skipped: 'Skipped',
} as const;

export const mealName = (meal: PlanMeal) => meal.label ?? `Meal ${meal.position}`;

/** What a meal's actions do, given by Today; undefined on a day that is read-only. */
export type MealActions = {
  /** Confirming needs a connection (docs/09 F11): the actions wait, and say so. */
  offline: boolean;
  /** A confirm on its way: no second one until it answers. */
  busy: boolean;
  onConfirm: (meal: PlanMeal, status: 'as_planned' | 'skipped' | 'planned') => void;
  onAdjust: (meal: PlanMeal) => void;
  onReplace: (meal: PlanMeal) => void;
};

/**
 * A meal's card (Q6): closed, the whole card opens it; open, its actions (S18). The meal due opens
 * by itself, as `05` §4.5's active card. A confirmed meal is one row saying what became of it.
 */
function MealCard({
  meal,
  due,
  open,
  onToggle,
  actions,
}: {
  meal: PlanMeal;
  due: boolean;
  open: boolean;
  onToggle: () => void;
  actions: MealActions | undefined;
}) {
  const confirmed = meal.status !== 'planned';
  const totals = mealTotals(meal);
  const name = mealName(meal);
  const macros = (
    <span className="meal__macros">
      {whole(totals.energyKcal)} kcal · {whole(totals.proteinG)} g protein
    </span>
  );
  const tag =
    meal.evidence[0] === undefined || confirmed ? undefined : (
      <EvidenceTag evidence={EVIDENCE[meal.evidence[0].sourceKey]} />
    );
  const done =
    meal.status === 'planned' ? undefined : (
      <span className="meal__done">
        {meal.status !== 'skipped' && <CheckIcon size={13} color="var(--done)" />}
        {STATUS_WORD[meal.status]}
      </span>
    );
  const classes = [
    'meal',
    confirmed ? 'meal--confirmed' : due && open ? 'meal--active' : undefined,
    open ? 'meal--open' : undefined,
  ];
  const disabled = actions === undefined || actions.offline || actions.busy;
  const said = <span className="visually-hidden"> {name}</span>;
  return (
    <>
      <article className={classes.filter(Boolean).join(' ')}>
        <div className="meal__head">
          <h3 className="meal__title">
            <button
              id={`meal-${meal.id}`}
              type="button"
              className="meal__toggle"
              aria-expanded={open}
              onClick={onToggle}
            >
              {name}
              {due && <span className="visually-hidden">, next</span>}
            </button>
          </h3>
          {done ?? (open ? undefined : macros)}
        </div>
        {open && !confirmed && (
          <div className="meal__sub">
            {macros}
            {tag}
          </div>
        )}
        {(open || !confirmed) && <Foods meal={meal} dim={!open} />}
        {open && actions !== undefined && !confirmed && (
          <div className="meal__actions">
            <button
              type="button"
              className="button button--primary meal__eaten"
              disabled={disabled}
              onClick={() => actions.onConfirm(meal, 'as_planned')}
            >
              <CheckIcon size={18} color="currentColor" />
              Eaten as planned
              {said}
            </button>
            <div className="meal__more">
              <button
                type="button"
                className="button button--secondary"
                disabled={disabled}
                onClick={() => actions.onAdjust(meal)}
              >
                Adjust
                {said}
              </button>
              <button
                type="button"
                className="button button--secondary"
                disabled={disabled}
                onClick={() => actions.onReplace(meal)}
              >
                <SwapIcon />
                Replaced
                {said}
              </button>
              <button
                type="button"
                className="button button--secondary"
                disabled={disabled}
                onClick={() => actions.onConfirm(meal, 'skipped')}
              >
                Skipped
                {said}
              </button>
            </div>
            {actions.offline && <OfflineLine confirmed={false} />}
          </div>
        )}
        {open && actions !== undefined && confirmed && (
          <div className="meal__actions meal__actions--change">
            <span className="meal__change-note">
              Confirmed. Changing it replaces this, never adds to it.
            </span>
            <button
              type="button"
              className="button button--secondary"
              disabled={disabled}
              onClick={() => actions.onAdjust(meal)}
            >
              Adjust
              {said}
            </button>
            <button
              type="button"
              className="button button--secondary"
              disabled={disabled}
              onClick={() => actions.onReplace(meal)}
            >
              Replaced
              {said}
            </button>
            <button
              type="button"
              className="button button--tertiary"
              disabled={disabled}
              onClick={() => actions.onConfirm(meal, 'planned')}
            >
              Undo
              {said}
            </button>
            {actions.offline && <OfflineLine confirmed />}
          </div>
        )}
      </article>
      {!open && tag !== undefined && <div className="meal__tag-row">{tag}</div>}
    </>
  );
}

export type ConfirmProblem = 'unreached' | 'day_locked' | 'not_found' | 'refused';

/** Why a confirm did not save: not reached, past the 7 days, remade, or refused (docs/09 F11). */
export function confirmProblem(error: unknown): ConfirmProblem {
  const problem = saveProblem(error);
  if (problem.kind === 'unreached') return 'unreached';
  if (problem.code === 'day_locked' || problem.code === 'not_found') return problem.code;
  return 'refused';
}

/** The notice for a confirm that did not save. The meal stays as it was in every case. */
export function ConfirmNotice({ problem }: { problem: ConfirmProblem | undefined }) {
  if (problem === undefined) return null;
  if (problem === 'unreached') {
    return (
      <Notice tone="flag" word="Not confirmed">
        Couldn’t reach Overload. The meal stays as it was; confirm it again when you have signal.
      </Notice>
    );
  }
  return (
    <Notice tone="error" word="Refused">
      {problem === 'day_locked'
        ? 'This day is more than 7 days old, so it can no longer be changed.'
        : problem === 'not_found'
          ? 'This meal’s plan was made again. Check the day and confirm it there.'
          : 'Nothing was saved. The meal stays as it was.'}
    </Notice>
  );
}

/** Under disabled actions: why, and that nothing is lost (docs/10 §3, Offline). */
export function OfflineLine({ confirmed = false }: { confirmed?: boolean }) {
  return (
    <p className="meal__offline">
      <InfoIcon size={12} color="var(--text-secondary)" />
      {confirmed
        ? 'Changing this meal needs a connection. Its confirmation stays until the change saves.'
        : 'Confirming needs a connection. Nothing is lost: the meal waits as planned.'}
    </p>
  );
}

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** A clock time as minutes into the day that began at `wakeTime`: past midnight counts on. */
export const wakingMinute = (time: string, wakeTime: string) => {
  const minute = minutes(time);
  return minute < minutes(wakeTime) ? minute + 1440 : minute;
};

/**
 * The day's meals in time order with the workout at its training time. The meal due is the first
 * not yet confirmed (S18); it opens by itself until another is chosen, and again once a confirm
 * changes the day.
 */
export function Timeline({
  day,
  wakeTime,
  workout,
  actions,
}: {
  day: PlanDay;
  wakeTime: string;
  workout: { time: string; node: ReactNode } | undefined;
  actions: MealActions | undefined;
}) {
  const at = (time: string) => wakingMinute(time, wakeTime);
  const meals = day.meals.toSorted((a, b) => at(a.plannedTime) - at(b.plannedTime));
  const due = meals.find((meal) => meal.status === 'planned');
  // The card chosen, kept only while the day's meals stand as they did when it was chosen.
  const statuses = meals.map((meal) => meal.status).join();
  const [chosen, setChosen] = useState<{ id: string | null; statuses: string }>();
  const openId = chosen?.statuses === statuses ? chosen.id : (due?.id ?? null);
  type Entry = { time: string; meal?: PlanMeal; workout?: ReactNode };
  const entries: Entry[] = [
    ...meals.map((meal): Entry => ({ time: meal.plannedTime, meal })),
    ...(workout === undefined ? [] : [{ time: workout.time, workout: workout.node }]),
  ].toSorted((a, b) => at(a.time) - at(b.time) || (a.workout === undefined ? -1 : 1));

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
        const { meal } = entry;
        const isDue = due?.id === meal.id;
        const open = openId === meal.id;
        const dot =
          meal.status !== 'planned'
            ? 'timeline__dot timeline__dot--done'
            : isDue
              ? 'timeline__dot timeline__dot--active'
              : 'timeline__dot';
        return (
          <li key={meal.id} className="timeline__entry">
            <div className="timeline__rail">
              <span className="timeline__time">{entry.time}</span>
              <span className={dot} aria-hidden="true" />
              {!last && <span className="timeline__line" aria-hidden="true" />}
            </div>
            <div className="timeline__body">
              <MealCard
                meal={meal}
                due={isDue}
                open={open}
                onToggle={() => setChosen({ id: open ? null : meal.id, statuses })}
                actions={actions}
              />
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
