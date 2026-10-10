import { useSyncExternalStore } from 'react';

/**
 * The theme (docs/05 §1.7): light, dark, or whichever the device is set to. The choice belongs to
 * the device, not the account: it is kept in localStorage, the sign-in screen follows it, and the
 * sign-out wipe leaves it. index.html's script applies it once, before the first paint; this module
 * applies it from then on, so the two are kept in step.
 */
export type Theme = 'light' | 'dark';
export type ThemeChoice = Theme | 'system';

const THEME = 'overload:theme';
const deviceLight = window.matchMedia('(prefers-color-scheme: light)');

function remembered(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

let choice = remembered();
const listeners = new Set<() => void>();

function apply() {
  const theme: Theme = choice === 'system' ? (deviceLight.matches ? 'light' : 'dark') : choice;
  document.documentElement.dataset.theme = theme;
  // The browser's own surfaces follow: the canvas and form controls, and the bar around the page,
  // which takes the theme's surface/ground.
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme);
  const ground = getComputedStyle(document.documentElement)
    .getPropertyValue('--surface-ground')
    .trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', ground);
}

function changed() {
  apply();
  for (const listener of listeners) listener();
}

export function chooseTheme(next: ThemeChoice) {
  choice = next;
  try {
    if (next === 'system') localStorage.removeItem(THEME);
    else localStorage.setItem(THEME, next);
  } catch {
    // Storage refused: the choice holds until the app is closed.
  }
  changed();
}

export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => choice,
  );
}

/** Follows the device's setting while the choice is `system`, and a choice made in another tab. */
export function startTheme() {
  apply();
  deviceLight.addEventListener('change', apply);
  window.addEventListener('storage', (event) => {
    if (event.key !== THEME && event.key !== null) return;
    choice = remembered();
    changed();
  });
}
