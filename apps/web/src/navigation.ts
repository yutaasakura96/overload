import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

// A handful of screens do not need a router library. This is the location, and a way to change it.

const subscribe = (onChange: () => void) => {
  window.addEventListener('popstate', onChange);
  return () => window.removeEventListener('popstate', onChange);
};
const snapshot = () => window.location.pathname + window.location.search;

/** What a screen says once on opening, for the screen that sent the user there to choose. */
export type Note = 'finished' | 'removed';

/**
 * What one history entry remembers. `returns`: the entry before it is the screen the user came
 * from, so Back goes there. `note`: said once when the entry opens.
 */
type EntryState = { returns?: boolean | undefined; note?: Note | undefined };

export type NavigateOptions = { replace?: boolean; returns?: boolean; note?: Note | undefined };
export type Navigate = (path: string, options?: NavigateOptions) => void;

function entryState(): EntryState {
  const state: unknown = window.history.state;
  if (typeof state !== 'object' || state === null) return {};
  const note = 'note' in state ? state.note : undefined;
  return {
    returns: 'returns' in state && state.returns === true,
    note: note === 'finished' || note === 'removed' ? note : undefined,
  };
}

export function useLocation() {
  const href = useSyncExternalStore(subscribe, snapshot);
  const url = new URL(href, window.location.origin);
  const navigate = useCallback<Navigate>((path, options = {}) => {
    const { returns, note } = options;
    if (options.replace === true) {
      // The entry replaced keeps where its Back goes: only the address under it changes.
      window.history.replaceState({ returns: entryState().returns, note }, '', path);
    } else {
      window.history.pushState({ returns, note }, '', path);
    }
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, []);
  return { pathname: url.pathname, searchParams: url.searchParams, navigate };
}

/**
 * Back from a screen reached from more than one place: to the screen the user came from when this
 * entry was opened from one, else to `fallback`, the screen's own parent, as after a reload of a
 * shared link.
 */
export function goBack(navigate: Navigate, fallback: string) {
  if (returnsToCaller()) window.history.back();
  else navigate(fallback);
}

/** Whether Back from this entry goes to the screen the user came from. */
export const returnsToCaller = () => entryState().returns === true;

/**
 * The note this entry opened with. It is said once: the entry lets go of it as the screen opens,
 * so coming back to the screen, or reloading it, does not say it again.
 */
export function useEntryNote(): Note | undefined {
  const [note] = useState(() => entryState().note);
  useEffect(() => {
    const { returns, note: held } = entryState();
    if (held !== undefined) window.history.replaceState({ returns }, '');
  }, []);
  return note;
}

/**
 * Where to go after sign-in. `next` must be a same-origin path (docs/08 §5), so an absolute URL or a
 * protocol-relative `//host` falls back to the home screen.
 */
export function safeNext(next: string | null): string {
  if (next === null || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return '/';
  }
  return next;
}

/** The signed-in screens, by path. Anything unknown opens Today. */
export type Route =
  | { screen: 'today' }
  | { screen: 'workout'; guide: boolean }
  | { screen: 'library' }
  | { screen: 'routines' }
  | { screen: 'routine'; id: string | undefined }
  | { screen: 'exercise'; id: string | undefined }
  | { screen: 'progress'; id: string }
  | { screen: 'history' }
  | { screen: 'strength' }
  | { screen: 'balance' }
  | { screen: 'past-workout'; id: string }
  | { screen: 'invites' }
  | { screen: 'account' };

export function routeOf(pathname: string): Route {
  const [first, second, ...rest] = pathname.split('/').filter(Boolean);
  if (first === 'exercises' && second !== undefined && rest.length === 1 && rest[0] === 'progress')
    return { screen: 'progress', id: second };
  if (rest.length > 0) return { screen: 'today' };
  // The iPhone Focus guide opens over the workout, which keeps running under it.
  if (first === 'workout' && (second === undefined || second === 'focus'))
    return { screen: 'workout', guide: second === 'focus' };
  if (first === 'workouts' && second !== undefined) return { screen: 'past-workout', id: second };
  if (first === 'admin' && second === 'invites') return { screen: 'invites' };
  if (first === 'account' && second === undefined) return { screen: 'account' };
  if (first === 'progress' && second === undefined) return { screen: 'history' };
  if (first === 'progress' && (second === 'strength' || second === 'balance'))
    return { screen: second };
  if (first === 'routines' && second === undefined) return { screen: 'routines' };
  if (first === 'routines') return { screen: 'routine', id: second === 'new' ? undefined : second };
  if (first === 'exercises' && second === undefined) return { screen: 'library' };
  if (first === 'exercises')
    return { screen: 'exercise', id: second === 'new' ? undefined : second };
  return { screen: 'today' };
}
