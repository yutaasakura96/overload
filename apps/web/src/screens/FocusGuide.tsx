import { useEffect, useRef } from 'react';
import { AppBar, CheckIcon, DataState, Notice } from '../components';
import { markFocusSetUp, toggleFocusStep, useFocusGuide } from '../focus-guide';
import { useWorkoutStore } from '../workout';

// The iPhone Focus guide (docs/10 §8.3), opened from full screen. A web app cannot turn a Focus on,
// so this is the four steps that set one up in iOS Settings, as Apple's iPhone User Guide gives
// them. Static: nothing here reads the phone. What is ticked is kept on the device.

const STEPS = [
  {
    title: 'Create the Focus',
    path: 'Settings › Focus › Add › Custom',
    text: 'Name it Workout, choose a colour and an icon, tap Next, then Customize Focus. The same list has a ready-made Fitness Focus if you would rather start from that.',
  },
  {
    title: 'Choose who can reach you',
    path: 'Workout › People › Allow Notifications From',
    text: 'Add the people whose calls and messages must get through. Turn on repeated calls too: a second call from the same person within three minutes then comes through.',
  },
  {
    title: 'Choose which apps can notify',
    path: 'Workout › Apps › Allow Notifications From',
    text: 'Add only what you need, such as Phone and Messages. A web app on the Home Screen, Overload included, can be added here.',
  },
  {
    title: 'Have it turn on at the gym',
    path: 'Workout › Add Schedule › Location',
    text: 'Pick your gym, and the Focus turns on when you arrive. A time of day works too, or turn it on yourself from Control Centre.',
  },
];

// When the steps were last read against Apple's guide. It changes with them.
const CHECKED = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
}).format(new Date('2026-10-10T00:00:00Z'));

export function FocusGuide({ onBack }: { onBack: () => void }) {
  const { steps } = useFocusGuide();
  const syncedAt = useWorkoutStore((state) => state.lastSyncedAt);
  const top = useRef<HTMLElement>(null);

  // It opens over the workout, from a row at the foot of the screen: start at its top, with focus
  // on the screen itself, so what is read next is the guide.
  useEffect(() => {
    window.scrollTo(0, 0);
    top.current?.focus({ preventScroll: true });
  }, []);

  return (
    <main ref={top} className="guide-screen" tabIndex={-1}>
      <AppBar
        title="iPhone Focus"
        slot={<DataState at={syncedAt} />}
        back={{ label: 'Back to the workout', onClick: onBack }}
      />
      <Notice tone="flag" word="What Overload cannot do" quiet>
        A web app cannot turn a Focus on, or stop you opening other apps. iOS does that, so it is
        set up once in Settings. Full screen keeps the workout in front of you; the Focus keeps
        everything else quiet.
      </Notice>
      <ol className="guide">
        {STEPS.map((step, index) => {
          const ticked = steps.includes(index);
          return (
            <li key={step.title} className="guide__step">
              <button
                type="button"
                className={ticked ? 'check-cell check-cell--done' : 'check-cell'}
                aria-pressed={ticked}
                onClick={() => toggleFocusStep(index)}
              >
                <CheckIcon size={15} color={ticked ? 'var(--done)' : 'var(--line-control)'} />
                <span className="visually-hidden">Step {index + 1} done</span>
              </button>
              <div>
                <h2 className="guide__title">
                  {index + 1}. {step.title}
                </h2>
                <p className="guide__path">{step.path}</p>
                <p className="guide__text">{step.text}</p>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="section-actions">
        <button
          type="button"
          className="button button--primary"
          onClick={() => {
            markFocusSetUp();
            onBack();
          }}
        >
          I have set it up
        </button>
      </div>
      <footer className="footnote">
        <span>Steps from Apple’s iPhone User Guide, iOS 27</span>
        <span className="footnote__formula">checked {CHECKED}</span>
      </footer>
    </main>
  );
}
