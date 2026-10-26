import type { Me, PrepPlan } from '@overload/api-contract';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  AccountFooter,
  AppBar,
  CheckIcon,
  Chevron,
  DataState,
  Notice,
  ScreenTabs,
} from '../components';
import { dayLabel } from '../dates';
import { useEntryNote, type Navigate } from '../navigation';
import { shortDate } from '../plan';
import {
  grams,
  longDay,
  prepWeek,
  shortDay,
  useTicks,
  weekdayOf,
  wordList,
  yieldNote,
} from '../prep';
import { planToday, prepPlanQuery, queryClient, regeneratePlan, useAccount } from '../query';
import { deviceTimezone } from '../timezones';

// The Food tab's prep plan and grocery list (S17; docs/10 §5, the M2 prototype's screens 11 and
// 12): the raw grams to cook on each of the week's at most two cook days, from the plan and each
// food's newest batch, and the same summed per food to buy. Every figure is the API's.

const SECTIONS = [
  { path: '/food', label: 'Prep' },
  { path: '/food/grocery', label: 'Grocery' },
  { path: '/food/list', label: 'Foods' },
  { path: '/food/batches', label: 'Batches' },
] as const;

type Section = (typeof SECTIONS)[number]['path'];

/** 4.8, the Food tab's four sections (Q3). Links, like the tabs above them. */
export function FoodSections({ current, navigate }: { current: Section; navigate: Navigate }) {
  return (
    <nav className="segments segments--sections" aria-label="Food">
      {SECTIONS.map((section) => (
        <a
          key={section.path}
          href={section.path}
          className="segments__segment"
          aria-current={section.path === current ? 'page' : undefined}
          onClick={(event) => {
            event.preventDefault();
            navigate(section.path);
          }}
        >
          {section.label}
        </a>
      ))}
    </nav>
  );
}

/**
 * The week the prep screens show, and its prep plan. A week with days not yet planned from today on
 * is planned once first (docs/09 F12); until setup is complete there is no plan to prep from.
 */
function usePrepWeek(me: Me) {
  const confirmed = useAccount().status === 'confirmed';
  const timeZone = me.profile?.timezone ?? deviceTimezone();
  const today = planToday(timeZone);
  const probe = prepWeek(today, undefined).current;
  const thisWeek = useQuery({ ...prepPlanQuery(probe), enabled: confirmed });
  const weekStart = prepWeek(today, thisWeek.data).current;
  const prep = useQuery({ ...prepPlanQuery(weekStart), enabled: confirmed });
  const [setup, setSetup] = useState<'unknown' | 'incomplete'>('unknown');
  const [generating, setGenerating] = useState(false);
  const attempted = useRef<string>(undefined);
  const unplanned = (prep.data?.missing ?? []).filter((date) => date >= today).length;
  useEffect(() => {
    if (unplanned === 0 || attempted.current === weekStart) return;
    attempted.current = weekStart;
    setGenerating(true);
    void regeneratePlan()
      .then(() => queryClient.fetchQuery({ ...prepPlanQuery(weekStart), staleTime: 0 }))
      .then((read) => {
        if (read.missing.some((date) => date >= today)) setSetup('incomplete');
      })
      .catch(() => undefined)
      .finally(() => setGenerating(false));
  }, [unplanned, weekStart, today]);
  return { today, weekStart, prep, generating, incomplete: setup === 'incomplete' };
}

function NoPlan({ navigate }: { navigate: Navigate }) {
  return (
    <section className="empty-state" aria-labelledby="no-plan">
      <h2 id="no-plan" className="empty-state__title">
        No plan to prep from yet
      </h2>
      <p className="empty-state__body">
        The prep plan and grocery list are worked out from your meal plan. Finish setting it up on
        Today.
      </p>
      <button type="button" className="button button--primary" onClick={() => navigate('/')}>
        Go to Today
      </button>
    </section>
  );
}

function Unreached({ prep }: { prep: { isError: boolean; data: PrepPlan | undefined } }) {
  if (!prep.isError) return null;
  return (
    <Notice tone="flag" word="Not updated">
      Couldn’t reach Overload.{' '}
      {prep.data === undefined ? 'Try again when you have signal.' : 'Showing the last copy.'}
    </Notice>
  );
}

export function Prep({ me, navigate }: { me: Me; navigate: Navigate }) {
  const { today, weekStart, prep, generating, incomplete } = usePrepWeek(me);
  const ticks = useTicks({ userId: me.user.id, weekStart, list: 'prep' });
  const note = useEntryNote();
  const plan = prep.data;
  const cookDays = (plan?.cookDays ?? []).filter((day) => day.cooks.length > 0);
  const foodOf = new Map((plan?.foods ?? []).map((food) => [food.foodId, food]));
  const week = (plan?.grocery ?? []).filter((item) => item.section === 'week');
  const twoCooks = cookDays.length === 2;

  const tick = (key: string, cook: PrepPlan['cookDays'][number]['cooks'][number], day: string) => {
    if (ticks.ticks.has(key)) {
      ticks.toggle(key);
      return;
    }
    ticks.add(key);
    // Ticking a cook opens Record a batch with its raw grams filled in (Q12).
    const query = new URLSearchParams({
      food: cook.foodId,
      on: day < today ? day : today,
      from: 'prep',
    });
    if (cook.rawGrams !== null) query.set('raw', String(cook.rawGrams));
    navigate(`/food/batches/new?${query.toString()}`, { returns: true });
  };

  return (
    <main className="foods-screen">
      <AppBar
        title="Food"
        subline={`PREP FOR THE WEEK OF ${shortDate(weekStart).toUpperCase()}`}
        slot={<DataState at={prep.dataUpdatedAt} />}
      />
      <ScreenTabs current="/food" navigate={navigate} />
      <FoodSections current="/food" navigate={navigate} />
      <Unreached prep={prep} />
      {note === 'batch-saved' && (
        <output className="saved-line">
          <CheckIcon size={13} color="var(--done)" />
          Batch saved. Plans made from now on use its yield.
        </output>
      )}

      {incomplete && plan !== undefined && plan.generatedAt === null ? (
        <NoPlan navigate={navigate} />
      ) : plan === undefined || (generating && plan.generatedAt === null) ? (
        prep.isPending && <p className="food-status">Working out the week…</p>
      ) : (
        <>
          <p className="food-lede">
            Raw grams to cook, worked out from the week’s plan and each food’s last weighed batch.
            Shop and cook by the raw figure.
          </p>

          {cookDays.length === 0 && (
            <section className="empty-state" aria-labelledby="no-cooks">
              <h2 id="no-cooks" className="empty-state__title">
                Nothing to batch-cook this week
              </h2>
              <p className="empty-state__body">
                A food you cook ahead is listed here once it says how many days a cooked batch
                keeps. Set that on the food.
              </p>
            </section>
          )}

          {cookDays.map((day) => (
            <section key={day.date} className="cook" aria-labelledby={`cook-${day.date}`}>
              <div className="cook__head m2-stick">
                <h2 id={`cook-${day.date}`} className="cook__title">
                  <span className="cook__day">{longDay(day.date)}</span>
                  <span className="cook__which">
                    {day.which === 'first' ? 'First cook day' : 'Second cook day'}
                  </span>
                </h2>
                <div className="cook__cols" aria-hidden="true">
                  <span>Raw</span>
                  <span>Cooked</span>
                  <span />
                </div>
              </div>
              <p className="cook__covers">
                Covers {weekdayOf(day.coversFrom)}
                {day.coversTo === day.coversFrom ? '' : ` to ${weekdayOf(day.coversTo)}`}.
                {day.because !== null &&
                  ` ${day.because.name} keeps ${day.because.keepsDays} days; cook again for the rest of the week.`}
              </p>
              <ul className="cook__rows">
                {day.cooks.map((cook) => {
                  const key = `${day.which}:${cook.foodId}`;
                  const done = ticks.ticks.has(key);
                  const yieldLine = yieldNote(foodOf.get(cook.foodId), cook, today);
                  const raw =
                    cook.rawGrams === null
                      ? '—'
                      : `${cook.approximate ? '≈ ' : ''}${grams(cook.rawGrams)}`;
                  return (
                    <li key={key} className={done ? 'cook__row cook__row--done' : 'cook__row'}>
                      <div>
                        <span className="cook__name">{cook.name}</span>
                        <span
                          className={yieldLine.flag ? 'cook__note cook__note--flag' : 'cook__note'}
                        >
                          {yieldLine.text}
                        </span>
                        <span className="cook__span">
                          For {shortDay(cook.from)}
                          {cook.to === cook.from ? '' : ` to ${shortDay(cook.to)}`}
                        </span>
                      </div>
                      <span className="cook__raw">
                        <span className="visually-hidden">Raw </span>
                        {raw}
                        {cook.rawGrams !== null && <span className="cook__unit"> g</span>}
                      </span>
                      <span className="cook__cooked">
                        <span className="visually-hidden">Cooked </span>
                        {cook.cookedGrams === null ? '—' : grams(cook.cookedGrams)}
                        {cook.cookedGrams !== null && (
                          <span className="visually-hidden"> grams</span>
                        )}
                      </span>
                      <button
                        type="button"
                        className={
                          done
                            ? 'check-cell cook__check check-cell--done'
                            : 'check-cell cook__check'
                        }
                        aria-pressed={done}
                        aria-label={`${cook.name} cooked on ${longDay(day.date)}`}
                        onClick={() => tick(key, cook, day.date)}
                      >
                        <CheckIcon size={15} color={done ? 'var(--done)' : 'var(--line-control)'} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          {(week.length > 0 || plan.uncovered.length > 0) && (
            <section className="today__section" aria-labelledby="not-batch">
              <h2 id="not-batch" className="section-label">
                Not batch-cooked
              </h2>
              {week.length > 0 && (
                <p className="food-hint">
                  The other {week.length === 1 ? 'food is' : `${week.length} foods are`} bought for
                  the week, from the grocery list, and weighed at each meal.
                </p>
              )}
              {plan.uncovered.map((food) => (
                <p key={food.foodId} className="food-hint">
                  {food.name} won’t keep until the next cook; {wordList(food.dates.map(weekdayOf))}{' '}
                  {food.dates.length === 1 ? 'uses' : 'use'} other foods.
                </p>
              ))}
            </section>
          )}

          <a
            href="/food/grocery"
            className="link-row"
            onClick={(event) => {
              event.preventDefault();
              navigate('/food/grocery');
            }}
          >
            <span>
              <span className="link-row__name">Grocery list</span>
              <span className="link-row__meta">
                {plan.grocery.length} {plan.grocery.length === 1 ? 'item' : 'items'}, raw weight
                {twoCooks ? ', both cook days summed' : ''}
              </span>
            </span>
            <Chevron direction="forward" />
          </a>
          {plan.generatedAt !== null && (
            <footer className="footnote footnote--after">
              <span>Plan made {dayLabel(plan.generatedAt, me.profile?.timezone ?? 'UTC')}</span>
              <span className="footnote__formula">
                7 days · {cookDays.length} cook {cookDays.length === 1 ? 'day' : 'days'}
              </span>
            </footer>
          )}
        </>
      )}

      <AccountFooter email={me.user.email} admin={me.isAdmin} navigate={navigate} />
    </main>
  );
}

export function Grocery({ me, navigate }: { me: Me; navigate: Navigate }) {
  const { weekStart, prep, generating, incomplete } = usePrepWeek(me);
  const ticks = useTicks({ userId: me.user.id, weekStart, list: 'grocery' });
  const plan = prep.data;
  const items = plan?.grocery ?? [];
  const left = items.filter((item) => !ticks.ticks.has(item.foodId)).length;
  const cookDays = (plan?.cookDays ?? []).filter((day) => day.cooks.length > 0);

  const note = (item: PrepPlan['grocery'][number]) => {
    if (item.section === 'week') return 'for the week';
    if (item.cooks.length > 1)
      return `${item.cooks.map((each) => (each === null ? '—' : grams(each))).join(' + ')} for two cooks`;
    if (cookDays.length < 2) return 'for the cook day';
    const which = cookDays.find((day) => day.cooks.some((cook) => cook.foodId === item.foodId));
    return which?.which === 'second' ? 'for the second cook' : 'for the first cook';
  };

  const row = (item: PrepPlan['grocery'][number]) => {
    const done = ticks.ticks.has(item.foodId);
    return (
      <li key={item.foodId}>
        <button
          type="button"
          className={done ? 'grocery__row grocery__row--done' : 'grocery__row'}
          aria-pressed={done}
          onClick={() => ticks.toggle(item.foodId)}
        >
          <span className={done ? 'check-cell check-cell--done' : 'check-cell'}>
            <CheckIcon size={15} color={done ? 'var(--done)' : 'var(--line-control)'} />
          </span>
          <span>
            <span className="grocery__name">{item.name}</span>
            <span className="grocery__note">{note(item)}</span>
          </span>
          <span className="grocery__qty">
            {item.quantity === null
              ? '—'
              : `${item.approximate ? '≈ ' : ''}${item.unit === 'pieces' ? item.quantity : grams(item.quantity)}`}
            {item.quantity !== null && (
              <span className="grocery__unit">{item.unit === 'pieces' ? ' pieces' : ' g'}</span>
            )}
          </span>
        </button>
      </li>
    );
  };

  const sections = [
    { key: 'cook_days', label: 'For the cook days' },
    { key: 'week', label: 'For the week' },
  ] as const;

  return (
    <main className="foods-screen">
      <AppBar
        title="Food"
        subline={`GROCERY FOR THE WEEK OF ${shortDate(weekStart).toUpperCase()}`}
        slot={<DataState at={prep.dataUpdatedAt} />}
      />
      <ScreenTabs current="/food" navigate={navigate} />
      <FoodSections current="/food/grocery" navigate={navigate} />
      <Unreached prep={prep} />

      {incomplete && plan !== undefined && plan.generatedAt === null ? (
        <NoPlan navigate={navigate} />
      ) : plan === undefined || (generating && plan.generatedAt === null) ? (
        prep.isPending && <p className="food-status">Working out the week…</p>
      ) : items.length === 0 ? (
        <section className="empty-state" aria-labelledby="no-grocery">
          <h2 id="no-grocery" className="empty-state__title">
            Nothing to buy
          </h2>
          <p className="empty-state__body">The week’s plan has no foods in it yet.</p>
        </section>
      ) : (
        <>
          <p className="grocery__count" aria-live="polite">
            <span>
              <b>{left}</b> of {items.length} left to buy
            </span>
            <span className="grocery__basis">RAW WEIGHT</span>
          </p>
          {sections.map((section) => {
            const listed = items.filter((item) => item.section === section.key);
            if (listed.length === 0) return null;
            return (
              <section
                key={section.key}
                className="today__section"
                aria-labelledby={`grocery-${section.key}`}
              >
                <h2 id={`grocery-${section.key}`} className="section-label">
                  {section.label}
                </h2>
                <ul className="grocery">{listed.map(row)}</ul>
              </section>
            );
          })}
          {ticks.ticks.size > 0 && (
            <div className="section-actions">
              <button type="button" className="button button--tertiary" onClick={ticks.clear}>
                Clear the ticks
              </button>
            </div>
          )}
          <footer className="footnote footnote--after">
            <span>Ticks stay on this phone</span>
            <span className="footnote__formula">
              {items.length} {items.length === 1 ? 'item' : 'items'}
            </span>
          </footer>
        </>
      )}

      <AccountFooter email={me.user.email} admin={me.isAdmin} navigate={navigate} />
    </main>
  );
}
