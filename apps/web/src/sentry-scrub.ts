import type { Breadcrumb, ErrorEvent } from '@sentry/react';

// What a browser event may carry to Sentry (docs/03 §7): no user, no query string or fragment, no
// value typed into the app. The SDK is set up to collect none of it (sentry.ts); this is the last
// check before an event leaves, and it keeps only what it knows.

// The contexts the browser SDK fills from the device. Anything else is dropped.
const DEVICE_CONTEXTS = new Set(['browser', 'device', 'os', 'culture']);

// Requests and route changes, which say what the app was doing. A click or console breadcrumb can
// quote a label or a logged value, so those never leave.
const KEPT_BREADCRUMBS = new Set(['fetch', 'xhr', 'navigation']);

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  delete event.user;
  delete event.extra;
  if (event.request !== undefined) {
    const { url } = event.request;
    event.request = { url: url === undefined ? undefined : withoutQuery(url) };
  }
  if (event.transaction !== undefined) event.transaction = withoutQuery(event.transaction);
  if (event.contexts !== undefined) {
    event.contexts = Object.fromEntries(
      Object.entries(event.contexts).filter(([name]) => DEVICE_CONTEXTS.has(name)),
    );
  }
  event.breadcrumbs = event.breadcrumbs?.flatMap((crumb) => {
    const kept = scrubBreadcrumb(crumb);
    return kept === null ? [] : [kept];
  });
  return event;
}

export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  if (crumb.category === undefined || !KEPT_BREADCRUMBS.has(crumb.category)) return null;
  const data = crumb.data ?? {};
  const kept: Record<string, unknown> = {};
  // fetch and xhr: method, url, status_code. navigation: from, to.
  for (const key of ['method', 'status_code']) if (key in data) kept[key] = data[key];
  for (const key of ['url', 'from', 'to']) {
    if (typeof data[key] === 'string') kept[key] = withoutQuery(data[key]);
  }
  return {
    type: crumb.type,
    category: crumb.category,
    level: crumb.level,
    timestamp: crumb.timestamp,
    data: kept,
  };
}

function withoutQuery(url: string): string {
  return url.split(/[?#]/, 1)[0] ?? url;
}
