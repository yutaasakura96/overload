import type { ReactNode } from 'react';

// Components drawn in docs/05 §4 that slice 1 uses.

/** 4.1. The right side is always the data-state slot. */
export function AppBar({
  title,
  subline,
  slot,
}: {
  title: string;
  subline?: string;
  slot: ReactNode;
}) {
  return (
    <header className="app-bar">
      <div>
        <h1 className="app-bar__title">{title}</h1>
        {subline !== undefined && <div className="app-bar__subline">{subline}</div>}
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
