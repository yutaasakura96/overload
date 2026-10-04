import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useAccount } from './query';
import { signOut, type SignOutResult } from './sign-out';
import { requestUpload } from './uploader';
import { dataState, readFailedFor, recordsLoadedFor, recordsOf, useWorkoutStore } from './workout';

// Components drawn in docs/05 §4, and the few slice 2's screens add from the same tokens (docs/10 §8.1).

/**
 * 4.1. The right side is always the data-state slot. With `back`, the title block becomes screen
 * 2's back chevron plus a 12px title; the chevron's 44px target comes out of the bar's left padding.
 */
export function AppBar({
  title,
  subline,
  slot,
  back,
  sticky = false,
}: {
  title: string;
  subline?: string;
  slot: ReactNode;
  back?: { label: string; onClick: () => void };
  /** Stays at the top while the screen scrolls under it: screen 1 only (docs/10 §7.3). */
  sticky?: boolean;
}) {
  const classes = ['app-bar', back !== undefined && 'app-bar--back', sticky && 'app-bar--sticky'];
  return (
    <header className={classes.filter(Boolean).join(' ')}>
      <div className="app-bar__lead">
        {back !== undefined && (
          <button type="button" className="app-bar__back" onClick={back.onClick}>
            <Chevron direction="back" />
            <span className="visually-hidden">{back.label}</span>
          </button>
        )}
        <div>
          <h1 className="app-bar__title">{title}</h1>
          {subline !== undefined && <div className="app-bar__subline">{subline}</div>}
        </div>
      </div>
      {slot}
    </header>
  );
}

/** 4.2, the resting form: when the data on screen was last synced. */
export function SyncedAt({ at }: { at: number }) {
  if (at === 0) return <output className="data-state" />;
  const time = new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return (
    <output className="data-state">
      <span className="data-state__dot" aria-hidden="true" />
      SYNCED {time}
    </output>
  );
}

/**
 * 4.2, the data-state slot: one condition at a time, in docs/10 §7.4's order. Refused rows first,
 * since only they need the user; then the sets not yet uploaded, which is `flag` and not an error,
 * as nothing is lost; then when the data on screen was last synced.
 */
export function DataState({ at }: { at: number }) {
  const { userId } = useAccount();
  const records = useWorkoutStore((state) => recordsOf(state, userId));
  const lastSyncedAt = useWorkoutStore((state) => state.lastSyncedAt);
  const { refused, pending } = dataState(records);
  if (refused > 0) {
    return (
      <output className="data-state data-state--refused">
        <InfoIcon size={12} color="var(--error)" />
        {refused} REFUSED
      </output>
    );
  }
  if (pending > 0) {
    return (
      <output className="data-state data-state--pending">
        <span className="data-state__dot data-state__dot--flag" aria-hidden="true" />
        {pending} PENDING
      </output>
    );
  }
  return <SyncedAt at={Math.max(at, lastSyncedAt)} />;
}

/**
 * 4.8's tabs, as the switch between the top-level screens. Links, since each is a place with its
 * own address; the current one carries `aria-current`.
 */
export function ScreenTabs({
  current,
  navigate,
}: {
  current: '/' | '/routines' | '/exercises';
  navigate: (path: string) => void;
}) {
  const tabs = [
    { path: '/', label: 'Today' },
    { path: '/routines', label: 'Routines' },
    { path: '/exercises', label: 'Exercises' },
  ] as const;
  return (
    <nav className="tabs" aria-label="Sections">
      {tabs.map((tab) => (
        <a
          key={tab.path}
          href={tab.path}
          className="tabs__tab"
          aria-current={tab.path === current ? 'page' : undefined}
          onClick={(event) => {
            event.preventDefault();
            navigate(tab.path);
          }}
        >
          {tab.label}
        </a>
      ))}
    </nav>
  );
}

/** 6, the info icon. */
export function InfoIcon({ size = 14, color }: { size?: number; color: string }) {
  return (
    <svg
      className="notice__icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 17h.01" />
    </svg>
  );
}

/** 6, the check. Stroke 2.5 at 15px and up, 3 below (docs/05 §4.7). */
export function CheckIcon({ size = 15, color }: { size?: number; color: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={size < 15 ? 3 : 2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 12.5 9.5 18 20 6.5" />
    </svg>
  );
}

/**
 * 6, the back chevron, turned for the other directions rather than adding an icon: forward on a row
 * that opens a screen, up and down on the move buttons.
 */
export function Chevron({ direction }: { direction: 'back' | 'forward' | 'up' | 'down' }) {
  const turn = { back: 0, up: 90, forward: 180, down: 270 }[direction];
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={turn === 0 ? undefined : { transform: `rotate(${turn}deg)` }}
    >
      <path d="M15 5 8 12l7 7" />
    </svg>
  );
}

/**
 * An inline message. `flag` when nothing is lost and trying again may work; `error` only when the
 * server refused (docs/05 §1.4). Always a word and an icon, never colour alone.
 */
export function Notice({
  tone,
  word,
  children,
}: {
  tone: 'flag' | 'error';
  word: string;
  children: ReactNode;
}) {
  return (
    <div className={`notice notice--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <InfoIcon color={tone === 'error' ? 'var(--error)' : 'var(--flag)'} />
      <div>
        <div className="notice__word">{word}</div>
        {children}
      </div>
    </div>
  );
}

/** A field the server refused: the word, the icon and the reason, never the colour alone. */
export function FieldError({ id, message }: { id?: string; message: string }) {
  return (
    <div className="field__error" id={id}>
      <InfoIcon size={12} color="var(--error)" />
      <span className="field__error-word">Refused</span>
      <span>{message}</span>
    </div>
  );
}

type FieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  /** Shown beside the label, e.g. whether the value is the default or the user's own. */
  note?: string;
  /** Said after the label but not shown, e.g. `for Barbell Bench Press`, for context the layout gives. */
  labelContext?: string;
  placeholder?: string;
  className?: string;
};

/** A labelled text field (docs/10 §8.1). 16px text, so iOS does not zoom into it on focus. */
export function TextField({
  label,
  value,
  onChange,
  error,
  note,
  placeholder,
  className,
  focusOnOpen,
  type = 'text',
  identifier = false,
}: FieldProps & {
  /** Focus on mount: only for a form's first field, on a screen opened to fill it in. */
  focusOnOpen?: boolean;
  type?: 'text' | 'search';
  /** An identifier such as `Asia/Tokyo`, not prose: the keyboard leaves it as typed. */
  identifier?: boolean;
}) {
  const id = useId();
  return (
    <div className={['field', className].filter(Boolean).join(' ')}>
      <FieldLabel htmlFor={id} label={label} note={note} />
      <input
        id={id}
        type={type}
        className="field__input"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={identifier ? false : undefined}
        autoCapitalize={identifier ? 'none' : undefined}
        autoCorrect={identifier ? 'off' : undefined}
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- only a form's first field, opened on purpose
        autoFocus={focusOnOpen}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? undefined : `${id}-error`}
        onChange={(event) => onChange(event.target.value)}
      />
      {error !== undefined && <FieldError id={`${id}-error`} message={error} />}
    </div>
  );
}

/**
 * A figure the user types: mono, at the app's 17px figure size (docs/05 §2.2). An empty field with a
 * placeholder means "use the default", which the placeholder shows.
 */
export function NumberField({
  label,
  value,
  onChange,
  error,
  note,
  labelContext,
  placeholder,
  className,
  decimal = false,
  unit,
  errorShownAt,
}: FieldProps & {
  decimal?: boolean;
  unit?: string;
  /** Where `error` is printed instead, for a field too narrow to hold the message itself. */
  errorShownAt?: string;
}) {
  const id = useId();
  const describedBy = error === undefined ? undefined : (errorShownAt ?? `${id}-error`);
  return (
    <div className={['field', 'field--number', className].filter(Boolean).join(' ')}>
      <FieldLabel
        htmlFor={id}
        label={label}
        note={note}
        context={[labelContext, unit === undefined ? undefined : `in ${unitNames[unit]}`]
          .filter(Boolean)
          .join(' ')}
      />
      <div className="field__figure">
        <input
          id={id}
          type="text"
          inputMode={decimal ? 'decimal' : 'numeric'}
          className="field__input field__input--number"
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
        {unit !== undefined && (
          <span className="field__unit" aria-hidden="true">
            {unit}
          </span>
        )}
      </div>
      {error !== undefined && errorShownAt === undefined && (
        <FieldError id={`${id}-error`} message={error} />
      )}
    </div>
  );
}

/** The spoken form of a unit printed beside a figure, which is hidden from screen readers. */
const unitNames: Record<string, string> = { kg: 'kilograms', lb: 'pounds', s: 'seconds' };

function FieldLabel({
  htmlFor,
  label,
  note,
  context,
}: {
  htmlFor: string;
  label: string;
  note?: string;
  context?: string;
}) {
  return (
    <div className="field__label-row">
      <label htmlFor={htmlFor} className="field__label">
        {label}
        {context !== undefined && context !== '' && (
          <span className="visually-hidden"> {context}</span>
        )}
      </label>
      {note !== undefined && <span className="field__note">{note}</span>}
    </div>
  );
}

/** A number the user typed, or `null` for an empty field. Text that is not a number stays NaN. */
export function parseFigure(value: string): number | null {
  const trimmed = value.trim().replace(',', '.');
  return trimmed === '' ? null : Number(trimmed);
}

/**
 * A delete in two steps: the button, then the question with Keep and Delete. Focus moves to Keep when
 * the question opens and back to the button when it closes, so it is never left on nothing.
 */
export function DeleteConfirm({
  label,
  question,
  busy,
  onDelete,
  keepLabel = 'Keep',
  confirmLabel = 'Delete',
}: {
  label: string;
  question: ReactNode;
  busy: boolean;
  onDelete: () => void;
  /** The two answers, for a confirmed action that is not a delete. */
  keepLabel?: string;
  confirmLabel?: string;
}) {
  const [asking, setAsking] = useState(false);
  // Set by the user's click only, so opening the screen never moves focus here.
  const focusPending = useRef(false);
  const target = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!focusPending.current) return;
    focusPending.current = false;
    target.current?.focus();
  });
  const ask = (next: boolean) => {
    focusPending.current = true;
    setAsking(next);
  };

  if (!asking) {
    return (
      <button
        ref={target}
        type="button"
        className="button button--tertiary"
        disabled={busy}
        onClick={() => ask(true)}
      >
        {label}
      </button>
    );
  }
  return (
    <fieldset className="confirm">
      <legend className="confirm__question">{question}</legend>
      <div className="confirm__actions">
        <button
          ref={target}
          type="button"
          className="button button--tertiary"
          disabled={busy}
          onClick={() => ask(false)}
        >
          {keepLabel}
        </button>
        <button
          type="button"
          className="button button--secondary"
          disabled={busy}
          onClick={onDelete}
        >
          {confirmLabel}
        </button>
      </div>
    </fieldset>
  );
}

/**
 * The signed-in account and the way out, at the foot of each top-level screen. A workout is
 * finished and uploaded first; with other rows not yet uploaded, signing out asks: upload them
 * now, or discard them (docs/08 §7).
 */
export function AccountFooter({
  email,
  navigate,
}: {
  email: string;
  navigate: (path: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [stopped, setStopped] = useState<Exclude<SignOutResult, 'signed-out'>>();
  const { userId } = useAccount();
  const loading = useWorkoutStore(
    (state) => !recordsLoadedFor(state, userId) && !readFailedFor(state, userId),
  );
  // Sets the server has not acknowledged, refused ones included (docs/08 §7).
  const waiting = useWorkoutStore(
    (state) =>
      recordsOf(state, userId).filter(
        (record) =>
          record.table === 'sets' &&
          record.deletedAt === undefined &&
          record.state !== 'acknowledged',
      ).length,
  );
  const leave = (options: { discard?: boolean; uploadFirst?: boolean } = {}) => {
    setBusy(true);
    setStopped(undefined);
    void (options.uploadFirst === true ? requestUpload() : Promise.resolve())
      .then(() => signOut(navigate, options))
      .then((result) => {
        if (result === 'signed-out') return;
        setBusy(false);
        setStopped(result);
      });
  };
  return (
    <>
      {stopped === 'failed' && (
        <Notice tone="flag" word="Not signed out">
          Couldn't sign out. Try again.
        </Notice>
      )}
      {stopped === 'workout-open' && (
        <Notice tone="flag" word="Not signed out">
          A workout is in progress. Finish it first, so it is uploaded whole.
        </Notice>
      )}
      {stopped === 'workout-unsynced' && (
        <fieldset className="confirm confirm--gutter">
          <legend className="confirm__question">
            Your workout has not finished uploading. It has to reach the server before you sign out.
          </legend>
          <div className="confirm__actions">
            <button
              type="button"
              className="button button--tertiary"
              disabled={busy}
              onClick={() => leave({ uploadFirst: true })}
            >
              Try again
            </button>
          </div>
        </fieldset>
      )}
      {stopped === 'rows-waiting' && (
        <fieldset className="confirm confirm--gutter">
          <legend className="confirm__question">
            {waiting === 0
              ? 'Your workout is not uploaded yet.'
              : `${waiting} ${waiting === 1 ? 'set' : 'sets'} not uploaded yet.`}{' '}
            Upload now, or discard and sign out.
          </legend>
          <div className="confirm__actions">
            <button
              type="button"
              className="button button--tertiary"
              disabled={busy}
              onClick={() => leave({ uploadFirst: true })}
            >
              Upload now
            </button>
            <button
              type="button"
              className="button button--secondary"
              disabled={busy}
              onClick={() => leave({ discard: true })}
            >
              Discard and sign out
            </button>
          </div>
        </fieldset>
      )}
      <footer className="footer">
        <span className="footer__account">{email}</span>
        <button
          type="button"
          className="button button--tertiary"
          disabled={busy || loading}
          onClick={() => leave()}
        >
          Sign out
        </button>
      </footer>
    </>
  );
}
