import { useId, useRef } from 'react';

// 4.12 Evidence tag and 4.16 Sheet, as the sources sheet (docs/05; docs/10 §7.1). A tag is the
// label on a recommendation together with its route to the sources (CONTEXT.md), so every tag opens
// its sheet. The sheet is a modal <dialog>: it holds focus, closes on Escape, and focus goes back to
// the tag.

type Strength = 'strong' | 'moderate' | 'contested';

type Evidence = {
  /** The claim as the tag prints it, in capitals. */
  tag: string;
  strength: Strength;
  /** The claim as one sentence. */
  claim: string;
  /** What the strength means for this claim, and what the app does with it. */
  means: string;
  sources: { title: string; meta: string; href: string }[];
};

/** The evidence written at build, one entry a claim. The sources are each paper's DOI. */
export const EVIDENCE = {
  // Issue #50, Q13: the weekly range in the balance view (docs/06, 2026-10-10).
  volume: {
    tag: '10–20 SETS',
    strength: 'moderate',
    claim: 'Ten to twenty working sets a week per muscle group is a sound range to grow in.',
    means:
      'Moderate: the studies agree that more weekly sets bring more growth with shrinking returns, but they are few, mostly on young men, and none tests your exact split. Under 10 is not wasted, it is just under the range. Sets that train a muscle indirectly count as half.',
    sources: [
      {
        title:
          'Dose-response relationship between weekly resistance training volume and increases in muscle mass',
        meta: 'Schoenfeld, Ogborn & Krieger · J Sports Sci · 2017',
        href: 'https://doi.org/10.1080/02640414.2016.1210197',
      },
      {
        title:
          'A systematic review of the effects of different resistance training volumes on muscle hypertrophy',
        meta: 'Baz-Valle et al. · J Hum Kinet · 2022',
        href: 'https://doi.org/10.2478/hukin-2022-0017',
      },
      {
        title:
          'The resistance training dose response: meta-regressions of weekly volume and frequency',
        meta: 'Pelland et al. · Sports Med · 2026',
        href: 'https://doi.org/10.1007/s40279-025-02344-w',
      },
    ],
  },
} satisfies Record<string, Evidence>;

const STRENGTH_WORD: Record<Strength, string> = {
  strong: 'Strong',
  moderate: 'Moderate',
  contested: 'Contested',
};

/** The tag itself: the claim, a divider and the strength, in the strength's colour pair. */
function TagFace({ evidence }: { evidence: Evidence }) {
  return (
    <>
      <span>{evidence.tag}</span>
      <span className="evidence__divider" aria-hidden="true" />
      <span className="evidence__strength">{STRENGTH_WORD[evidence.strength]}</span>
    </>
  );
}

/** A tap opens the claim's sources in a sheet over the screen. */
export function EvidenceTag({ evidence }: { evidence: Evidence }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const tag = useRef<HTMLButtonElement>(null);
  const heading = useId();
  return (
    <>
      <button
        ref={tag}
        type="button"
        className={`evidence evidence--${evidence.strength}`}
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
      >
        <TagFace evidence={evidence} />
        <span className="visually-hidden">: open the sources</span>
      </button>
      {/* A tap on the scrim, outside the sheet, closes it. The keyboard has Escape and Close. */}
      {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- a modal dialog closes on Escape by itself */}
      <dialog
        ref={dialog}
        className="sheet-scrim"
        aria-labelledby={heading}
        // Safari does not focus a button on a click, so the dialog alone would give focus to none.
        onClose={() => tag.current?.focus()}
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
      >
        <div className="sheet">
          <div className="sheet__head">
            <h2 id={heading} className="section-label">
              Evidence
            </h2>
            <button type="button" className="sheet__close" onClick={() => dialog.current?.close()}>
              Close
            </button>
          </div>
          <div>
            <span className={`evidence evidence--${evidence.strength} evidence--still`}>
              <TagFace evidence={evidence} />
            </span>
          </div>
          <p className="sheet__claim">{evidence.claim}</p>
          <p className="sheet__means">{evidence.means}</p>
          <div>
            <h3 className="section-label">Sources</h3>
            <ul className="sheet__sources">
              {evidence.sources.map((source) => (
                <li key={source.href}>
                  <a href={source.href} target="_blank" rel="noreferrer">
                    <span className="sheet__source-title">{source.title}</span>
                    <span className="sheet__source-meta">{source.meta}</span>
                    <span className="visually-hidden"> (opens in a new tab)</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </dialog>
    </>
  );
}
