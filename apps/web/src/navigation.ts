import { useCallback, useSyncExternalStore } from 'react';

// Two screens do not need a router library. This is the location, and a way to change it.

const subscribe = (onChange: () => void) => {
  window.addEventListener('popstate', onChange);
  return () => window.removeEventListener('popstate', onChange);
};
const snapshot = () => window.location.pathname + window.location.search;

export function useLocation() {
  const href = useSyncExternalStore(subscribe, snapshot);
  const url = new URL(href, window.location.origin);
  const navigate = useCallback((path: string, options: { replace?: boolean } = {}) => {
    if (options.replace === true) window.history.replaceState(null, '', path);
    else window.history.pushState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, []);
  return { pathname: url.pathname, searchParams: url.searchParams, navigate };
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
