import type { SetRow, WeightUnit } from '@overload/api-contract';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { FieldError, Notice, NumberField } from './components';
import { readFigures, type FigureRefusal, type Figures } from './figures';
import { formatWeight } from './units';

// The editor a logged set opens into (docs/05 §4.20, docs/09 F3a): the same one under a set's tick
// during the workout and under its row in History. It changes the weight, the reps and the RIR, or
// deletes the set, asking once. Nothing else of a logged set can be changed.

/**
 * A set's three figures, open to correction, with Save, Cancel and Delete. `onSave` and `onDelete`
 * write to the device first (docs/03 §8.1); a write that fails says so and leaves the editor open.
 * The screen closes the editor and puts focus somewhere that stays.
 */
export function SetEditor({
  set,
  unit,
  name,
  onSave,
  onDelete,
  onCancel,
}: {
  set: SetRow;
  unit: WeightUnit;
  /** What the set is called aloud and in the question, e.g. `set 2`. */
  name: string;
  onSave: (figures: Figures) => Promise<void>;
  onDelete: () => Promise<void>;
  onCancel: () => void;
}) {
  const opening = formatWeight(set.weightKg, unit);
  const [kg, setKg] = useState(opening);
  const [reps, setReps] = useState(String(set.reps));
  const [rir, setRir] = useState(set.rir === null ? '' : String(set.rir));
  const [refusal, setRefusal] = useState<FigureRefusal>();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const errorId = useId();

  // Focus follows the user's tap into the question and back out to the button that opened it, so
  // it is never left on a control that has gone.
  const root = useRef<HTMLFormElement>(null);
  const focusPending = useRef<'keep' | 'delete'>(null);
  useEffect(() => {
    const target = focusPending.current;
    if (target === null) return;
    focusPending.current = null;
    root.current?.querySelector<HTMLElement>(`[data-focus="${target}"]`)?.focus();
  });
  const ask = (next: boolean) => {
    focusPending.current = next ? 'keep' : 'delete';
    setFailed(false);
    setAsking(next);
  };

  const settle = (change: Promise<void>) => {
    setBusy(true);
    setFailed(false);
    change.catch(() => {
      setFailed(true);
      setBusy(false);
    });
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (busy || asking) return;
    const figures = readFigures({ kg, reps, rir }, unit, { shown: opening, kg: set.weightKg });
    if ('message' in figures) {
      setRefusal(figures);
      if (figures.field !== undefined) {
        root.current?.querySelector<HTMLElement>(`[data-field="${figures.field}"] input`)?.focus();
      }
      return;
    }
    setRefusal(undefined);
    settle(onSave(figures));
  };

  const error = (field: FigureRefusal['field']) =>
    refusal !== undefined && refusal.field === field ? refusal.message : undefined;

  return (
    <form ref={root} className="set-edit" aria-label={`Edit ${name}`} onSubmit={save} noValidate>
      <div className="refused__fields">
        <div data-field="kg" className="refused__field">
          <NumberField
            label={unit === 'lb' ? 'Lb' : 'Kg'}
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
      {failed && (
        <Notice tone="flag" word="Not saved">
          Couldn’t save that on this device. Try again.
        </Notice>
      )}
      {asking ? (
        <fieldset className="confirm">
          <legend className="confirm__question">
            Delete {name}? It leaves this workout, your charts and last time.
          </legend>
          <div className="confirm__actions">
            <button
              type="button"
              data-focus="keep"
              className="button button--tertiary"
              disabled={busy}
              onClick={() => ask(false)}
            >
              Keep
            </button>
            <button
              type="button"
              className="button button--secondary"
              disabled={busy}
              onClick={() => settle(onDelete())}
            >
              Delete
            </button>
          </div>
        </fieldset>
      ) : (
        <>
          <div className="confirm__actions">
            <button
              type="button"
              className="button button--tertiary"
              disabled={busy}
              onClick={onCancel}
            >
              Cancel
            </button>
            <button type="submit" className="button button--primary" disabled={busy}>
              Save set
            </button>
          </div>
          <button
            type="button"
            data-focus="delete"
            className="button button--tertiary set-edit__delete"
            disabled={busy}
            onClick={() => ask(true)}
          >
            Delete set
          </button>
        </>
      )}
    </form>
  );
}
