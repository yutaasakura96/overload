import type { WeightUnit } from '@overload/api-contract';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { FieldError, InfoIcon, Notice, NumberField } from './components';
import { MAX_WEIGHT_KG, readFigures, type FigureRefusal } from './figures';
import type { SetRecord } from './set-store';
import { formatWeight } from './units';
import { discardSet, editSet } from './workout';

// The refused set (docs/09 F4, docs/05 §4.17): a set the server turned away stays on the device
// and on screen, with the word, the reason and what can be done about it, until the user edits or
// discards it. It is never dropped silently.

/** Why the server refused a set, in plain words. */
export function refusalReason(set: SetRecord, unit: WeightUnit): string {
  const { row, refusal } = set;
  if (refusal?.code === 'parent_missing') return 'Its exercise is not on the server any more';
  if (refusal?.code === 'not_found') return 'It is not a set of this account';
  const fields = refusal?.fields ?? [];
  if (fields.includes('weightKg')) {
    return row.weightKg > MAX_WEIGHT_KG
      ? `Weight over ${formatWeight(MAX_WEIGHT_KG, unit)} ${unit}`
      : 'Weight is not one the server takes';
  }
  if (fields.includes('reps')) return row.reps > 100 ? 'Reps over 100' : 'Reps under 1';
  if (fields.includes('rir')) return 'RIR is not 0 to 10';
  if (fields.includes('rpe')) return 'RIR and RPE are both recorded';
  return 'The server could not store it';
}

/** The figures of a set as one line: `82.5 kg × 10 · RIR 2`. */
export function setFigures(set: SetRecord, unit: WeightUnit) {
  const { weightKg, reps, rir } = set.row;
  return `${formatWeight(weightKg, unit)} ${unit} × ${reps}${rir === null ? '' : ` · RIR ${rir}`}`;
}

type Focus = 'edit' | 'discard' | 'keep' | 'weight';

/**
 * What a refused set says and offers: `REFUSED`, the reason, and Edit and Discard, always in view
 * because the row exists to be acted on. Edit opens the figures in place and queues the set again;
 * Discard asks once more. A set only its exercise's absence refused cannot be edited into one the
 * server takes, so it offers Discard alone.
 */
export function RefusedSet({
  set,
  unit,
  name,
  icon = false,
  onSettled,
}: {
  set: SetRecord;
  unit: WeightUnit;
  /** What the set is called aloud, e.g. `set 2`. */
  name: string;
  /** Where no cell beside this one already carries the icon. */
  icon?: boolean;
  /** Called once the set is no longer refused, for the screen to put focus somewhere that stays. */
  onSettled?: () => void;
}) {
  const [mode, setMode] = useState<'idle' | 'editing' | 'discarding'>('idle');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const opening = formatWeight(set.row.weightKg, unit);
  const [kg, setKg] = useState(opening);
  const [reps, setReps] = useState(String(set.row.reps));
  const [rir, setRir] = useState(set.row.rir === null ? '' : String(set.row.rir));
  const [refusal, setRefusal] = useState<FigureRefusal>();
  const errorId = useId();
  const editable = set.refusal === undefined || set.refusal.code === 'validation_failed';

  // Focus follows the user's own tap into the form or the question, and back out to the control
  // that opened it, so it is never left on something that has gone.
  const root = useRef<HTMLDivElement>(null);
  const focusPending = useRef<Focus>(null);
  useEffect(() => {
    const target = focusPending.current;
    if (target === null) return;
    focusPending.current = null;
    const selector = target === 'weight' ? '[data-field="kg"] input' : `[data-focus="${target}"]`;
    root.current?.querySelector<HTMLElement>(selector)?.focus();
  });
  const go = (next: typeof mode, focus: Focus) => {
    focusPending.current = focus;
    setFailed(false);
    setRefusal(undefined);
    setMode(next);
  };

  const settle = async (change: Promise<void>) => {
    setBusy(true);
    setFailed(false);
    try {
      await change;
      onSettled?.();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    const figures = readFigures({ kg, reps, rir }, unit, { shown: opening, kg: set.row.weightKg });
    if ('message' in figures) {
      setRefusal(figures);
      if (figures.field !== undefined) {
        root.current?.querySelector<HTMLElement>(`[data-field="${figures.field}"] input`)?.focus();
      }
      return;
    }
    setRefusal(undefined);
    void settle(editSet(set.id, figures));
  };

  const notSaved = failed && (
    <Notice tone="flag" word="Not saved">
      Couldn’t save that on this device. Try again.
    </Notice>
  );

  if (mode === 'editing') {
    const error = (field: FigureRefusal['field']) =>
      refusal !== undefined && refusal.field === field ? refusal.message : undefined;
    return (
      <div ref={root} className="refused">
        <form className="refused__form" onSubmit={save} noValidate>
          <div className="refused__fields">
            <div data-field="kg" className="refused__field">
              <NumberField
                label="Weight"
                labelContext={`of ${name}`}
                unit={unit}
                decimal
                value={kg}
                onChange={setKg}
                error={error('kg')}
                errorShownAt={errorId}
              />
            </div>
            <div data-field="reps" className="refused__field">
              <NumberField
                label="Reps"
                labelContext={`of ${name}`}
                value={reps}
                onChange={setReps}
                error={error('reps')}
                errorShownAt={errorId}
              />
            </div>
            <div data-field="rir" className="refused__field">
              <NumberField
                label="RIR"
                labelContext={`of ${name}, optional`}
                placeholder="—"
                value={rir}
                onChange={setRir}
                error={error('rir')}
                errorShownAt={errorId}
              />
            </div>
          </div>
          {refusal !== undefined && (
            <div role="alert">
              <FieldError id={errorId} message={refusal.message} />
            </div>
          )}
          {notSaved}
          <div className="confirm__actions">
            <button
              type="button"
              className="button button--tertiary"
              disabled={busy}
              onClick={() => go('idle', 'edit')}
            >
              Cancel
            </button>
            <button type="submit" className="button button--secondary" disabled={busy}>
              Save set
            </button>
          </div>
        </form>
      </div>
    );
  }

  if (mode === 'discarding') {
    return (
      <div ref={root} className="refused">
        <fieldset className="confirm refused__confirm">
          <legend className="confirm__question">
            Discard {name}? It is removed from this device and is not saved.
          </legend>
          {notSaved}
          <div className="confirm__actions">
            <button
              type="button"
              data-focus="keep"
              className="button button--tertiary"
              disabled={busy}
              onClick={() => go('idle', 'discard')}
            >
              Keep
            </button>
            <button
              type="button"
              className="button button--secondary"
              disabled={busy}
              onClick={() => void settle(discardSet(set.id))}
            >
              Discard
            </button>
          </div>
        </fieldset>
      </div>
    );
  }

  return (
    <div ref={root} className="refused">
      <div className="refused__text">
        <div className="refused__word">
          {icon && <InfoIcon size={12} color="var(--error)" />}
          Refused
        </div>
        <div className="refused__reason">{refusalReason(set, unit)}</div>
      </div>
      <div className="refused__actions">
        {editable && (
          <button
            type="button"
            data-focus="edit"
            className="button button--secondary refused__edit"
            onClick={() => go('editing', 'weight')}
          >
            Edit<span className="visually-hidden"> {name}</span>
          </button>
        )}
        <button
          type="button"
          data-focus="discard"
          className="button button--tertiary refused__discard"
          onClick={() => go('discarding', 'keep')}
        >
          Discard<span className="visually-hidden"> {name}</span>
        </button>
      </div>
    </div>
  );
}
