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
  // Issue #79: the goal phase's defaults (S14), the meal count (S15) and the plan (S16). Keyed by the
  // API's `sourceKey`.
  rate_cut: {
    tag: '0.5–1% A WEEK',
    strength: 'moderate',
    claim: 'Losing 0.5 to 1% of bodyweight a week keeps more muscle on a cut than losing faster.',
    means:
      'Moderate: a review of studies in lean, trained people. The default is the slow end, 0.5%, which suits a cut that is already lean.',
    sources: [
      {
        title:
          'Evidence-based recommendations for natural bodybuilding contest preparation: nutrition and supplementation',
        meta: 'Helms, Aragon & Fitschen · J Int Soc Sports Nutr · 2014',
        href: 'https://doi.org/10.1186/1550-2783-11-20',
      },
    ],
  },
  rate_bulk: {
    tag: '0.25–0.5% A WEEK',
    strength: 'moderate',
    claim:
      'Gaining 0.25 to 0.5% of bodyweight a week builds muscle with less fat than gaining faster.',
    means:
      'Moderate: a narrative review of the evidence for trained lifters. The default is the slow end, 0.25%, since the further trained you are the slower muscle comes.',
    sources: [
      {
        title: 'Nutrition recommendations for bodybuilders in the off-season: a narrative review',
        meta: 'Iraki, Fitschen, Espinar & Helms · Sports · 2019',
        href: 'https://doi.org/10.3390/sports7070154',
      },
    ],
  },
  protein_g_per_kg: {
    tag: '1.6–2.2 G/KG',
    strength: 'strong',
    claim:
      'Protein of 1.6 g per kg of bodyweight a day, up to about 2.2, supports muscle gain from training.',
    means:
      'Strong: a meta-analysis of 49 trials. On a cut needs rise, so a cut starts at the top of the range; maintenance and a bulk start at 1.6.',
    sources: [
      {
        title:
          'A systematic review, meta-analysis and meta-regression of the effect of protein supplementation on resistance training-induced gains in muscle mass and strength in healthy adults',
        meta: 'Morton et al. · Br J Sports Med · 2018',
        href: 'https://doi.org/10.1136/bjsports-2017-097608',
      },
      {
        title:
          'A systematic review of dietary protein during caloric restriction in resistance trained lean athletes: a case for higher intakes',
        meta: 'Helms et al. · Int J Sport Nutr Exerc Metab · 2014',
        href: 'https://doi.org/10.1123/ijsnem.2013-0054',
      },
    ],
  },
  fat_pct_calories: {
    tag: '15–30% OF CALORIES',
    strength: 'moderate',
    claim: 'Fat at 15 to 30% of calories suits most lifters, with carbohydrate filling the rest.',
    means:
      'Moderate: a review’s recommendation for most, but not all, lifters. The default is 25%, inside the range.',
    sources: [
      {
        title:
          'Evidence-based recommendations for natural bodybuilding contest preparation: nutrition and supplementation',
        meta: 'Helms, Aragon & Fitschen · J Int Soc Sports Nutr · 2014',
        href: 'https://doi.org/10.1186/1550-2783-11-20',
      },
    ],
  },
  provisional_calories: {
    tag: 'MIFFLIN–ST JEOR',
    strength: 'moderate',
    claim:
      'Resting energy from height, weight, age and sex by the Mifflin–St Jeor equation, times your activity, gives a starting estimate of your calories.',
    means:
      'Moderate: the equation a systematic review found most often within 10% of measured, but any equation misses some people by more. Activity is 1.45 with no training days and 0.05 more for each, inside FAO/WHO/UNU’s 1.40 to 1.99. It is provisional until the maintenance check measures your real intake against your weight.',
    sources: [
      {
        title: 'A new predictive equation for resting energy expenditure in healthy individuals',
        meta: 'Mifflin et al. · Am J Clin Nutr · 1990',
        href: 'https://doi.org/10.1093/ajcn/51.2.241',
      },
      {
        title:
          'Comparison of predictive equations for resting metabolic rate in healthy nonobese and obese adults: a systematic review',
        meta: 'Frankenfield, Roth-Yousey & Compher · J Am Diet Assoc · 2005',
        href: 'https://doi.org/10.1016/j.jada.2005.02.005',
      },
      {
        title: 'Human energy requirements: report of a joint FAO/WHO/UNU expert consultation',
        meta: 'FAO/WHO/UNU · Food and Nutrition Technical Report Series 1 · 2004',
        href: 'https://www.fao.org/4/Y5686E/y5686e00.htm',
      },
    ],
  },
  protein_per_meal: {
    tag: '0.4–0.55 G/KG A MEAL',
    strength: 'moderate',
    claim:
      'Spreading protein over at least four meals, at 0.4 to 0.55 g per kg each, makes the most of it for muscle.',
    means:
      'Moderate: drawn from short studies of muscle protein synthesis after a meal. The number of meals does not change fat loss at equal calories; it is recommended for protein only.',
    sources: [
      {
        title:
          'How much protein can the body use in a single meal for muscle-building? Implications for daily protein distribution',
        meta: 'Schoenfeld & Aragon · J Int Soc Sports Nutr · 2018',
        href: 'https://doi.org/10.1186/s12970-018-0215-1',
      },
      {
        title: 'Effects of meal frequency on weight loss and body composition: a meta-analysis',
        meta: 'Schoenfeld, Aragon & Krieger · Nutr Rev · 2015',
        href: 'https://doi.org/10.1093/nutrit/nuu017',
      },
    ],
  },
  carb_timing_training: {
    tag: 'MORE CARBS',
    strength: 'moderate',
    claim:
      'Putting more of the day’s carbohydrate in the meals before and after training can help you train and recover.',
    means:
      'Moderate: the effect is clearest for long or twice-a-day training. For one weights workout a day the day’s total matters more than the timing, so the plan moves carbohydrate towards training without changing the total.',
    sources: [
      {
        title: 'International Society of Sports Nutrition position stand: nutrient timing',
        meta: 'Kerksick et al. · J Int Soc Sports Nutr · 2017',
        href: 'https://doi.org/10.1186/s12970-017-0189-4',
      },
      {
        title: 'Nutrient timing revisited: is there a post-exercise anabolic window?',
        meta: 'Aragon & Schoenfeld · J Int Soc Sports Nutr · 2013',
        href: 'https://doi.org/10.1186/1550-2783-10-5',
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
        className="evidence-hit"
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
      >
        <span className={`evidence evidence--${evidence.strength}`}>
          <TagFace evidence={evidence} />
        </span>
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
