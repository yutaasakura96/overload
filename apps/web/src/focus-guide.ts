import { useSyncExternalStore } from 'react';

// What the phone remembers of the iPhone Focus guide (docs/10 §8.3): the steps ticked, and that the
// Focus is set up. It is a fact about the device, not the account, and holds nothing of the user's
// training, so it lives in localStorage and the sign-out wipe leaves it (docs/06, 2026-10-12).

const KEY = 'overload:focus-guide';

export type FocusGuideState = {
  /** The steps ticked, by their place in the guide, from 0. */
  steps: number[];
  done: boolean;
};

const EMPTY: FocusGuideState = { steps: [], done: false };

function read(): FocusGuideState {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (typeof stored !== 'object' || stored === null) return EMPTY;
    const steps: unknown = 'steps' in stored ? stored.steps : undefined;
    return {
      steps: Array.isArray(steps)
        ? steps.filter((step): step is number => typeof step === 'number')
        : [],
      done: 'done' in stored && stored.done === true,
    };
  } catch {
    // No storage, or something else's value under the key: the guide opens as not yet done.
    return EMPTY;
  }
}

let state: FocusGuideState | undefined;
const listeners = new Set<() => void>();

const snapshot = () => (state ??= read());

function write(next: FocusGuideState) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage refused: the choice holds until the app is closed.
  }
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void) {
  // Another tab of the app changed it.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    state = undefined;
    onChange();
  };
  listeners.add(onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

export const useFocusGuide = () => useSyncExternalStore(subscribe, snapshot);

export function toggleFocusStep(step: number) {
  const { steps, done } = snapshot();
  write({
    steps: steps.includes(step) ? steps.filter((other) => other !== step) : [...steps, step],
    done,
  });
}

export function markFocusSetUp() {
  write({ ...snapshot(), done: true });
}
