import type { GoalPhase, Me, PlanDay, PlanMeal } from '@overload/api-contract';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { AppBar, CheckIcon, DataState, InfoIcon, Notice } from '../components';
import {
  confirmDay,
  confirmMeal,
  dateLabel,
  dayLocked,
  flashNext,
  leaveDayIncomplete,
  mealTotals,
  unconfirmedMeals,
  useOnline,
} from '../confirming';
import { clockLabel } from '../dates';
import { goBack, type Navigate } from '../navigation';
import {
  ConfirmNotice,
  confirmProblem,
  Foods,
  mealName,
  OfflineLine,
  wakingMinute,
  type ConfirmProblem,
} from '../plan-day';
import {
  activePlanDay,
  addLocalDays,
  dayRoutinesQuery,
  goalPhasesQuery,
  planDaysQuery,
  useAccount,
} from '../query';
import { deviceTimezone } from '../timezones';

// The end-of-day check (screen 4, docs/10 §4; docs/09 F11, steps 3 and 4): the day's unconfirmed
// meals, each confirmed on its own or all at once as planned, or the day left incomplete. Read once,
// late, with the intent of tapping one button. Nothing is written until an action is tapped.

const whole = (value: number) => Math.round(value).toLocaleString('en-US');

/** The most days one plan read covers (docs/07 §4). */
const READ_DAYS = 31;

export function EndOfDay({ me, date, navigate }: { me: Me; date: string; navigate: Navigate }) {
  const account = useAccount();
  const confirmed = account.status === 'confirmed';
  const timeZone = me.profile?.timezone ?? deviceTimezone();
  const routines = useQuery({ ...dayRoutinesQuery, enabled: confirmed });
  const phases = useQuery({ ...goalPhasesQuery, enabled: confirmed });
  const read = useQuery({ ...planDaysQuery(date, date), enabled: confirmed });
  const online = useOnline();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ConfirmProblem>();
  const [leaveFailed, setLeaveFailed] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const today = activePlanDay(timeZone, me.profile?.trainingWeekdays ?? [], routines.data ?? []);
  const day = read.data?.days.find((each) => each.date === date);
  const phase = phases.data?.find((each) => each.endedOn === null);
  const back = () => goBack(navigate, '/');
  const now = clockLabel(new Date().toISOString(), timeZone);
  const when = date === today ? now : date === addLocalDays(today, -1) ? 'YESTERDAY' : undefined;
  const subline = [dateLabel(date).toUpperCase(), when].filter(Boolean).join(' · ');

  const run = async (work: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setProblem(undefined);
    try {
      await work();
      if (after === undefined) heading.current?.focus();
      else after();
    } catch (error) {
      setProblem(confirmProblem(error));
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    setBusy(true);
    setLeaveFailed(false);
    try {
      await leaveDayIncomplete(me.user.id, date, today);
      flashNext(`${dateLabel(date)} is left incomplete. It won’t ask again.`);
      back();
    } catch {
      setLeaveFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const bar = (
    <AppBar
      title="End of day"
      subline={subline}
      slot={<DataState at={read.dataUpdatedAt} />}
      back={{ label: 'Back to Today', onClick: back }}
    />
  );
  if (day === undefined) {
    return (
      <main>
        {bar}
        {read.isError && (
          <Notice tone="flag" word="Not loaded">
            Couldn’t reach Overload. Try again when you have signal.
          </Notice>
        )}
        {read.data !== undefined && (
          <Notice tone="flag" word="No plan" quiet>
            There’s no plan for this day, so there is nothing to confirm.
          </Notice>
        )}
      </main>
    );
  }

  const locked = dayLocked(date, today);
  const left = unconfirmedMeals(day).toSorted(
    (a, b) =>
      wakingMinute(a.plannedTime, wakeOf(routines.data, day)) -
      wakingMinute(b.plannedTime, wakeOf(routines.data, day)),
  );
  const disabled = busy || !online;

  if (left.length === 0) {
    return (
      <main>
        {bar}
        <section className="empty-state" aria-labelledby="eod-done">
          <h2 id="eod-done" ref={heading} className="empty-state__title" tabIndex={-1}>
            <CheckIcon size={15} color="var(--done)" /> Every meal is confirmed
          </h2>
          <p className="empty-state__body">
            {dateLabel(date)} is a complete day. It counts towards the maintenance check.
          </p>
          <button type="button" className="button button--primary" onClick={back}>
            Back to Today
          </button>
        </section>
      </main>
    );
  }

  const preview = left.reduce(
    (sum, meal) => {
      const totals = mealTotals(meal);
      return {
        energyKcal: sum.energyKcal + totals.energyKcal,
        proteinG: sum.proteinG + totals.proteinG,
      };
    },
    { energyKcal: day.confirmed.energyKcal, proteinG: day.confirmed.proteinG },
  );

  return (
    <main className={locked ? undefined : 'eod'}>
      {bar}
      <section className="eod__head">
        <h2 ref={heading} className="eod__headline" tabIndex={-1}>
          <span className="eod__count">{left.length}</span>{' '}
          <span className="eod__words">
            {left.length === 1 ? 'meal is' : 'meals are'} not confirmed
          </span>
        </h2>
      </section>
      {locked ? (
        <Notice tone="flag" word="Read-only" quiet>
          This day is more than 7 days old, so its meals can no longer be confirmed. It stays
          incomplete.
        </Notice>
      ) : (
        <div className="notice notice--flag">
          <InfoIcon color="var(--flag)" />
          <p className="notice__line">
            If you leave {left.length === 1 ? 'it' : 'them'}, the day is{' '}
            <b className="eod__incomplete">incomplete</b>: it stays out of the maintenance check,
            and the unconfirmed meals count nothing as eaten.
          </p>
        </div>
      )}
      <ConfirmNotice problem={problem} />
      {leaveFailed && (
        <Notice tone="error" word="Not saved">
          Couldn’t save this choice on your device. Try again.
        </Notice>
      )}
      <section className="today__section" aria-labelledby="eod-list">
        <h2 id="eod-list" className="section-label">
          Not confirmed
        </h2>
        <ul className="eod__list">
          {left.map((meal) => (
            <EndOfDayMeal
              key={meal.id}
              meal={meal}
              actions={
                locked
                  ? undefined
                  : {
                      disabled,
                      onConfirm: (status) => void run(() => confirmMeal(meal.id, { status })),
                      onOpen: (screen) =>
                        navigate(`/plan/meals/${meal.id}/${screen}?date=${date}`, {
                          returns: true,
                        }),
                    }
              }
            />
          ))}
        </ul>
      </section>
      {!locked && (
        <>
          <section className="eod__if" aria-labelledby="eod-if">
            <h2 id="eod-if" className="section-label">
              If you confirm them all
            </h2>
            <div className="eod__if-grid">
              <div>
                <span className="eod__if-fig">
                  {whole(preview.energyKcal)}
                  <span className="eod__if-of"> / {whole(day.targets.energyKcal)}</span>
                </span>
                <span className="eod__if-label">kcal eaten</span>
              </div>
              <div>
                <span className="eod__if-fig">
                  {whole(preview.proteinG)}
                  <span className="eod__if-of"> / {whole(day.targets.proteinG)}</span>
                </span>
                <span className="eod__if-label">g protein</span>
              </div>
            </div>
            {phase !== undefined && day.goalPhaseId === phase.id && (
              <CompleteDays phase={phase} date={date} enabled={confirmed} />
            )}
          </section>
          <div className="eod__actions">
            {!online && <OfflineLine confirmed={false} />}
            <button
              type="button"
              className="button button--primary eod__all"
              disabled={disabled}
              onClick={() =>
                void run(
                  () => confirmDay(date),
                  () => {
                    flashNext(
                      `${dateLabel(date)} is a complete day. It counts towards the maintenance check.`,
                    );
                    back();
                  },
                )
              }
            >
              <CheckIcon size={20} color="currentColor" />
              Confirm all as planned
            </button>
            <button
              type="button"
              className="button button--tertiary eod__leave"
              disabled={busy}
              onClick={() => void leave()}
            >
              Leave day incomplete
            </button>
          </div>
        </>
      )}
    </main>
  );
}

const wakeOf = (routines: { dayType: string; wakeTime: string }[] | undefined, day: PlanDay) =>
  routines?.find((each) => each.dayType === day.dayType)?.wakeTime ?? '00:00';

/** One unconfirmed meal: its foods, and four secondaries, since the screen has one primary. */
function EndOfDayMeal({
  meal,
  actions,
}: {
  meal: PlanMeal;
  actions:
    | {
        disabled: boolean;
        onConfirm: (status: 'as_planned' | 'skipped') => void;
        onOpen: (screen: 'adjust' | 'replace') => void;
      }
    | undefined;
}) {
  const name = mealName(meal);
  const said = <span className="visually-hidden"> {name}</span>;
  return (
    <li className="eod-meal">
      <div className="eod-meal__head">
        <span className="eod-meal__time">{meal.plannedTime}</span>
        <h3 className="eod-meal__title">{name}</h3>
        <span className="eod-meal__kcal">{whole(mealTotals(meal).energyKcal)} kcal</span>
      </div>
      <Foods meal={meal} dim />
      {actions !== undefined && (
        <div className="eod-meal__actions">
          <button
            type="button"
            className="button button--secondary"
            disabled={actions.disabled}
            onClick={() => actions.onConfirm('as_planned')}
          >
            <CheckIcon size={14} color="currentColor" />
            As planned
            {said}
          </button>
          <button
            type="button"
            className="button button--secondary"
            disabled={actions.disabled}
            onClick={() => actions.onOpen('adjust')}
          >
            Adjust
            {said}
          </button>
          <button
            type="button"
            className="button button--secondary"
            disabled={actions.disabled}
            onClick={() => actions.onOpen('replace')}
          >
            Replaced
            {said}
          </button>
          <button
            type="button"
            className="button button--secondary"
            disabled={actions.disabled}
            onClick={() => actions.onConfirm('skipped')}
          >
            Skipped
            {said}
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * `Complete days this phase  30 → 31`: the phase's complete days before the date and with it, read
 * from the plan days in windows of 31. Said only once every window has answered.
 */
function CompleteDays({
  phase,
  date,
  enabled,
}: {
  phase: Pick<GoalPhase, 'id' | 'startedOn'>;
  date: string;
  enabled: boolean;
}) {
  const windows: [string, string][] = [];
  for (let from = phase.startedOn; from <= date; from = addLocalDays(from, READ_DAYS)) {
    const to = addLocalDays(from, READ_DAYS - 1);
    windows.push([from, to < date ? to : date]);
  }
  const reads = useQueries({
    queries: windows.map(([from, to]) => ({ ...planDaysQuery(from, to), enabled })),
  });
  if (reads.some((each) => each.data === undefined)) return null;
  const count = reads
    .flatMap((each) => each.data?.days ?? [])
    .filter((each) => each.goalPhaseId === phase.id && each.date !== date && each.complete).length;
  return (
    <div className="eod__if-days">
      <span>Complete days this phase</span>
      <span className="eod__if-fig eod__if-fig--small">
        {count} → {count + 1}
      </span>
    </div>
  );
}
