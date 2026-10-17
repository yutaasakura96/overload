import type { DayRoutine, DayType, Me, MealRecommendation } from '@overload/api-contract';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { api, ApiError } from '../api';
import { AppBar, DataState, FieldLabel, Notice } from '../components';
import { EVIDENCE, EvidenceTag } from '../evidence';
import { goBack, type Navigate } from '../navigation';
import {
  confirmedAccountData,
  dayRoutinesQuery,
  goalPhasesQuery,
  mealRecommendationQuery,
  phaseDefaultsQuery,
  queryClient,
  regeneratePlan,
  setProfile,
  useAccount,
} from '../query';
import { saveProblem, SaveNotice, type SaveProblem } from '../saving';

// Your day (S15, docs/10 §8.6): wake, work, training and bed for each day type, the training
// weekdays, and the recommended meal count and times with why and its source. The count can be
// changed; the times follow the day as typed. The recommendation is the API's (docs/07 §4).

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

type Day = {
  wakeTime: string;
  bedTime: string;
  workStart: string;
  workEnd: string;
  trainingTime: string;
  /** The count chosen, or null for the recommendation. */
  mealCount: number | null;
};

const START: Record<DayType, Day> = {
  training: {
    wakeTime: '06:30',
    bedTime: '23:00',
    workStart: '09:30',
    workEnd: '18:00',
    trainingTime: '18:30',
    mealCount: null,
  },
  rest: {
    wakeTime: '07:30',
    bedTime: '23:00',
    workStart: '',
    workEnd: '',
    trainingTime: '',
    mealCount: null,
  },
};

const dayOf = (routine: DayRoutine | undefined, dayType: DayType): Day =>
  routine === undefined
    ? START[dayType]
    : {
        wakeTime: routine.wakeTime,
        bedTime: routine.bedTime,
        workStart: routine.workStart ?? '',
        workEnd: routine.workEnd ?? '',
        trainingTime: routine.trainingTime ?? '',
        mealCount: routine.mealCount,
      };

/** The day types a week needs: training if any day trains, rest if any does not (docs/09 F10). */
const needed = (weekdays: number[]): DayType[] => [
  ...(weekdays.length > 0 ? (['training'] as const) : []),
  ...(weekdays.length < 7 ? (['rest'] as const) : []),
];

export function YourDay({ me, navigate }: { me: Me; navigate: Navigate }) {
  const confirmed = useAccount().status === 'confirmed';
  const routines = useQuery({ ...dayRoutinesQuery, enabled: confirmed });
  const back = () => goBack(navigate, '/');
  const set = routines.data?.map((routine) => routine.dayType) ?? [];
  const complete = needed(me.profile?.trainingWeekdays ?? []).every((type) => set.includes(type));
  return (
    <main>
      <AppBar
        title="Your day"
        subline={complete && set.length > 0 ? 'MEAL TIMES AND COUNT' : 'STEP 4 OF 4'}
        slot={<DataState at={routines.dataUpdatedAt} />}
        back={{ label: 'Back', onClick: back }}
      />
      {routines.isError && routines.data === undefined && (
        <Notice tone="flag" word="Not updated">
          Couldn’t reach Overload. Try again when you have signal.
        </Notice>
      )}
      {routines.data !== undefined && (
        <DayForm
          me={me}
          routines={routines.data}
          navigate={navigate}
          onDone={() => navigate('/', { replace: true, note: 'plan-saved' })}
        />
      )}
    </main>
  );
}

function DayForm({
  me,
  routines,
  navigate,
  onDone,
}: {
  me: Me;
  routines: DayRoutine[];
  navigate: Navigate;
  onDone: () => void;
}) {
  const confirmed = useAccount().status === 'confirmed';
  const saved = (type: DayType) => routines.find((routine) => routine.dayType === type);
  const [weekdays, setWeekdays] = useState<number[]>(me.profile?.trainingWeekdays ?? []);
  // The training day first, unless it is set and the rest day is the one still to do.
  const [dayType, setDayType] = useState<DayType>(
    saved('training') !== undefined && saved('rest') === undefined ? 'rest' : 'training',
  );
  const [days, setDays] = useState<Record<DayType, Day>>({
    training: dayOf(saved('training'), 'training'),
    rest: dayOf(saved('rest'), 'rest'),
  });
  const [savedNow, setSavedNow] = useState<DayType>();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<SaveProblem>();
  const day = days[dayType];
  const training = dayType === 'training';
  const setDay = (patch: Partial<Day>) => {
    setDays((all) => ({ ...all, [dayType]: { ...all[dayType], ...patch } }));
    setProblem(undefined);
  };
  const typeName = useId();
  const ids = { wake: useId(), bed: useId(), workStart: useId(), workEnd: useId(), train: useId() };

  const complete =
    day.wakeTime !== '' && day.bedTime !== '' && (!training || day.trainingTime !== '');
  const recommendation = useQuery({
    ...mealRecommendationQuery(dayType, {
      wakeTime: day.wakeTime,
      bedTime: day.bedTime,
      ...(training && day.trainingTime !== '' ? { trainingTime: day.trainingTime } : {}),
      ...(day.mealCount === null ? {} : { mealCount: day.mealCount }),
    }),
    enabled: confirmed && complete,
    placeholderData: keepPreviousData,
    retry: (count, error) => !(error instanceof ApiError && error.status === 422) && count < 2,
  });
  const r = recommendation.data?.dayType === dayType ? recommendation.data : undefined;

  const save = async () => {
    if (r === undefined) return;
    setBusy(true);
    setProblem(undefined);
    try {
      const profileWeekdays = me.profile?.trainingWeekdays ?? [];
      const sorted = weekdays.toSorted((a, b) => a - b);
      if (JSON.stringify(sorted) !== JSON.stringify(profileWeekdays)) {
        setProfile(
          await confirmedAccountData(() =>
            api.PATCH('/api/me/profile', { body: { trainingWeekdays: sorted } }),
          ),
        );
        await followTrainingDays();
      }
      await confirmedAccountData(() =>
        api.PUT('/api/day-routines/{dayType}', {
          params: { path: { dayType } },
          body: {
            wakeTime: day.wakeTime,
            bedTime: day.bedTime,
            workStart: day.workStart === '' ? null : day.workStart,
            workEnd: day.workEnd === '' ? null : day.workEnd,
            trainingTime: training ? day.trainingTime : null,
            slots: r.slots.map((slot) => ({ time: slot.time, label: slot.label })),
          },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: ['plan'] });
      const other: DayType = training ? 'rest' : 'training';
      if (needed(sorted).includes(other) && saved(other) === undefined && savedNow !== other) {
        // The week needs the other day type too: that is the next thing to set.
        setSavedNow(dayType);
        setDayType(other);
        setBusy(false);
        return;
      }
      await regeneratePlan();
      onDone();
    } catch (error) {
      setProblem(saveProblem(error));
      setBusy(false);
    }
  };

  const time = (
    key: 'wakeTime' | 'bedTime' | 'workStart' | 'workEnd' | 'trainingTime',
    id: string,
    label: string,
    note?: string,
  ) => (
    <div className="field">
      <FieldLabel htmlFor={id} label={label} note={note} />
      <input
        id={id}
        type="time"
        className="field__input field__input--when"
        value={day[key]}
        autoComplete="off"
        required={key === 'wakeTime' || key === 'bedTime' || key === 'trainingTime'}
        onChange={(event) => setDay({ [key]: event.target.value })}
      />
    </div>
  );

  return (
    <>
      <fieldset className="segments segments--top">
        <legend className="visually-hidden">Day type</legend>
        {(['training', 'rest'] as const).map((each) => (
          <label key={each} className="segments__segment">
            <input
              type="radio"
              name={typeName}
              checked={dayType === each}
              onChange={() => {
                setDayType(each);
                setProblem(undefined);
              }}
            />
            {each === 'training' ? 'Training day' : 'Rest day'}
          </label>
        ))}
      </fieldset>
      {savedNow !== undefined && savedNow !== dayType && (
        <output className="saved-line">
          {savedNow === 'training' ? 'Training day' : 'Rest day'} saved. Now your{' '}
          {dayType === 'training' ? 'training day' : 'rest day'}.
        </output>
      )}
      <SaveNotice problem={problem} what="day" />
      <div className="form">
        <fieldset className="weekdays">
          <legend className="field__label">Training days</legend>
          {WEEKDAYS.map((label, index) => {
            const weekday = index + 1;
            const on = weekdays.includes(weekday);
            return (
              <button
                key={label}
                type="button"
                className="weekdays__day"
                aria-pressed={on}
                aria-label={WEEKDAY_NAMES[index]}
                onClick={() =>
                  setWeekdays((all) =>
                    on ? all.filter((each) => each !== weekday) : [...all, weekday],
                  )
                }
              >
                {label}
              </button>
            );
          })}
        </fieldset>
        <div className="form__pair">
          {time('wakeTime', ids.wake, 'Wake')}
          {time('bedTime', ids.bed, 'Bed')}
        </div>
        <div className="form__pair">
          {time('workStart', ids.workStart, 'Work starts', 'Optional')}
          {time('workEnd', ids.workEnd, 'Work ends', 'Optional')}
        </div>
        {training && time('trainingTime', ids.train, 'Training time')}
      </div>

      {recommendation.error instanceof ApiError &&
        recommendation.error.code === 'setup_incomplete' && (
          <Notice tone="flag" word="Set up first">
            Protein per meal comes from your goal phase.{' '}
            <a
              href="/plan/phase"
              onClick={(event) => {
                event.preventDefault();
                navigate('/plan/phase', { returns: true });
              }}
            >
              Set your goal
            </a>{' '}
            first.
          </Notice>
        )}
      {complete &&
        recommendation.isError &&
        !(
          recommendation.error instanceof ApiError &&
          recommendation.error.code === 'setup_incomplete'
        ) && (
          <Notice tone="flag" word="Not updated">
            Couldn’t work out the meals. Try again when you have signal.
          </Notice>
        )}
      {!complete && (
        <p className="m2-derived">
          {training ? 'Add a wake, bed and training time' : 'Add a wake and bed time'} to see the
          meals.
        </p>
      )}
      {r !== undefined && complete && (
        <Recommend
          recommendation={r}
          training={training}
          onCount={(count) => setDay({ mealCount: count === r.recommendedCount ? null : count })}
        />
      )}
      <div className="section-actions">
        <button
          type="button"
          className="button button--primary"
          // Not `disabled`: after the training day saves, focus stays here for the rest day.
          aria-disabled={busy || r === undefined || !complete}
          onClick={() => {
            if (!busy && complete) void save();
          }}
        >
          {busy ? 'Saving…' : 'Use these meals'}
        </button>
      </div>
    </>
  );
}

/**
 * Training days move the provisional calories, which count them in the activity level (S14). A phase
 * still on the formula's figure takes the formula's new one; a figure the user set, or a measured
 * one, is theirs and stays.
 */
async function followTrainingDays() {
  const phases = await queryClient.fetchQuery({ ...goalPhasesQuery, staleTime: 0 });
  const open = phases.find((phase) => phase.endedOn === null);
  if (open === undefined || open.calorieBasis !== 'provisional_formula') return;
  const defaults = await queryClient.fetchQuery({
    ...phaseDefaultsQuery(open.type, open.targetRatePctPerWeek ?? undefined),
    staleTime: 0,
  });
  if (defaults.calories.value === open.calorieTargetKcal) return;
  await confirmedAccountData(() =>
    api.PATCH('/api/goal-phases/{id}', {
      params: { path: { id: open.id } },
      body: { calorieTargetKcal: defaults.calories.value, calorieBasis: 'provisional_formula' },
    }),
  );
}

function Recommend({
  recommendation: r,
  training,
  onCount,
}: {
  recommendation: MealRecommendation;
  training: boolean;
  onCount: (count: number) => void;
}) {
  const heading = useId();
  const [low, high] = r.perMealRange;
  const where =
    r.perMeal === 'inside'
      ? `, inside ${low}–${high}.`
      : r.perMeal === 'above'
        ? `, above ${high}: one more meal would spread it better.`
        : `, under ${low}: one fewer meal would make each count.`;
  return (
    <section className="recommend" aria-labelledby={heading}>
      <div className="recommend__head">
        <h2 id={heading} className="recommend__label">
          Recommended
        </h2>
        <div className="stepper">
          <button
            type="button"
            className="stepper__btn"
            aria-label="One meal fewer"
            // Kept focusable at the bound, so focus never drops out of the stepper.
            aria-disabled={r.mealCount <= 1}
            onClick={() => {
              if (r.mealCount > 1) onCount(r.mealCount - 1);
            }}
          >
            −
          </button>
          <output className="stepper__value" aria-live="polite">
            {r.mealCount}
            <span className="stepper__unit"> meals</span>
          </output>
          <button
            type="button"
            className="stepper__btn"
            aria-label="One meal more"
            aria-disabled={r.mealCount >= 8}
            onClick={() => {
              if (r.mealCount < 8) onCount(r.mealCount + 1);
            }}
          >
            +
          </button>
        </div>
      </div>
      <ol className="recommend__times">
        {r.slots.map((slot) => (
          <li key={slot.position}>
            <span className="recommend__time">{slot.time}</span> <span>{slot.label}</span>
          </li>
        ))}
      </ol>
      <p className="recommend__why">
        {Math.round(r.proteinG)} g of protein over {r.mealCount} meals is about{' '}
        {Math.round(r.proteinPerMealG)} g each, {r.proteinPerMealGPerKg.toFixed(2)} g per kg{where}
        {training &&
          r.slots.some((slot) => slot.isPreTraining) &&
          ' One meal sits about 2 hours before training and one soon after.'}
        {r.roomFor < 4 &&
          ` Your day has room for ${r.roomFor} ${r.roomFor === 1 ? 'meal' : 'meals'} 90 minutes apart, so each carries more protein.`}
      </p>
      <div className="m2-source-line">
        <EvidenceTag evidence={EVIDENCE[r.sourceKey]} />
      </div>
      <p className="recommend__note">
        How many meals you eat does not change fat loss at equal calories. The count is for
        spreading protein, so pick what fits your day.
      </p>
      {r.mealCount !== r.recommendedCount && (
        <p className="recommend__yours">
          Yours: {r.mealCount} meals. The recommendation was {r.recommendedCount}.
        </p>
      )}
    </section>
  );
}
