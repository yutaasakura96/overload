import type { GoalPhase, MaintenanceCheck, WeightUnit } from '@overload/api-contract';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { api, unwrap } from '../api';
import { CheckIcon, InfoIcon, Notice } from '../components';
import { zonedInstant } from '../dates';
import { shortDate } from '../plan';
import {
  addLocalDays,
  currentTargetsQuery,
  forAccount,
  maintenanceCheckQuery,
  planToday,
  queryClient,
  regeneratePlan,
  useAccount,
} from '../query';
import { saveProblem, SaveNotice, type SaveProblem } from '../saving';
import { fromKg } from '../units';

// The maintenance check (S18a, docs/10 §6, screen 6's card): what was eaten on the complete days of
// the last 14, how the trend moved, and the maintenance that implies. Every figure is the API's
// (docs/07 §5, docs/03 §8.3). Read-only: `Apply to targets` asks once, then sets the phase's
// calories as measured and plans the unconfirmed days again (docs/09 F13, Q17).

const NEEDED = 14;

const kcal = (value: number) => Math.round(value).toLocaleString('en-US');

/** `−0.33`: a weekly change in the user's unit, to the hundredth, with a real minus sign. */
function signed(kg: number, unit: WeightUnit) {
  const value = Math.round(fromKg(kg, unit) * 100) / 100;
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(2)}`;
}

const BASIS_WORD = {
  provisional_formula: 'provisional',
  measured: 'measured',
  manual: 'yours',
} as const;

export function MaintenanceCard({
  unit,
  timeZone,
  phase,
  onType,
}: {
  unit: WeightUnit;
  timeZone: string;
  phase: GoalPhase | undefined;
  onType: () => void;
}) {
  const confirmed = useAccount().status === 'confirmed';
  const [now, setNow] = useState(() => Date.now());
  const date = planToday(timeZone, now);
  useEffect(() => {
    const next = zonedInstant(addLocalDays(date, 1), '00:00', timeZone).getTime();
    const timer = setTimeout(() => setNow(Date.now()), Math.max(1, next - Date.now() + 1));
    return () => clearTimeout(timer);
  }, [date, timeZone]);
  const query = useQuery({ ...maintenanceCheckQuery(date), enabled: confirmed });
  const check = query.data;
  const heading = useId();
  if (check === undefined && !query.isError) return null;

  const ref =
    check === undefined
      ? null
      : check.status === 'collecting'
        ? `${check.completeDaysTotal} of ${NEEDED} complete days`
        : `Last 14 days · ${check.completeDaysInWindow ?? 0} complete`;

  return (
    <section className="card card--active maint" aria-labelledby={heading}>
      <div className="maint__head">
        <h2 id={heading} className="maint__title">
          Maintenance check
        </h2>
        {check !== undefined && <span className="maint__ref">{ref}</span>}
      </div>
      {check === undefined ? (
        <Notice tone="flag" word="Not updated">
          Couldn’t reach Overload. Try again when you have signal.
        </Notice>
      ) : (
        <CardBody check={check} unit={unit} phase={phase} onType={onType} />
      )}
    </section>
  );
}

function CardBody({
  check,
  unit,
  phase,
  onType,
}: {
  check: MaintenanceCheck;
  unit: WeightUnit;
  phase: GoalPhase | undefined;
  onType: () => void;
}) {
  if (check.status === 'collecting') {
    return (
      <>
        <p className="maint__count">
          <span className="maint__count-fig">{check.remaining}</span>
          <span className="maint__count-words">
            complete {check.remaining === 1 ? 'day' : 'days'} to go
          </span>
        </p>
        <p className="maint__caveat">
          A complete day is one where every planned meal was confirmed. After {NEEDED} of them, this
          card compares what you ate with how your weight moved.
        </p>
      </>
    );
  }
  if (check.status === 'needs_logging') {
    return (
      <>
        <p className="maint__count">
          <span className="maint__count-words maint__count-words--big">
            Confirm your meals to see this
          </span>
        </p>
        <p className="maint__caveat">
          No day in the last 14 is complete. It needs days where every planned meal was confirmed.
        </p>
      </>
    );
  }
  if (check.status === 'needs_weigh_in') {
    const count = check.weighInsInWindow ?? 0;
    return (
      <>
        <p className="maint__count">
          <span className="maint__count-words maint__count-words--big">Weigh in to see this</span>
        </p>
        <p className="maint__caveat">
          It needs 3 weigh-ins in the last 14 days, one of them in the last 7. You have {count}
          {check.lastWeighedOn === null ? '' : `, the newest on ${shortDate(check.lastWeighedOn)}`}.
          Complete days keep counting meanwhile.
        </p>
        <button type="button" className="button button--secondary" onClick={onType}>
          Type a weight
        </button>
      </>
    );
  }
  return <Ready check={check} unit={unit} phase={phase} />;
}

function Ready({
  check,
  unit,
  phase,
}: {
  check: MaintenanceCheck;
  unit: WeightUnit;
  phase: GoalPhase | undefined;
}) {
  const [justApplied, setJustApplied] = useState(false);
  const appliedLine = useRef<HTMLParagraphElement>(null);
  const intake = check.meanIntakeKcal ?? 0;
  const change = check.trendChangeKgPerWeek ?? 0;
  const maintenance = check.maintenanceKcal ?? 0;
  const apply = phase !== undefined && check.apply?.goalPhaseId === phase.id ? check.apply : null;
  const applied =
    apply !== null &&
    phase?.calorieBasis === 'measured' &&
    phase.calorieTargetKcal === apply.calorieTargetKcal;
  // Focus goes to what applying did, not back to the button it took away.
  useEffect(() => {
    if (justApplied && applied) appliedLine.current?.focus();
  }, [justApplied, applied]);

  return (
    <>
      <div className="maint__figs">
        <p>
          <span className="maint__label">You ate, on average</span>
          <span className="maint__fig">
            {kcal(intake)}
            <span className="maint__unit"> kcal a day</span>
          </span>
        </p>
        <p>
          <span className="maint__label">Your trend moved</span>
          <span className="maint__fig">
            {signed(change, unit)}
            <span className="maint__unit"> {unit} a week</span>
          </span>
        </p>
      </div>
      <p className="maint__result">
        <span className="maint__result-words">So your maintenance is about</span>
        <span className="maint__result-fig">
          ≈ {kcal(maintenance)}
          <span className="maint__unit"> kcal</span>
        </span>
      </p>
      {check.lowRecentLogging === true && (
        <p className="maint__low">
          <InfoIcon color="var(--flag)" />
          Based on too little recent logging: {check.recentCompleteDays ?? 0} of the last 7 days are
          complete.
        </p>
      )}
      {apply === null || phase === undefined ? (
        <p className="maint__caveat">Read-only. Open a goal phase to apply it to your targets.</p>
      ) : (
        <>
          {applied ? (
            <p className="maint__caveat maint__applied" ref={appliedLine} tabIndex={-1}>
              {justApplied && <CheckIcon size={13} color="var(--done)" />}
              Applied: your calories are {kcal(apply.calorieTargetKcal)} kcal a day, measured.
            </p>
          ) : (
            <p className="maint__caveat">
              Read-only. Your targets stay at {kcal(phase.calorieTargetKcal)} kcal until you apply
              this.
            </p>
          )}
          {/* Kept while applied, so the sheet open over it survives the phase being read again. */}
          <ApplySheet
            maintenance={maintenance}
            apply={apply}
            phase={phase}
            applied={applied}
            onApplied={() => setJustApplied(true)}
          />
        </>
      )}
    </>
  );
}

/** Applying asks once, in a sheet: both figures, what the new one is made of, and what follows. */
function ApplySheet({
  maintenance,
  apply,
  phase,
  applied,
  onApplied,
}: {
  maintenance: number;
  apply: NonNullable<MaintenanceCheck['apply']>;
  phase: GoalPhase;
  applied: boolean;
  onApplied: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const heading = useId();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<SaveProblem>();
  // The calories in force when the sheet opened: the phase is read again as it applies.
  const [now, setNow] = useState({ kcal: phase.calorieTargetKcal, basis: phase.calorieBasis });
  const targets = useQuery({
    ...currentTargetsQuery,
    enabled: useAccount().status === 'confirmed',
  });
  const target = apply.calorieTargetKcal;
  const adjustment = apply.adjustmentKcal;
  const rate = phase.targetRatePctPerWeek;
  const held = target !== maintenance + adjustment;
  const protein = targets.data?.proteinG;

  const applying = useRef(false);
  const close = () => dialog.current?.close();

  const save = async () => {
    setBusy(true);
    setProblem(undefined);
    try {
      await forAccount(async () =>
        unwrap(
          await api.PATCH('/api/goal-phases/{id}', {
            params: { path: { id: phase.id } },
            body: { calorieTargetKcal: target, calorieBasis: 'measured' },
          }),
        ),
      );
    } catch (error) {
      setProblem(saveProblem(error));
      setBusy(false);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['plan'] });
    try {
      await regeneratePlan();
    } catch {
      setProblem({ kind: 'plan_failed' });
      setBusy(false);
      return;
    }
    setBusy(false);
    // Focus goes to the applied line, not back to the button the apply took away.
    applying.current = true;
    close();
    onApplied();
  };

  return (
    <>
      {!applied && (
        <button
          ref={opener}
          type="button"
          className="button button--primary maint__apply"
          aria-haspopup="dialog"
          onClick={() => {
            setProblem(undefined);
            setNow({ kcal: phase.calorieTargetKcal, basis: phase.calorieBasis });
            dialog.current?.showModal();
          }}
        >
          Apply to targets
        </button>
      )}
      {/* A tap on the scrim, outside the sheet, closes it. The keyboard has Escape and Close. */}
      {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- a modal dialog closes on Escape by itself */}
      <dialog
        ref={dialog}
        className="sheet-scrim"
        aria-labelledby={heading}
        onClose={() => {
          if (!applying.current) opener.current?.focus();
          applying.current = false;
        }}
        onCancel={(event) => {
          if (busy) event.preventDefault();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget && !busy) event.currentTarget.close();
        }}
      >
        <div className="sheet">
          <div className="sheet__head">
            <h2 id={heading} className="section-label">
              Apply to targets
            </h2>
            <button type="button" className="sheet__close" onClick={close}>
              Close
            </button>
          </div>
          <SaveNotice problem={problem} what="targets" />
          <p className="sheet__claim">Set your calories to {kcal(target)} kcal a day?</p>
          <p className="sheet__means">
            Your maintenance of about {kcal(maintenance)} kcal
            {phase.type === 'cut' && rate !== null
              ? `, less ${kcal(-adjustment)} kcal for your cut of ${rate}% a week.`
              : phase.type === 'bulk' && rate !== null
                ? `, plus ${kcal(adjustment)} kcal for your bulk of ${rate}% a week.`
                : ', to hold your weight.'}
            {held ? ' Held to the 1,000 to 6,000 kcal a target stays within.' : ''}{' '}
            {protein === undefined
              ? 'Protein is unchanged.'
              : `Protein stays at ${Math.round(protein)} g.`}{' '}
            Today’s unconfirmed meals and the rest of the week are planned again; confirmed meals
            stay as they are.
          </p>
          <p className="apply__compare">
            <span>
              Now <b>{kcal(now.kcal)}</b> {BASIS_WORD[now.basis]}
            </span>
            <span aria-hidden="true">→</span>
            <span>
              New <b>{kcal(target)}</b> measured
            </span>
          </p>
          <button
            type="button"
            className="button button--primary"
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? 'Applying…' : `Apply ${kcal(target)} kcal`}
          </button>
          <button type="button" className="button button--tertiary" onClick={close}>
            Not now
          </button>
        </div>
      </dialog>
    </>
  );
}
